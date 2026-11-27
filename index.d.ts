// TypeScript declarations for @arenyze/webhooks

/// <reference types="node" />

// ── Event data ───────────────────────────────────────────────────────────

/** Fields every player event carries. */
export interface PlayerRef {
  /** Stable subject: `uplay:name` (R6), lowercased Embark name (THE FINALS), UID (Endfield). */
  player: string;
  /** Name to show. */
  display: string;
  /** Player page on the Arenyze tracker. */
  url: string;
}

export interface R6RankPoint {
  rank: string;
  rp: number;
}

export interface R6RankChangedData extends PlayerRef {
  from: R6RankPoint;
  to: R6RankPoint & { kd: string };
  /** RP difference. */
  delta: number;
}

export type R6RpChangedData = R6RankChangedData;

export interface TheFinalsRankChangedData extends PlayerRef {
  from: { rank: number | null; score: number | null };
  to: { rank: number | null; score: number | null; league: string | null };
  /** Positions gained (positive = climbed). */
  rankDelta: number;
}

export interface TheFinalsLeagueChangedData extends PlayerRef {
  from: string | null;
  to: string | null;
  /** 1 up, -1 down, 0 unknown. */
  direction: 1 | -1 | 0;
  rank: number | null;
  score: number | null;
}

export interface TheFinalsClubChangedData extends PlayerRef {
  /** `null` = no club. */
  from: string | null;
  to: string | null;
}

export interface TheFinalsRenamedData extends PlayerRef {
  from: string;
  to: string;
  /** true when it comes from the global feed (not a watched player). */
  global?: boolean;
  platform?: string | null;
  club?: string | null;
  rank?: number | null;
}

export interface TheFinalsBanDetectedData extends PlayerRef {
  banType: string;
  banTypeLabel: string;
  status: 'suspected' | 'confirmed' | 'returned' | string;
  lastRank: number | null;
  lastLeague: string | null;
  season: string;
  global?: boolean;
}

export interface EndfieldCounterChangedData extends PlayerRef {
  from: number;
  to: number;
}

export interface ArenyzeTestData {
  display: string;
  [key: string]: unknown;
}

/** `data` of every event type. */
export interface EventDataMap {
  'r6.rank_changed': R6RankChangedData;
  'r6.rp_changed': R6RpChangedData;
  'thefinals.rank_changed': TheFinalsRankChangedData;
  'thefinals.league_changed': TheFinalsLeagueChangedData;
  'thefinals.club_changed': TheFinalsClubChangedData;
  'thefinals.renamed': TheFinalsRenamedData;
  'thefinals.ban_detected': TheFinalsBanDetectedData;
  'endfield.level_changed': EndfieldCounterChangedData;
  'endfield.world_level_changed': EndfieldCounterChangedData;
  'endfield.operators_changed': EndfieldCounterChangedData;
  'arenyze.test': ArenyzeTestData;
}

export type EventType = keyof EventDataMap;
export type Game = 'r6' | 'thefinals' | 'endfield' | 'arenyze';

/** The envelope Arenyze POSTs (docs.arenyze.com/webhooks#payload). */
export interface ArenyzeEvent<T extends EventType = EventType> {
  /** `evt_<n>`; one fan-out shares it across your endpoints. */
  id: string;
  type: T;
  game: T extends `${infer G}.${string}` ? G : Game;
  player: string | null;
  /** ISO time of the change. */
  occurred_at: string;
  data: EventDataMap[T];
  /** Ready-made sentence, e.g. "Balise#2431 moved from Diamond 2 to Diamond 1." */
  text: string;
}

/** Any event, discriminated by `type`. */
export type AnyArenyzeEvent = { [K in EventType]: ArenyzeEvent<K> }[EventType];

/** `thefinals.*` → every THE FINALS event, `*` → all. */
export type EventPattern = EventType | `${Exclude<Game, 'arenyze'>}.*` | 'arenyze.*' | '*';

