'use strict';

/**
 * Fastify plugin. The JSON parser is replaced by a raw one ONLY inside this
 * plugin (Fastify encapsulation), so the rest of the app keeps parsing JSON.
 *
 *   fastify.register(webhooks.fastify(), { path: '/arenyze' });
 *
 * @param {import('../ArenyzeWebhooks').ArenyzeWebhooks} webhooks
 */
function fastifyPlugin(webhooks) {
  return async function arenyzeWebhooksPlugin(fastify, opts = {}) {
    fastify.addContentTypeParser(['application/json', 'text/plain'], { parseAs: 'buffer', bodyLimit: opts.bodyLimit || 1024 * 1024 }, (_req, body, done) => done(null, body));
    fastify.post(opts.path || '/', async (request, reply) => {
      const result = await webhooks.handle({ body: request.body, headers: request.headers });
      request.arenyzeEvent = result.event;
      return reply.code(result.status).type('application/json; charset=utf-8').send(result.body);
    });
  };
}

module.exports = { fastifyPlugin };
