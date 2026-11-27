'use strict';
const { ArenyzeWebhooks, readHeader } = require('./ArenyzeWebhooks');
const { ArenyzeWebhookError, WebhookSignatureError, WebhookPayloadError, WebhookHandlerError } = require('./errors');
const { verifySignature, assertSignature, signPayload, computeSignature, parseSignatureHeader, DEFAULT_TOLERANCE_SECONDS } = require('./signature');
const { EVENTS, EVENT_TYPES, matches } = require('./events');
const { MemoryDedupeStore, DEFAULT_TTL_SECONDS } = require('./dedupe');
const { createTestEvent, createSignedRequest, sendTestEvent } = require('./testing');
const { expressMiddleware } = require('./adapters/express');
const { nodeHandler } = require('./adapters/node');
const { fetchHandler } = require('./adapters/fetch');
const { fastifyPlugin } = require('./adapters/fastify');

module.exports = {
  ArenyzeWebhooks,
  ArenyzeWebhookError,
  WebhookSignatureError,
  WebhookPayloadError,
  WebhookHandlerError,
  verifySignature,
  assertSignature,
  signPayload,
  computeSignature,
  parseSignatureHeader,
  readHeader,
  EVENTS,
  EVENT_TYPES,
  matchesEventType: matches,
  MemoryDedupeStore,
  createTestEvent,
  createSignedRequest,
  sendTestEvent,
  expressMiddleware,
  nodeHandler,
  fetchHandler,
  fastifyPlugin,
  DEFAULT_TOLERANCE_SECONDS,
  DEFAULT_DEDUPE_TTL_SECONDS: DEFAULT_TTL_SECONDS,
};
