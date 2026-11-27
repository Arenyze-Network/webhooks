'use strict';

const DEFAULT_LIMIT = 1024 * 1024; // Arenyze events are a few KB

/**
 * Read the raw body of a Node request (unless something already did).
 * @param {import('node:http').IncomingMessage & { body?: unknown, rawBody?: unknown }} req
 * @param {number} limit
 * @returns {Promise<unknown>}
 */
function readRawBody(req, limit = DEFAULT_LIMIT) {
  // Kept by a body parser (`verify: (req, _res, buf) => { req.rawBody = buf }`).
  if (req.rawBody !== undefined) return Promise.resolve(req.rawBody);
  // Raw body already read (express.raw, a string parser).
  if (typeof req.body === 'string' || req.body instanceof Uint8Array) return Promise.resolve(req.body);
  // Stream still unread: read it here.
  if (req.readable && !req.readableEnded) return readStream(req, limit);
  // Consumed by a JSON parser (an object) or empty: handle() explains what is wrong.
  return Promise.resolve(req.body);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
function readStream(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(text));
  res.end(text);
}

/**
 * `(req, res) => void` for node:http, Next.js Pages Router, Vercel/Netlify Node functions.
 * @param {import('../ArenyzeWebhooks').ArenyzeWebhooks} webhooks
 * @param {{ limit?: number }} [options]
 */
function nodeHandler(webhooks, options = {}) {
  return async function arenyzeWebhookHandler(req, res) {
    if (req.method && req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Arenyze webhooks are POST requests' });
    }
    let body;
    try {
      body = await readRawBody(req, options.limit);
    } catch (error) {
      return sendJson(res, error.status || 400, { error: 'BODY_READ_FAILED', message: error.message });
    }
    const result = await webhooks.handle({ body, headers: req.headers });
    return sendJson(res, result.status, result.body);
  };
}

module.exports = { nodeHandler, readRawBody, sendJson, DEFAULT_LIMIT };
