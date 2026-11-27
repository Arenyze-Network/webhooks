'use strict';
// Arenyze-Signature: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.
const crypto = require('node:crypto');
const { WebhookSignatureError, WebhookPayloadError } = require('./errors');

const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * @param {unknown} rawBody
 * @returns {Buffer}
 */
function toBuffer(rawBody) {
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (rawBody instanceof Uint8Array) return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  if (rawBody instanceof ArrayBuffer) return Buffer.from(rawBody);
  if (rawBody && typeof rawBody === 'object') {
    throw new WebhookPayloadError(
      'The body was already parsed as JSON. The signature covers the exact bytes Arenyze sent: give the raw body ' +
      '(e.g. express.raw({ type: "application/json" }), or the middleware of this package).',
      'BODY_ALREADY_PARSED',
    );
  }
  throw new WebhookPayloadError('Missing request body', 'MISSING_BODY');
}

/**
 * @param {string | null | undefined} header
 * @returns {{ t: number | null, v1: string[] }}
 */
function parseSignatureHeader(header) {
  const out = { t: /** @type {number | null} */ (null), v1: /** @type {string[]} */ ([]) };
  for (const part of String(header || '').split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) out.t = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) out.v1.push(value.toLowerCase());
  }
  return out;
}

/**
 * @param {string | Buffer | Uint8Array} rawBody
 * @param {number | string} timestamp
 * @param {string} secret
 */
function computeSignature(rawBody, timestamp, secret) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(toBuffer(rawBody)).digest('hex');
}

/**
 * Build the header Arenyze sends, e.g. for tests.
 * @param {string | Buffer | Uint8Array} rawBody
 * @param {string} secret
 * @param {number} [timestamp] Unix seconds (default: now).
 */
function signPayload(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new TypeError('Missing required parameter: secret');
  return `t=${timestamp},v1=${computeSignature(rawBody, timestamp, secret)}`;
}

/**
 * Throwing check. Accepts several secrets (rotation: old and new are valid at once).
 * @param {string | Buffer | Uint8Array} rawBody
 * @param {string | null | undefined} header
 * @param {string | string[]} secrets
 * @param {{ toleranceSeconds?: number, now?: number }} [options]
 * @returns {{ timestamp: number }}
 */
function assertSignature(rawBody, header, secrets, options = {}) {
  const list = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  if (!list.length) throw new TypeError('Missing required parameter: secret');
  // First: a parsed body is the most common setup mistake, say it plainly.
  const body = toBuffer(rawBody);
  if (!header) throw new WebhookSignatureError('Missing Arenyze-Signature header', 'MISSING_SIGNATURE');

  const { t, v1 } = parseSignatureHeader(header);
  if (t === null || !v1.length) throw new WebhookSignatureError('Malformed Arenyze-Signature header', 'INVALID_SIGNATURE');

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (tolerance > 0) {
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - t) > tolerance) {
      throw new WebhookSignatureError(`Signature timestamp is ${Math.abs(now - t)} s away from now (tolerance ${tolerance} s)`, 'TIMESTAMP_OUT_OF_RANGE');
    }
  }

  for (const secret of list) {
    const expected = Buffer.from(computeSignature(body, t, secret), 'utf8');
    for (const candidate of v1) {
      const given = Buffer.from(candidate, 'utf8');
      if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return { timestamp: t };
    }
  }
  throw new WebhookSignatureError('Signature does not match: check the endpoint secret (whsec_…)', 'INVALID_SIGNATURE');
}

/**
 * Boolean check.
 * @param {string | Buffer | Uint8Array} rawBody
 * @param {string | null | undefined} header
 * @param {string | string[]} secrets
 * @param {{ toleranceSeconds?: number, now?: number }} [options]
 */
function verifySignature(rawBody, header, secrets, options) {
  try {
    assertSignature(rawBody, header, secrets, options);
    return true;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    return false;
  }
}

module.exports = {
  DEFAULT_TOLERANCE_SECONDS,
  toBuffer,
  parseSignatureHeader,
  computeSignature,
  signPayload,
  assertSignature,
  verifySignature,
};
