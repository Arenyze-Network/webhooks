'use strict';
const { readRawBody, sendJson } = require('./node');

/**
 * Express / Connect middleware. Mount it on its own route, before (or instead
 * of) a JSON body parser:
 *
 *   app.post('/arenyze', webhooks.express());
 *
 * It reads the raw body itself. If a global `express.json()` already ran, give
 * it `verify: (req, _res, buf) => { req.rawBody = buf }` so the exact bytes are kept.
 *
 * @param {import('../ArenyzeWebhooks').ArenyzeWebhooks} webhooks
 * @param {{ limit?: number, passThrough?: boolean }} [options]
 *   passThrough: call next() after a successful delivery (with req.arenyzeEvent) instead of answering.
 */
function expressMiddleware(webhooks, options = {}) {
  return async function arenyzeWebhooks(req, res, next) {
    try {
      const body = await readRawBody(req, options.limit);
      const result = await webhooks.handle({ body, headers: req.headers });
      req.arenyzeEvent = result.event;
      if (options.passThrough && result.status < 300) return next();
      if (typeof res.status === 'function' && typeof res.json === 'function') return res.status(result.status).json(result.body);
      return sendJson(res, result.status, result.body);
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { expressMiddleware };