type EventsOfPattern<P extends string> =
  P extends '*' ? AnyArenyzeEvent :
  P extends `${infer G}.*` ? Extract<AnyArenyzeEvent, { type: `${G}.${string}` }> :
  P extends EventType ? ArenyzeEvent<P> :
  AnyArenyzeEvent;

export interface DeliveryContext {
  /** `Arenyze-Delivery` header (unique per delivery, kept on redeliveries). */
  deliveryId: string | null;
  /** `Arenyze-Event` header. */
  eventType: string;
  /** `t` of the signature (unix seconds). */
  signatureTimestamp: number | null;
  receivedAt: Date;
  headers: unknown;
}

export type WebhookHandler<E = AnyArenyzeEvent> = (event: E, context: DeliveryContext) => unknown | Promise<unknown>;

// ── Receiver ─────────────────────────────────────────────────────────────

export type RawBody = string | Buffer | Uint8Array | ArrayBuffer;
export type HeadersLike = Headers | Record<string, string | string[] | undefined>;

/** Where processed delivery ids are remembered (Redis, a database…). */
export interface DedupeStore {
  has(id: string): boolean | Promise<boolean>;
  add(id: string, ttlSeconds: number): unknown | Promise<unknown>;
  delete?(id: string): unknown | Promise<unknown>;
}

export interface ArenyzeWebhooksOptions {
  /** The endpoint secret (`whsec_…`). */
  secret?: string;
  /** Several secrets at once, e.g. old and new while you rotate. */
  secrets?: string[];
  /** Reject signatures older/newer than this many seconds (default 300, 0 = off). */
  toleranceSeconds?: number;
  /** Skip deliveries already processed: `true` (in memory, default), `false`, or your store. */
  dedupe?: boolean | DedupeStore;
  /** How long processed ids are remembered (default 48 h; Arenyze retries for ~21 h). */
  dedupeTtlSeconds?: number;
  /** Answer 202 at once and run handlers afterwards (failures go to onError, no retry). */
  background?: boolean;
  /** Bad signatures, bad payloads and handler failures. */
  onError?: (error: Error, event?: AnyArenyzeEvent) => void;
}

export interface HandleResult {
  /** HTTP status to answer with. */
  status: 200 | 202 | 400 | 500 | number;
  body: Record<string, unknown>;
  event?: AnyArenyzeEvent;
  error?: Error;
}

export interface MinimalNodeRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  rawBody?: unknown;
}

export class ArenyzeWebhooks {
  constructor(options: ArenyzeWebhooksOptions);
  readonly secrets: string[];
  toleranceSeconds: number;

  on<P extends EventPattern>(pattern: P | P[], handler: WebhookHandler<EventsOfPattern<P>>): () => void;
  once<P extends EventPattern>(pattern: P | P[], handler: WebhookHandler<EventsOfPattern<P>>): () => void;
  off(pattern: EventPattern, handler?: WebhookHandler<any>): this;

  /** Is the delivery authentic? Never throws for a bad signature. */
  verify(rawBody: RawBody, headersOrSignature: HeadersLike | string): boolean;
  /** Verify and parse. Throws WebhookSignatureError / WebhookPayloadError. */
  constructEvent(rawBody: RawBody, headersOrSignature: HeadersLike | string): AnyArenyzeEvent;
  /** Run the matching handlers of a verified event; resolves to how many ran. */
  dispatch(event: AnyArenyzeEvent, context?: Partial<DeliveryContext>): Promise<number>;
  /** Framework-independent receiver. */
  handle(request: { body: RawBody | unknown; headers: HeadersLike }): Promise<HandleResult>;

