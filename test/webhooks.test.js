'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const {
  ArenyzeWebhooks, WebhookSignatureError, WebhookPayloadError, verifySignature, signPayload,
  createTestEvent, createSignedRequest, sendTestEvent, EVENT_TYPES, MemoryDedupeStore,
} = require('../src');

const SECRET = 'whsec_test_secret';

/** Exactly what the Arenyze dispatcher does (arenyze/lib/network.js sign()). */
function arenyzeSign(secret, body, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

test('signatures: same scheme as the dispatcher, rotation, tolerance, tampering', () => {
  const body = JSON.stringify(createTestEvent('thefinals.league_changed'));
  const t = Math.floor(Date.now() / 1000);
  const header = arenyzeSign(SECRET, body, t);
  assert.equal(signPayload(body, SECRET, t), header);
  assert.equal(verifySignature(body, header, SECRET), true);
  assert.equal(verifySignature(Buffer.from(body), header, ['whsec_old', SECRET]), true);
  assert.equal(verifySignature(body, header, 'whsec_other'), false);
  assert.equal(verifySignature(body.replace('Diamond 1', 'Ruby'), header, SECRET), false);
  assert.equal(verifySignature(body, header, SECRET, { now: t + 301 }), false);
  assert.equal(verifySignature(body, header, SECRET, { now: t + 301, toleranceSeconds: 0 }), true);
  assert.equal(verifySignature(body, '', SECRET), false);
  assert.throws(() => new ArenyzeWebhooks({}), /secret/);
});

test('constructEvent: errors are typed', () => {
  const wh = new ArenyzeWebhooks({ secret: SECRET });
  const body = JSON.stringify({ hello: 1 });
  assert.throws(() => wh.constructEvent(body, {}), (e) => e instanceof WebhookSignatureError && e.code === 'MISSING_SIGNATURE');
  assert.throws(() => wh.constructEvent(body, { 'arenyze-signature': signPayload(body, SECRET) }), WebhookPayloadError);
  assert.throws(() => wh.constructEvent({ type: 'x' }, { 'Arenyze-Signature': 't=1,v1=00' }), (e) => e.code === 'BODY_ALREADY_PARSED');
  const ok = createSignedRequest(createTestEvent('r6.rank_changed'), SECRET);
  assert.equal(wh.constructEvent(ok.body, ok.headers).data.to.rank, 'Diamond V');
});

test('handlers: exact type, game wildcard, *, arrays, once, off', async () => {
  const wh = new ArenyzeWebhooks({ secret: SECRET });
  const seen = [];
  wh.on('thefinals.league_changed', (e) => seen.push(`exact:${e.data.to}`));
  wh.on('thefinals.*', (e) => seen.push(`game:${e.type}`));
  wh.on('*', (e) => seen.push(`all:${e.type}`));
  wh.on(['r6.rank_changed', 'endfield.level_changed'], (e) => seen.push(`list:${e.type}`));
  wh.once('arenyze.test', () => seen.push('once'));
  const off = wh.on('r6.*', () => seen.push('removed'));
  off();

  for (const type of ['thefinals.league_changed', 'r6.rank_changed', 'arenyze.test', 'arenyze.test']) {
    const { body, headers } = createSignedRequest(createTestEvent(type), SECRET);
    const r = await wh.handle({ body, headers });
    assert.equal(r.status, 200);
  }
  assert.deepEqual(seen, [
    'exact:Diamond 1', 'game:thefinals.league_changed', 'all:thefinals.league_changed',
    'all:r6.rank_changed', 'list:r6.rank_changed',
    'all:arenyze.test', 'once',
    'all:arenyze.test',
  ]);
  assert.ok(EVENT_TYPES.includes('thefinals.ban_detected'));
});

test('duplicates are skipped; a failed delivery is processed again on retry', async () => {
  const wh = new ArenyzeWebhooks({ secret: SECRET, dedupe: new MemoryDedupeStore() });
  let calls = 0;
  let fail = true;
  wh.on('thefinals.rank_changed', () => {
    calls += 1;
    if (fail) throw new Error('database down');
  });
  const event = createTestEvent('thefinals.rank_changed');
  const req = () => createSignedRequest(event, SECRET, { deliveryId: 4412 });

  const first = await wh.handle(req());
  assert.equal(first.status, 500);
  assert.equal(first.body.error, 'HANDLER_FAILED');

  fail = false;
  const retry = await wh.handle(req());
  assert.equal(retry.status, 200);
  assert.equal(retry.body.handled, 1);

  const dup = await wh.handle(req());
  assert.deepEqual(dup.body, { received: true, duplicate: true });
  assert.equal(calls, 2);
});

test('bad signature → 400 and onError', async () => {
  const errors = [];
  const wh = new ArenyzeWebhooks({ secret: SECRET, onError: (e) => errors.push(e.code) });
  const { body, headers } = createSignedRequest(createTestEvent('arenyze.test'), 'whsec_wrong');
  const r = await wh.handle({ body, headers });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'INVALID_SIGNATURE');
  assert.deepEqual(errors, ['INVALID_SIGNATURE']);
});

