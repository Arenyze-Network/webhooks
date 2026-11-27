'use strict';
const { assertSignature, toBuffer, DEFAULT_TOLERANCE_SECONDS } = require('./signature');
const { WebhookPayloadError, WebhookHandlerError, ArenyzeWebhookError } = require('./errors');
const { MemoryDedupeStore, DEFAULT_TTL_SECONDS } = require('./dedupe');
const { matches } = require('./events');

/**
 * Case-insensitive header read from a Fetch `Headers`, Node's IncomingHttpHeaders
 * or a plain object.
 * @param {any} headers
 * @param {string} name
 * @returns {string | undefined}
 */
function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    const v = headers.get(name);
    return v === null ? undefined : v;
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      return Array.isArray(v) ? v[0] : v === undefined || v === null ? undefined : String(v);
    }
  }
  return undefined;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

class ArenyzeWebhooks {
  /**
   * @param {{
   *   secret?: string,
   *   secrets?: string[],
   *   toleranceSeconds?: number,
   *   dedupe?: boolean | { has(id: string): any, add(id: string, ttlSeconds: number): any, delete?(id: string): any },
   *   dedupeTtlSeconds?: number,
   *   background?: boolean,
   *   onError?: (error: Error, event?: any) => void,
   * }} options
   */
  constructor(options = {}) {
    const secrets = [...(options.secrets || []), ...(options.secret ? [options.secret] : [])].filter(Boolean);
    if (!secrets.length) {
      throw new TypeError('Missing required option: secret (the endpoint secret, whsec_…, shown when you create or rotate the endpoint)');
    }
    this.secrets = secrets;
    this.toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
    this.dedupeTtlSeconds = options.dedupeTtlSeconds ?? DEFAULT_TTL_SECONDS;
    /** @type {any} */
    this.dedupe = options.dedupe === false ? null : options.dedupe && options.dedupe !== true ? options.dedupe : new MemoryDedupeStore();
    this.background = Boolean(options.background);
    this.onError = options.onError || null;
    /** @type {{ pattern: string, handler: Function, once: boolean }[]} */
    this._handlers = [];
    /** Deliveries being processed right now (concurrent duplicates). */
    this._inFlight = new Set();
  }

  /**
   * Run `handler` for events whose type matches `pattern`: an exact type
   * (`thefinals.league_changed`), a game (`thefinals.*`) or everything (`*`).
   * Several patterns can be passed as an array. Returns a function that removes the handler.
   * @param {string | string[]} pattern
   * @param {(event: any, context: any) => unknown} handler
   */
  on(pattern, handler) {
    return this._add(pattern, handler, false);
  }

  /** Like `on`, but runs once. */
  once(pattern, handler) {
    return this._add(pattern, handler, true);
  }

  /** Remove a handler (or every handler of a pattern when `handler` is omitted). */
  off(pattern, handler) {
    this._handlers = this._handlers.filter((h) => !(h.pattern === pattern && (!handler || h.handler === handler)));
    return this;
  }

