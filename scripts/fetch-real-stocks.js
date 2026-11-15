// Copies real company details from a Firebase stocks node into data/real-stocks.json.
// Run: npm run fetch-real   (reads REAL_STOCKS_URL from the shell or .env; the shell value wins)
// The URL is not in the code on purpose (public repo); without it the server uses generated stocks only.
// A bad or empty response fails with a clear message and keeps the last good snapshot.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseReferenceStocks } from '../src/provider/reference-data.js';

const OUT = resolve(process.env.REAL_STOCKS_OUT || resolve(import.meta.dirname, '../data/real-stocks.json'));
mkdirSync(dirname(OUT), { recursive: true });

const SOURCE = process.env.REAL_STOCKS_URL;
if (!SOURCE) {
  // Leave an empty list so bundlers (Cloudflare Worker) always find the file.
  if (!existsSync(OUT)) writeFileSync(OUT, '[]');
  console.warn('REAL_STOCKS_URL not set: keeping existing snapshot or none (generated stocks only).');
  process.exit(0);
}

const fail = (message) => {
  console.error(`fetch-real: ${message}. Keeping the existing snapshot.`);
  process.exit(1);
};

let all;
try {
  const res = await fetch(SOURCE);
  if (!res.ok) fail(`source returned HTTP ${res.status}`);
  all = await res.json();
} catch (err) {
  fail(`could not read the source (${err.message})`);
}

let result;
try {
  result = parseReferenceStocks(all);
} catch (err) {
  fail(err.message);
}
const { stocks, skipped, duplicates } = result;
if (stocks.length === 0) fail(`no usable stocks in the source (${skipped.length} skipped)`);

writeFileSync(OUT, JSON.stringify(stocks));
console.log(`saved ${stocks.length} of ${Object.keys(all).length} stocks`);
if (skipped.length) console.warn(`skipped ${skipped.length} without a symbol or positive price: ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? ', ...' : ''}`);
if (duplicates.length) console.warn(`skipped ${duplicates.length} duplicate symbols (kept the first): ${duplicates.join(', ')}`);
