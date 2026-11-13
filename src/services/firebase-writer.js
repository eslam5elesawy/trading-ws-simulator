import { existsSync, readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

// Firebase keys can't contain . # $ [ ] / — replace them so a weird provider id can't break the path.
export const safeKey = (id) => String(id).replace(/[.#$[\]/]/g, '_');

// Updates are buffered and sent as ONE multi-path update per flush. One update() per tick
// (hundreds/s over 3000 stocks) pinned the SDK at 175% CPU and starved the server.
export function createFirebaseWriter({ keyPath, databaseURL, stocksPath, flushMs = 1000 }) {
  if (!databaseURL || !existsSync(keyPath)) {
    console.warn(`Firebase disabled: need ${keyPath} and FIREBASE_DATABASE_URL`);
    return { update() {}, stats: () => ({ enabled: false }) };
  }

  const app = initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), databaseURL });
  const stocksRef = getDatabase(app).ref(stocksPath);
  let pending = {}; // 'KEY/field' -> value; a newer tick for the same field overwrites the older one
  let inFlight = false;
  let flushes = 0;
  let fieldsWritten = 0;
  let failed = 0;
  let lastFlush = null;

  async function flush() {
    if (inFlight || Object.keys(pending).length === 0) return; // never overlap writes
    const batch = pending;
    pending = {};
    inFlight = true;
    const started = Date.now();
    try {
      await stocksRef.update(batch);
      flushes++;
      fieldsWritten += Object.keys(batch).length;
      lastFlush = { fields: Object.keys(batch).length, ms: Date.now() - started };
    } catch (err) {
      failed++;
      console.error('Firebase flush failed:', err.message);
      pending = { ...batch, ...pending }; // keep data: retry next flush, newer values win
    } finally {
      inFlight = false;
    }
  }
  setInterval(flush, flushMs);

  return {
    update(key, fields) {
      const k = safeKey(key);
      for (const [field, value] of Object.entries(fields)) pending[`${k}/${field}`] = value;
    },
    stats: () => ({ enabled: true, path: stocksPath, flushMs, flushes, lastFlush, fieldsWritten, failed, pendingFields: Object.keys(pending).length }),
  };
}
