// The instrument universe both dummy providers share, so trade ids and detail ids line up.
// Real stocks first (from a snapshot), then generated ones up to `count`. Pure: no file or network access,
// so it runs the same in Node and in a Cloudflare Worker.

// Used when there is no real snapshot to borrow ratios from.
const FALLBACK_TEMPLATE = {
  currency: 'SAR', financialCurrency: 'SAR', exchange: 'SAU', fullExchangeName: 'Saudi', market: 'sr_market',
  quoteType: 'STOCK', typeDisp: 'Equity', marketCap: { raw: 10e9, fmt: '10.00B' },
};
const DEFAULT_SECTORS = ['BANKS', 'MATERIALS', 'ENERGY', 'INSURANCE', 'REAL_ESTATE', 'RETAILING', 'TRANSPORTATION', 'CAPITAL_GOODS'];

const n = (raw) => ({ raw, fmt: raw.toFixed(2) });

// Deterministic per index, so restarts produce the same stocks (same Firebase keys, no orphans).
function generated(i, REAL, SECTORS) {
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

/**
 * @param real [{ details, close }] from data/real-stocks.json (may be empty)
 * @param count total stocks: the first `count` real ones, then generated ones to fill the gap
 */
export function buildInstruments(real = [], count = 3000) {
  const used = real.slice(0, count);
  const realSectors = [...new Set(used.map((r) => r.details.kwealth_sector).filter((s) => typeof s === 'string'))];
  const sectors = realSectors.length ? realSectors : DEFAULT_SECTORS;
  return [...used, ...Array.from({ length: count - used.length }, (_, i) => generated(i, used, sectors))];
}
