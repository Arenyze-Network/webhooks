'use strict';

/**
 * Web standard handler: `(request: Request) => Promise<Response>`.
 * Next.js App Router (`export const POST = webhooks.nextAppRouter()`), Hono,
 * Remix/React Router actions, Bun.serve, Deno.serve, Cloudflare Workers.
 * @param {import('../ArenyzeWebhooks').ArenyzeWebhooks} webhooks
 */
function fetchHandler(webhooks) {
  return async function arenyzeWebhookHandler(request) {
    if (request.method && request.method !== 'POST') {
      return json(405, { error: 'METHOD_NOT_ALLOWED', message: 'Arenyze webhooks are POST requests' }, { Allow: 'POST' });
    }
    const body = new Uint8Array(await request.arrayBuffer());
    const result = await webhooks.handle({ body, headers: request.headers });
    return json(result.status, result.body);
  };
}

/**
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

module.exports = { fetchHandler };
