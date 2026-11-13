// The instrument universe both dummy providers share, so trade ids and detail ids line up.
// Real Saudi stocks from data/real-stocks.json (npm run fetch-real), then generated ones up to STOCK_COUNT.
import { existsSync, readFileSync } from 'node:fs';

const file = new URL('../../data/real-stocks.json', import.meta.url);
const REAL = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []; // [{ details, close }]
if (REAL.length === 0) console.warn('No data/real-stocks.json (see `npm run fetch-real`): using generated stocks only.');

// Used when there is no real snapshot to borrow ratios from.
const FALLBACK_TEMPLATE = {
  currency: 'SAR', financialCurrency: 'SAR', exchange: 'SAU', fullExchangeName: 'Saudi', market: 'sr_market',
  quoteType: 'STOCK', typeDisp: 'Equity', marketCap: { raw: 10e9, fmt: '10.00B' },
};
const DEFAULT_SECTORS = ['BANKS', 'MATERIALS', 'ENERGY', 'INSURANCE', 'REAL_ESTATE', 'RETAILING', 'TRANSPORTATION', 'CAPITAL_GOODS'];

const COUNT = Math.max(REAL.length, Number(process.env.STOCK_COUNT ?? 3000));
const realSectors = [...new Set(REAL.map((r) => r.details.kwealth_sector).filter(Boolean))];
const SECTORS = realSectors.length ? realSectors : DEFAULT_SECTORS;
const n = (raw) => ({ raw, fmt: raw.toFixed(2) });

// Deterministic per index, so restarts produce the same stocks (same Firebase keys, no orphans).
function generated(i) {
  const template = REAL.length ? REAL[i % REAL.length].details : FALLBACK_TEMPLATE; // borrow realistic ratios from a real company
  const code = 10000 + i; // 5 digits: can't collide with real 4-digit Tadawul codes
  const close = Number((5 + ((i * 37) % 1950) / 10).toFixed(2)); // 5.00 .. 199.90
  const low = close * 0.8;
  const high = close * 1.2;
  return {
    close,
    details: {
      ...template,
      isin: `SAFAKE${String(i).padStart(6, '0')}_503`,
      isin_code: `SAFAKE${String(i).padStart(6, '0')}_503`, // Firebase rejects undefined, so overwrite, don't unset
      symbol: `${code}.SR`,
      code: `${code}.SR`,
      shortName: `Test Company ${code}`,
      longName: `Test Company ${code} Holding`,
      kwealth_short_name: `TC${code}`,
      kwealth_sector: SECTORS[i % SECTORS.length],
      fiftyTwoWeekHigh: n(high),
      fiftyTwoWeekLow: n(low),
      fiftyTwoWeekRange: { raw: `${low.toFixed(2)} - ${high.toFixed(2)}`, fmt: `${low.toFixed(2)} - ${high.toFixed(2)}` },
    },
  };
}

export const INSTRUMENTS = [...REAL, ...Array.from({ length: COUNT - REAL.length }, (_, i) => generated(i))];
export const REAL_COUNT = REAL.length;