test('background mode answers 202 before the handler finishes', async () => {
  const wh = new ArenyzeWebhooks({ secret: SECRET, background: true });
  let done = false;
  wh.on('*', async () => { await new Promise((r) => setTimeout(r, 30)); done = true; });
  const r = await wh.handle(createSignedRequest(createTestEvent('arenyze.test'), SECRET));
  assert.equal(r.status, 202);
  assert.equal(done, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(done, true);
});

/** Start an http server, run fn(url), close it. */
async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('Express: raw body read by the middleware, also next to express.json()', async () => {
  const express = require('express');
  const wh = new ArenyzeWebhooks({ secret: SECRET });
  const got = [];
  wh.on('thefinals.*', (e) => got.push(e.data.display));

  const app = express();
  app.post('/arenyze', wh.express());
  app.post('/parsed', express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }), wh.express());
  app.post('/broken', express.json(), wh.express());

  await withServer(app, async (url) => {
    let r = await sendTestEvent(`${url}/arenyze`, { secret: SECRET, type: 'thefinals.league_changed' });
    assert.equal(r.status, 200);
    r = await sendTestEvent(`${url}/parsed`, { secret: SECRET, type: 'thefinals.renamed' });
    assert.equal(r.status, 200);
    r = await sendTestEvent(`${url}/broken`, { secret: SECRET, type: 'thefinals.renamed' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'BODY_ALREADY_PARSED');
    r = await sendTestEvent(`${url}/arenyze`, { secret: 'whsec_wrong', type: 'thefinals.renamed' });
    assert.equal(r.status, 400);
  });
  assert.deepEqual(got, ['Balise#2431', 'Balise#2431']);
});

test('Fastify plugin keeps JSON parsing for the other routes', async () => {
  const Fastify = require('fastify');
  const wh = new ArenyzeWebhooks({ secret: SECRET });
  const got = [];
  wh.on('endfield.*', (e) => got.push(e.data.to));

  const app = Fastify();
  app.register(wh.fastify(), { path: '/arenyze' });
  app.post('/other', async (req) => ({ parsed: req.body }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const r = await sendTestEvent(`${url}/arenyze`, { secret: SECRET, type: 'endfield.level_changed' });
    assert.equal(r.status, 200);
    const other = await fetch(`${url}/other`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    assert.deepEqual(await other.json(), { parsed: { a: 1 } });
  } finally {
    await app.close();
  }
  assert.deepEqual(got, [53]);
});

test('node:http handler and Next.js Pages Router', async () => {
  const wh = new ArenyzeWebhooks({ secret: SECRET });
  let n = 0;
  wh.on('*', () => { n += 1; });
  await withServer(wh.nextPagesRouter(), async (url) => {
    assert.equal((await sendTestEvent(url, { secret: SECRET })).status, 200);
    const get = await fetch(url);
    assert.equal(get.status, 405);
  });
  assert.equal(n, 1);
});

test('Next.js App Router / fetch handler', async () => {
  const wh = new ArenyzeWebhooks({ secret: SECRET });
  const seen = [];
  wh.on('thefinals.ban_detected', (e) => seen.push(e.data.lastLeague));
  const POST = wh.nextAppRouter();
  const { body, headers } = createSignedRequest(createTestEvent('thefinals.ban_detected'), SECRET);
  const res = await POST(new Request('https://example.com/api/arenyze', { method: 'POST', headers, body }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true, handled: 1 });
  assert.deepEqual(seen, ['Platinum 2']);
});

test('createTestEvent: overrides and custom types', () => {
  const e = createTestEvent('thefinals.league_changed', { data: { to: 'Ruby', direction: 1 } });
  assert.equal(e.data.to, 'Ruby');
  assert.equal(e.data.from, 'Diamond 2');
  assert.match(e.id, /^evt_test_/);
  assert.match(e.text, /to Ruby/);
  assert.throws(() => createTestEvent('nope.event'), /Unknown event type/);
  assert.equal(createTestEvent('custom.thing', { game: 'custom', data: { a: 1 } }).data.a, 1);
});
