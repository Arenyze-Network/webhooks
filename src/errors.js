'use strict';

/** Base class of every error thrown by @arenyze/webhooks. */
class ArenyzeWebhookError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {number} status HTTP status the receiver should answer with.
   */
  constructor(message, code, status) {
    super(message);
    this.name = 'ArenyzeWebhookError';
    this.code = code;
    this.status = status;
  }
}

/** The `Arenyze-Signature` header is missing, malformed, wrong or too old. */
class WebhookSignatureError extends ArenyzeWebhookError {
  /**
   * @param {string} message
   * @param {'MISSING_SIGNATURE' | 'INVALID_SIGNATURE' | 'TIMESTAMP_OUT_OF_RANGE'} code
   */
  constructor(message, code = 'INVALID_SIGNATURE') {
    super(message, code, 400);
    this.name = 'WebhookSignatureError';
  }
}

/** The body is not a valid Arenyze event (bad JSON, missing fields, parsed body). */
class WebhookPayloadError extends ArenyzeWebhookError {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = 'INVALID_PAYLOAD') {
    super(message, code, 400);
    this.name = 'WebhookPayloadError';
  }
}

/** A handler registered with `on()` threw: the delivery is answered 500 so Arenyze retries it. */
class WebhookHandlerError extends ArenyzeWebhookError {
  /**
   * @param {string} message
   * @param {unknown} cause
   * @param {any} event
   */
  constructor(message, cause, event) {
    super(message, 'HANDLER_FAILED', 500);
    this.name = 'WebhookHandlerError';
    this.cause = cause;
    this.event = event;
  }
}

module.exports = {
  ArenyzeWebhookError,
  WebhookSignatureError,
  WebhookPayloadError,
  WebhookHandlerError,
};
