'use strict';
// Test helpers: realistic events, signed exactly like Arenyze signs them.
const crypto = require('node:crypto');
const { EVENTS } = require('./events');
const { signPayload } = require('./signature');

/**
 * A realistic event envelope of `type`, with sample data you can override.
 * @param {string} type
 * @param {{ data?: Record<string, unknown>, player?: string, game?: string, id?: string, occurredAt?: Date | string, text?: string }} [overrides]
 */
function createTestEvent(type, overrides = {}) {
  const def = EVENTS[type];
  if (!def && !overrides.game) {
    throw new TypeError(`Unknown event type "${type}". Known: ${Object.keys(EVENTS).join(', ')} (or pass { game, data } for a custom one)`);
  }
  const data = { ...(def ? def.sample : {}), ...(overrides.data || {}) };
  const occurred = overrides.occurredAt ? new Date(overrides.occurredAt) : new Date();
  return {
    id: overrides.id || `evt_test_${crypto.randomBytes(6).toString('hex')}`,
    type,
    game: overrides.game || def.game,
    player: overrides.player || (typeof data.player === 'string' ? data.player : def ? def.player : null),
    occurred_at: occurred.toISOString(),
    data,
    text: overrides.text || (def ? def.text(data) : `${type} event`),
  };
}

/**
 * Body + headers of a signed delivery, as Arenyze would POST it.
 * @param {object | string} event An event (object) or an already serialised body.
 * @param {string} secret
 * @param {{ timestamp?: number, deliveryId?: string | number }} [options]
 */
function createSignedRequest(event, secret, options = {}) {
  const body = typeof event === 'string' ? event : JSON.stringify(event);
  const parsed = typeof event === 'string' ? JSON.parse(event) : event;
  const headers = {
    'content-type': 'application/json',
    'user-agent': 'Arenyze-Webhooks/1.0 (+https://docs.arenyze.com/webhooks)',
    'arenyze-signature': signPayload(body, secret, options.timestamp),
    'arenyze-event': String(parsed.type),
    'arenyze-delivery': String(options.deliveryId ?? Math.floor(Math.random() * 1e9)),
  };
  return { body, headers };
}

/**
 * POST a signed test event to your own receiver (e.g. http://localhost:3000/arenyze).
 * @param {string} url
 * @param {{ secret: string, type?: string, event?: object, data?: Record<string, unknown>, deliveryId?: string | number, timestamp?: number, fetch?: typeof fetch }} options
 * @returns {Promise<{ status: number, body: unknown, event: any }>}
 */
async function sendTestEvent(url, options) {
  if (!options || !options.secret) throw new TypeError('Missing required option: secret');
  const event = options.event || createTestEvent(options.type || 'arenyze.test', { data: options.data });
  const { body, headers } = createSignedRequest(event, options.secret, options);
  const fetchImpl = options.fetch || globalThis.fetch;
  const res = await fetchImpl(url, { method: 'POST', headers, body });
  const text = await res.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { status: res.status, body: parsed, event };
}

module.exports = { createTestEvent, createSignedRequest, sendTestEvent };
