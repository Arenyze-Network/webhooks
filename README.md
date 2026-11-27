# @arenyze/webhooks

Receive [Arenyze webhooks](https://docs.arenyze.com/webhooks) safely in a few lines: signature verification, typed events for Rainbow Six Siege, THE FINALS and Arknights: Endfield, middleware for Express, Fastify and Next.js, replay and duplicate protection, and test events.

```javascript
import { ArenyzeWebhooks } from '@arenyze/webhooks';

const webhooks = new ArenyzeWebhooks({ secret: process.env.ARENYZE_WEBHOOK_SECRET });

webhooks.on('r6.rank_changed', (event) => {
  console.log(`${event.data.display}: ${event.data.from.rank} → ${event.data.to.rank}`);
});

webhooks.on('thefinals.rank_changed', (event) => {
  console.log(`${event.data.display} is now #${event.data.to.rank}`);
});

app.post('/arenyze', webhooks.express());
```

## Installation

```sh
npm i @arenyze/webhooks
```

Node.js 18 or newer, no dependencies. Works with `require` and `import`.

Create the endpoint in [Workbench → Webhooks](https://workbench.arenyze.com/#/live/webhooks): pick the players and the events, and copy the **signing secret** (`whsec_…`, shown once).

## Handlers

```javascript
webhooks.on('thefinals.league_changed', handler); // one event type
webhooks.on('thefinals.*', handler);              // every THE FINALS event
webhooks.on(['r6.rank_changed', 'endfield.level_changed'], handler);
webhooks.on('*', handler);                        // everything
webhooks.once('arenyze.test', handler);           // first time only

const stop = webhooks.on('r6.*', handler);
stop(); // remove it
```

Handlers run in the order you registered them, and they can be `async`. Each one gets `(event, context)`:

```javascript
webhooks.on('thefinals.ban_detected', async (event, ctx) => {
  event.id;          // "evt_10423"
  event.type;        // "thefinals.ban_detected"
  event.game;        // "thefinals"
  event.player;      // "cheater#0001"
  event.occurred_at; // ISO time of the change
  event.data;        // typed per event (below)
  event.text;        // "Cheater#0001 was removed from the leaderboard (last rank #6647)."
  ctx.deliveryId;    // Arenyze-Delivery header
});
```

### Events

| Type | `data` (besides `player`, `display`, `url`) |
|---|---|
| `r6.rank_changed` | `from { rank, rp }`, `to { rank, rp, kd }`, `delta` |
| `r6.rp_changed` | same as above |
| `thefinals.rank_changed` | `from { rank, score }`, `to { rank, score, league }`, `rankDelta` |
| `thefinals.league_changed` | `from`, `to`, `direction` (1 up, -1 down), `rank`, `score` |
| `thefinals.club_changed` | `from`, `to` (`null` = no club) |
| `thefinals.renamed` | `from`, `to`, `global` |
| `thefinals.ban_detected` | `banType`, `banTypeLabel`, `status`, `lastRank`, `lastLeague`, `season`, `global` |
| `endfield.level_changed` | `from`, `to` |
| `endfield.world_level_changed` | `from`, `to` |
| `endfield.operators_changed` | `from`, `to` |
| `arenyze.test` | `display` — the Workbench "Send test event" |

In TypeScript `event.data` is typed for each pattern, wildcards included: inside `on('thefinals.*')`, checking `event.type` narrows `event.data`.

## Frameworks

Every adapter reads the **raw body** itself, because the signature covers the exact bytes Arenyze sent.

### Express

```javascript
app.post('/arenyze', webhooks.express());
```

If a global `express.json()` runs first, keep the raw bytes:

```javascript
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
```

`webhooks.express({ passThrough: true })` calls `next()` after a valid delivery, with the event in `req.arenyzeEvent`.

### Fastify

```javascript
fastify.register(webhooks.fastify(), { path: '/arenyze' });
```

The raw-body parser only applies inside the plugin: the rest of your app keeps parsing JSON.

### Next.js — App Router

```javascript
// app/api/arenyze/route.js
import { webhooks } from '@/lib/webhooks';
export const POST = webhooks.nextAppRouter();
```

### Next.js — Pages Router

```javascript
// pages/api/arenyze.js
export const config = { api: { bodyParser: false } };
export default webhooks.nextPagesRouter();
```

### Anything else

- `webhooks.fetchHandler()` returns `(Request) => Promise<Response>`, for Hono, Bun, Deno, Cloudflare Workers, Remix and React Router.
- `webhooks.nodeHandler()` is a plain `node:http` listener.
- `await webhooks.handle({ body, headers })` returns `{ status, body, event }` for any other framework.

## What the receiver answers

| Case | Status | Arenyze |
|---|---|---|
| Handled, no handler for this type, or duplicate | `200` | done |
| `background: true` | `202` at once, handlers run after | done |
| Bad / missing signature, bad JSON, already-parsed body | `400` | retries (a fixed secret recovers) |
| A handler threw | `500` | retries after 1 min, 5 min, 30 min, 2 h, 6 h, 12 h |

Arenyze waits 8 seconds for an answer. For slow work, enqueue it in the handler, or use `background: true`: then errors only reach `onError`, and Arenyze does not retry.

## Security

- **Signature**: HMAC-SHA256 of `<t>.<raw body>`, compared in constant time.
- **Replay**: deliveries signed more than 5 minutes ago are rejected (`toleranceSeconds`).
- **Duplicates**: processed delivery ids are remembered for 48 hours, longer than Arenyze's retries, so a redelivery never runs your code twice. A delivery whose handler failed is *not* remembered, so its retry runs again.
- **Secret rotation**: during a rotation, `secrets: [oldSecret, newSecret]` accepts both.

The default duplicate store is in memory. With several instances, pass a shared one, e.g. Redis:

```javascript
const webhooks = new ArenyzeWebhooks({
  secret,
  dedupe: {
    has: async (id) => (await redis.exists(`arz:${id}`)) === 1,
    add: (id, ttl) => redis.set(`arz:${id}`, '1', { EX: ttl }),
  },
});
```

## Options

| Option | Default | |
|---|---|---|
| `secret` / `secrets` | — | Required. The endpoint secret(s). |
| `toleranceSeconds` | `300` | Maximum signature age. `0` = off. |
| `dedupe` | `true` | `true` (in memory), `false`, or `{ has, add, delete? }`. |
| `dedupeTtlSeconds` | `172800` | How long processed ids are remembered. |
| `background` | `false` | Answer `202` first, run handlers after. |
| `onError` | — | `(error, event?) => void` for bad deliveries and failed handlers. |

Without the class: `verifySignature(rawBody, header, secret)` returns a boolean, and `assertSignature()` throws `WebhookSignatureError` (`MISSING_SIGNATURE`, `INVALID_SIGNATURE`, `TIMESTAMP_OUT_OF_RANGE`).

## Testing

```javascript
import { createTestEvent, createSignedRequest, sendTestEvent } from '@arenyze/webhooks';

// A realistic event, with your overrides
const event = createTestEvent('thefinals.league_changed', { data: { to: 'Ruby' } });

// Body + headers signed exactly like Arenyze signs them
const { body, headers } = createSignedRequest(event, 'whsec_test');
const result = await webhooks.handle({ body, headers }); // { status: 200, … }

// POST a signed event to your running server
await sendTestEvent('http://localhost:3000/arenyze', { secret: process.env.ARENYZE_WEBHOOK_SECRET, type: 'r6.rank_changed' });
```

`signPayload(body, secret)` builds the `Arenyze-Signature` header on its own.

## License

MIT