  /** Express / Connect middleware: `app.post('/arenyze', webhooks.express())`. */
  express(options?: { limit?: number; passThrough?: boolean }): (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;
  /** Fastify plugin: `fastify.register(webhooks.fastify(), { path: '/arenyze' })`. */
  fastify(): (fastify: any, opts?: { path?: string; bodyLimit?: number }) => Promise<void>;
  /** Next.js App Router: `export const POST = webhooks.nextAppRouter()`. */
  nextAppRouter(): (request: Request) => Promise<Response>;
  /** Next.js Pages Router (with `config = { api: { bodyParser: false } }`). */
  nextPagesRouter(): (req: any, res: any) => Promise<void>;
  /** Web standard `(Request) => Response`: Hono, Bun, Deno, Cloudflare Workers. */
  fetchHandler(): (request: Request) => Promise<Response>;
  /** node:http request listener. */
  nodeHandler(options?: { limit?: number }): (req: any, res: any) => Promise<void>;
}

export function expressMiddleware(webhooks: ArenyzeWebhooks, options?: { limit?: number; passThrough?: boolean }): ReturnType<ArenyzeWebhooks['express']>;
export function fastifyPlugin(webhooks: ArenyzeWebhooks): ReturnType<ArenyzeWebhooks['fastify']>;
export function fetchHandler(webhooks: ArenyzeWebhooks): (request: Request) => Promise<Response>;
export function nodeHandler(webhooks: ArenyzeWebhooks, options?: { limit?: number }): (req: any, res: any) => Promise<void>;

// ── Signatures ───────────────────────────────────────────────────────────

export interface VerifyOptions {
  toleranceSeconds?: number;
  /** Current time in seconds, for tests. */
  now?: number;
}

export function verifySignature(rawBody: RawBody, header: string | null | undefined, secrets: string | string[], options?: VerifyOptions): boolean;
export function assertSignature(rawBody: RawBody, header: string | null | undefined, secrets: string | string[], options?: VerifyOptions): { timestamp: number };
/** Build an `Arenyze-Signature` header (tests, local tools). */
export function signPayload(rawBody: RawBody, secret: string, timestamp?: number): string;
export function computeSignature(rawBody: RawBody, timestamp: number | string, secret: string): string;
export function parseSignatureHeader(header: string | null | undefined): { t: number | null; v1: string[] };
export function readHeader(headers: unknown, name: string): string | undefined;
export function matchesEventType(pattern: string, type: string): boolean;

// ── Catalogue & testing ──────────────────────────────────────────────────

export const EVENT_TYPES: readonly EventType[];
export const EVENTS: Record<EventType, { game: Game; description: string; player: string; sample: Record<string, unknown>; text(data: any): string }>;

export interface TestEventOverrides<T extends EventType> {
  data?: Partial<EventDataMap[T]>;
  player?: string;
  game?: string;
  id?: string;
  occurredAt?: Date | string;
  text?: string;
}

/** A realistic event with sample data you can override. */
export function createTestEvent<T extends EventType>(type: T, overrides?: TestEventOverrides<T>): ArenyzeEvent<T>;
/** Body + headers of a signed delivery, exactly as Arenyze sends it. */
export function createSignedRequest(event: object | string, secret: string, options?: { timestamp?: number; deliveryId?: string | number }): { body: string; headers: Record<string, string> };
/** POST a signed test event to your receiver. */
export function sendTestEvent(url: string, options: {
  secret: string;
  type?: EventType;
  event?: object;
  data?: Record<string, unknown>;
  deliveryId?: string | number;
  timestamp?: number;
  fetch?: typeof fetch;
}): Promise<{ status: number; body: unknown; event: AnyArenyzeEvent }>;

export class MemoryDedupeStore implements DedupeStore {
  constructor(options?: { maxEntries?: number; now?: () => number });
  has(id: string): Promise<boolean>;
  add(id: string, ttlSeconds: number): Promise<void>;
  delete(id: string): Promise<void>;
  readonly size: number;
}

export const DEFAULT_TOLERANCE_SECONDS: number;
export const DEFAULT_DEDUPE_TTL_SECONDS: number;

// ── Errors ───────────────────────────────────────────────────────────────

export class ArenyzeWebhookError extends Error {
  code: string;
  /** HTTP status to answer with. */
  status: number;
}
export class WebhookSignatureError extends ArenyzeWebhookError {
  code: 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE' | 'TIMESTAMP_OUT_OF_RANGE';
}
export class WebhookPayloadError extends ArenyzeWebhookError {}
export class WebhookHandlerError extends ArenyzeWebhookError {
  cause: unknown;
  event: AnyArenyzeEvent;
}
