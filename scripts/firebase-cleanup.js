// Deletes the generated test stocks (1xxxx_SR keys) that the simulator wrote to Firebase.
// Real stock keys (4-digit codes) are left alone. Run: npm run firebase:cleanup
import { config } from '../src/config.js';
import { existsSync, readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const { keyPath, databaseURL, stocksPath } = config.firebase;
if (!databaseURL || !existsSync(keyPath)) {
  console.error(`Need ${keyPath} and FIREBASE_DATABASE_URL`);
  process.exit(1);
}
const app = initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), databaseURL });
const ref = getDatabase(app).ref(stocksPath);
const keys = Object.keys((await ref.get()).val() ?? {}).filter((k) => /^1\d{4}_SR$/.test(k)); // generated codes are 10000+
if (keys.length) await ref.update(Object.fromEntries(keys.map((k) => [k, null]))); // null deletes in a multi-path update
console.log(`Deleted ${keys.length} generated stocks from ${stocksPath}`);
await app.delete();
