// Validation for company reference data at the boundary (importer and row mapping), so one malformed
// record can't break the server, the page or Firebase. Pure: shared by Node, the importer and the Worker.

/** A finite number from `12.5`, `{ raw: 12.5 }` or `{ raw: "12.5" }`; otherwise null. */
export function toNumber(value) {
  const raw = value !== null && typeof value === 'object' ? value.raw : value;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const positive = (value) => {
  const n = toNumber(value);
  return n !== null && n > 0 ? n : null;
};

/** A non-empty string, or undefined (so it's dropped from the record). */
export const toText = (value) => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

const TEXT_FIELDS = ['symbol', 'code', 'shortName', 'longName', 'kwealth_short_name', 'kwealth_sector', 'isin', 'isin_code',
  'industry', 'sector', 'currency', 'financialCurrency', 'exchange', 'fullExchangeName', 'market', 'quoteType', 'typeDisp'];
const NUMBER_FIELDS = ['marketCap', 'sharesOutstanding', 'trailingPE', 'epsTrailingTwelveMonths', 'epsForward', 'forwardPE',
  'dividendRate', 'trailingAnnualDividendRate', 'dividendYield', 'bookValue', 'priceToBook', 'fiftyDayAverage',
  'twoHundredDayAverage', 'averageDailyVolume10Day', 'fiftyTwoWeekHigh', 'fiftyTwoWeekLow'];

/**
 * Turns a Firebase `stocks` node ({ key: record }) into [{ details, close }].
 * Keeps only valid text and numbers (numbers stored as { raw, fmt }, the shape the app reads),
 * skips records without a symbol or a positive price, and keeps the first of any duplicate symbol.
 * @returns {{ stocks, skipped: string[], duplicates: string[] }}
 * @throws if the response is not an object of records (so the last good snapshot isn't overwritten)
 */
export function parseReferenceStocks(all) {
  if (all === null || typeof all !== 'object' || Array.isArray(all)) {
    throw new Error(`Expected an object of stock records, got ${all === null ? 'null' : Array.isArray(all) ? 'an array' : typeof all}`);
  }
  const stocks = [];
  const skipped = [];
  const duplicates = [];
  const symbols = new Set();
  const isins = new Set();

  for (const [key, node] of Object.entries(all)) {
    const symbol = toText(node?.symbol);
    // Previous close first; fall back to the last price when the close is missing or unusable.
    const close = positive(node?.regularMarketPreviousClose) ?? positive(node?.regularMarketPrice);
    if (!symbol || close === null) {
      skipped.push(key);
      continue;
    }
    if (symbols.has(symbol)) {
      duplicates.push(`${key} (${symbol})`); // two instruments would share one live row and Firebase key
      continue;
    }
    symbols.add(symbol);

    const details = {};
    for (const f of TEXT_FIELDS) if (toText(node[f])) details[f] = node[f];
    for (const f of NUMBER_FIELDS) {
      const n = toNumber(node[f]);
      if (n !== null) details[f] = { raw: n, fmt: typeof node[f]?.fmt === 'string' ? node[f].fmt : String(n) };
    }
    const range = node.fiftyTwoWeekRange;
    if (typeof range?.raw === 'string' && typeof range?.fmt === 'string') details.fiftyTwoWeekRange = { raw: range.raw, fmt: range.fmt };

    // Some funds/REITs have no ISIN (or share one) in the source; any unique id works as our join key.
    if (!details.isin || isins.has(details.isin)) details.isin = `NOISIN_${key}`;
    isins.add(details.isin);
    stocks.push({ details, close });
  }
  stocks.sort((a, b) => a.details.symbol.localeCompare(b.details.symbol));
  return { stocks, skipped, duplicates };
}
