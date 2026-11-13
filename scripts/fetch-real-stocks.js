// Copies real company details from a Firebase stocks node into data/real-stocks.json.
// Run: REAL_STOCKS_URL=https://<db>/REAL_TIME/stocks.json npm run fetch-real
// The URL is not in the code on purpose (public repo); without it the server uses generated stocks only.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../data/real-stocks.json', import.meta.url);
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });

const SOURCE = process.env.REAL_STOCKS_URL;
if (!SOURCE) {
  // Leave an empty list so bundlers (Cloudflare Worker) always find the file.
  if (!existsSync(OUT)) writeFileSync(OUT, '[]');
  console.warn('REAL_STOCKS_URL not set: keeping existing snapshot or none (generated stocks only).');
  process.exit(0);
}
// Static company fields only; live prices come from our trade feed.
const KEEP = ['symbol', 'code', 'shortName', 'longName', 'kwealth_short_name', 'kwealth_sector', 'isin', 'isin_code',
  'industry', 'sector', 'currency', 'financialCurrency', 'exchange', 'fullExchangeName', 'market', 'quoteType', 'typeDisp',
  'marketCap', 'sharesOutstanding', 'trailingPE', 'epsTrailingTwelveMonths', 'epsForward', 'forwardPE', 'dividendRate',
  'trailingAnnualDividendRate', 'dividendYield', 'bookValue', 'priceToBook', 'fiftyDayAverage', 'twoHundredDayAverage',
  'averageDailyVolume10Day', 'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'fiftyTwoWeekRange'];

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const all = await res.json();

const stocks = [];
const seen = new Set();
for (const [key, node] of Object.entries(all)) {
  const close = node?.regularMarketPreviousClose?.raw ?? node?.regularMarketPrice?.raw;
  if (!node?.symbol || typeof close !== 'number' || close <= 0) continue; // skip incomplete records
  const details = Object.fromEntries(KEEP.filter((k) => node[k] != null).map((k) => [k, node[k]]));
  // Some funds/REITs have no ISIN (or share one) in staging; any unique id works as our join key.
  if (!details.isin || seen.has(details.isin)) details.isin = `NOISIN_${key}`;
  seen.add(details.isin);
  stocks.push({ details, close });
}
stocks.sort((a, b) => a.details.symbol.localeCompare(b.details.symbol));
writeFileSync(OUT, JSON.stringify(stocks));
console.log(`saved ${stocks.length} of ${Object.keys(all).length} stocks`);
