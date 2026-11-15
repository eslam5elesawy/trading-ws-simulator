import { existsSync, readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

// Firebase keys can't contain . # $ [ ] / — replace them so a weird provider id can't break the path.
export const safeKey = (id) => String(id).replace(/[.#$[\]/]/g, '_');

const SPLIT_AFTER_FAILURES = 3; // after this many failed batches in a row, retry stock by stock

/**
 * Buffers updates and sends ONE multi-path update per flush (one update() per tick pinned the SDK at 175% CPU).
 * A failed batch is retried with newer values winning. If batches keep failing, it retries per stock, so one
 * permanently rejected record is dropped (and logged by key) instead of blocking every other stock forever.
 * @param ref anything with `update(object): Promise` (a Firebase Reference, or a stub in tests)
 */
export function createBatchWriter(ref, { log = console } = {}) {
  let pending = {}; // 'KEY/field' -> value; a newer tick for the same field overwrites the older one
  let inFlight = false;
  let failuresInARow = 0;
  const stats = { flushes: 0, fieldsWritten: 0, failed: 0, dropped: 0, lastFlush: null };

  const requeue = (batch) => {
    pending = { ...batch, ...pending }; // keep data for the retry; values queued meanwhile are newer and win
  };

  async function flushByStock(batch) {
    const byStock = new Map();
    for (const [path, value] of Object.entries(batch)) {
      const key = path.slice(0, path.indexOf('/'));
      if (!byStock.has(key)) byStock.set(key, {});
      byStock.get(key)[path] = value;
    }
    for (const [key, paths] of byStock) {
      try {
        await ref.update(paths);
        stats.fieldsWritten += Object.keys(paths).length;
      } catch (err) {
        stats.dropped += Object.keys(paths).length;
        log.error(`Firebase rejected stock ${key}; dropping ${Object.keys(paths).length} fields: ${err.message}`);
      }
    }
  }

  async function flush() {
    if (inFlight || Object.keys(pending).length === 0) return; // never overlap writes
    const batch = pending;
    pending = {};
    inFlight = true;
    const started = Date.now();
    try {
      if (failuresInARow >= SPLIT_AFTER_FAILURES) {
        await flushByStock(batch);
        failuresInARow = 0;
      } else {
        await ref.update(batch);
        stats.fieldsWritten += Object.keys(batch).length;
        failuresInARow = 0;
      }
      stats.flushes++;
      stats.lastFlush = { fields: Object.keys(batch).length, ms: Date.now() - started };
    } catch (err) {
      stats.failed++;
      failuresInARow++;
      log.error(`Firebase flush failed (${failuresInARow} in a row): ${err.message}`);
      requeue(batch);
    } finally {
      inFlight = false;
    }
  }

  return {
    update(key, fields) {
      const k = safeKey(key);
      for (const [field, value] of Object.entries(fields)) pending[`${k}/${field}`] = value;
    },
    flush,
    /** Waits for a running write, then writes what's still buffered. */
    async drain() {
      while (inFlight) await new Promise((r) => setTimeout(r, 50));
      await flush();
    },
    stats: () => ({ ...stats, pendingFields: Object.keys(pending).length }),
  };
}

export function createFirebaseWriter({ keyPath, databaseURL, stocksPath, flushMs = 1000 }) {
  if (!databaseURL || !existsSync(keyPath)) {
    console.warn(`Firebase disabled: need ${keyPath} and FIREBASE_DATABASE_URL`);
    return { update() {}, close: async () => {}, stats: () => ({ enabled: false }) };
  }

  const app = initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), databaseURL });
  const writer = createBatchWriter(getDatabase(app).ref(stocksPath));
  const timer = setInterval(writer.flush, flushMs);

  return {
    update: writer.update,
    /** Stops the timer and writes what's still buffered, so a shutdown doesn't lose the last second. */
    async close() {
      clearInterval(timer);
      await writer.drain();
      await app.delete();
    },
    stats: () => ({ enabled: true, path: stocksPath, flushMs, ...writer.stats() }),
  };
}
