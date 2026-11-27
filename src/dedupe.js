'use strict';

// Arenyze retries a failed delivery for ~21 h (1 min, 5 min, 30 min, 2 h, 6 h, 12 h),
// and the Workbench can re-send it later: remember processed ids for 48 h.
const DEFAULT_TTL_SECONDS = 48 * 3600;

/**
 * In-memory store of processed delivery ids, with TTL and a size cap.
 * Fine for one process; with several instances use a shared store (Redis…)
 * with the same three methods.
 */
class MemoryDedupeStore {
  /**
   * @param {{ maxEntries?: number, now?: () => number }} [options]
   */
  constructor(options = {}) {
    this.maxEntries = options.maxEntries ?? 10000;
    this._now = options.now || Date.now;
    /** @type {Map<string, number>} id → expiry (ms) */
    this._seen = new Map();
  }

  /** @param {string} id */
  async has(id) {
    const exp = this._seen.get(id);
    if (exp === undefined) return false;
    if (exp <= this._now()) {
      this._seen.delete(id);
      return false;
    }
    return true;
  }

  /**
   * @param {string} id
   * @param {number} ttlSeconds
   */
  async add(id, ttlSeconds) {
    this._seen.delete(id);
    this._seen.set(id, this._now() + ttlSeconds * 1000);
    while (this._seen.size > this.maxEntries) {
      const oldest = this._seen.keys().next().value;
      if (oldest === undefined) break;
      this._seen.delete(oldest);
    }
  }

  /** @param {string} id */
  async delete(id) {
    this._seen.delete(id);
  }

  get size() {
    return this._seen.size;
  }
}

module.exports = { MemoryDedupeStore, DEFAULT_TTL_SECONDS };