  _add(pattern, handler, once) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    const added = patterns.map((p) => {
      if (typeof p !== 'string' || !p) throw new TypeError('pattern must be an event type, "game.*" or "*"');
      const entry = { pattern: p, handler, once };
      this._handlers.push(entry);
      return entry;
    });
    return () => {
      this._handlers = this._handlers.filter((h) => !added.includes(h));
    };
  }

  /**
   * Is the delivery authentic? Never throws for a bad signature.
   * @param {string | Buffer | Uint8Array} rawBody
   * @param {any} headersOrSignature The request headers, or the `Arenyze-Signature` value.
   */
  verify(rawBody, headersOrSignature) {
    try {
      this._assert(rawBody, headersOrSignature);
      return true;
    } catch (error) {
      if (error instanceof ArenyzeWebhookError) return false;
      throw error;
    }
  }

  _assert(rawBody, headersOrSignature) {
    const header = typeof headersOrSignature === 'string' ? headersOrSignature : readHeader(headersOrSignature, 'arenyze-signature');
    return assertSignature(rawBody, header, this.secrets, { toleranceSeconds: this.toleranceSeconds });
  }

  /**
   * Verify and parse a delivery. Throws `WebhookSignatureError` / `WebhookPayloadError`.
   * @param {string | Buffer | Uint8Array} rawBody
   * @param {any} headersOrSignature
   */
  constructEvent(rawBody, headersOrSignature) {
    this._assert(rawBody, headersOrSignature);
    let event;
    try {
      event = JSON.parse(toBuffer(rawBody).toString('utf8'));
    } catch {
      throw new WebhookPayloadError('Body is not valid JSON', 'INVALID_JSON');
    }
    if (!isObject(event) || typeof event.type !== 'string') {
      throw new WebhookPayloadError('Body is not an Arenyze event (missing "type")', 'INVALID_PAYLOAD');
    }
    if (!isObject(event.data)) event.data = {};
    return event;
  }

  /**
   * Run the handlers matching an already verified event, in registration order.
   * @param {any} event
   * @param {any} [context]
   * @returns {Promise<number>} how many handlers ran
   */
  async dispatch(event, context = {}) {
    const ctx = { deliveryId: null, eventType: event.type, signatureTimestamp: null, receivedAt: new Date(), headers: {}, ...context };
    const run = this._handlers.filter((h) => matches(h.pattern, event.type));
    for (const h of run) {
      if (h.once) this._handlers = this._handlers.filter((x) => x !== h);
      try {
        await h.handler(event, ctx);
      } catch (error) {
        throw new WebhookHandlerError(`Handler for "${h.pattern}" failed on ${event.type}: ${error?.message || error}`, error, event);
      }
    }
    return run.length;
  }

  /**
   * Framework-independent receiver: verify, de-duplicate, dispatch, and say
   * what to answer. Every adapter of this package is a thin wrapper of it.
   *
   * - 400 bad signature / payload (Arenyze retries, so a fixed secret recovers)
   * - 200 handled, ignored (no handler) or duplicate
   * - 202 accepted, with `background: true`
   * - 500 a handler threw (Arenyze retries the delivery later)
   *
   * @param {{ body: unknown, headers: any }} request
   * @returns {Promise<{ status: number, body: Record<string, unknown>, event?: any, error?: Error }>}
   */
  async handle({ body, headers }) {
    let event;
    let signed;
    try {
      signed = this._assert(body, headers);
      event = this.constructEvent(body, headers);
    } catch (error) {
      if (error instanceof ArenyzeWebhookError) {
        this._report(error);
        return { status: error.status, body: { error: error.code, message: error.message }, error };
      }
      throw error;
    }

    const deliveryId = readHeader(headers, 'arenyze-delivery') || null;
    const context = {
      deliveryId,
      eventType: readHeader(headers, 'arenyze-event') || event.type,
      signatureTimestamp: signed.timestamp,
      receivedAt: new Date(),
      headers,
    };
    // A redelivery keeps the delivery id; events of one fan-out share the event id.
    const key = deliveryId ? `delivery:${deliveryId}` : event.id ? `event:${event.id}` : null;

    if (key && this.dedupe) {
      if (this._inFlight.has(key) || (await this.dedupe.has(key))) {
        return { status: 200, body: { received: true, duplicate: true }, event };
      }
    }

    const work = async () => {
      if (key) this._inFlight.add(key);
      try {
        const handled = await this.dispatch(event, context);
        if (key && this.dedupe) await this.dedupe.add(key, this.dedupeTtlSeconds);
        return handled;
      } finally {
        if (key) this._inFlight.delete(key);
      }
    };

    if (this.background) {
      work().catch((error) => this._report(error, event));
      return { status: 202, body: { received: true, queued: true }, event };
    }

    try {
      const handled = await work();
      return { status: 200, body: { received: true, handled }, event };
    } catch (error) {
      this._report(error, event);
      const e = /** @type {any} */ (error);
      return { status: 500, body: { error: e.code || 'HANDLER_FAILED', message: 'Handler failed; Arenyze will retry this delivery.' }, event, error: e };
    }
  }

  _report(error, event) {
    if (!this.onError) return;
    try {
      this.onError(error, event);
    } catch {
      // never let the error hook break the response
    }
  }

  // ---- adapters (see src/adapters) ---------------------------------------

  /** Express / Connect middleware. */
  express(options) {
    return require('./adapters/express').expressMiddleware(this, options);
  }

  /** Node `http` request listener. */
  nodeHandler(options) {
    return require('./adapters/node').nodeHandler(this, options);
  }

  /** Web standard handler `(Request) => Promise<Response>` (Next.js App Router, Hono, Bun, Deno, Workers). */
  fetchHandler() {
    return require('./adapters/fetch').fetchHandler(this);
  }

  /** Next.js App Router route handler: `export const POST = webhooks.nextAppRouter()`. */
  nextAppRouter() {
    return require('./adapters/fetch').fetchHandler(this);
  }

  /** Next.js Pages Router API route (export `config = { api: { bodyParser: false } }`). */
  nextPagesRouter() {
    return require('./adapters/node').nodeHandler(this);
  }

  /** Fastify plugin: `fastify.register(webhooks.fastify(), { path: '/arenyze' })`. */
  fastify() {
    return require('./adapters/fastify').fastifyPlugin(this);
  }
}

module.exports = { ArenyzeWebhooks, readHeader };
