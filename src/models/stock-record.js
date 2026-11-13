// Live fields of the Firebase stock record the mobile app reads (StockData.fromMap), matching the real
// REAL_TIME/stocks/{code} nodes. Static details come from the details provider as-is.

const num = (raw) => (raw == null ? null : { raw, fmt: raw.toFixed(2), longFmt: String(raw) });

// '2010.SR' -> '2010_SR' (the node key the app turns into stockCode).
export const stockKey = (details) => details.symbol.replace('.', '_');

// Fields that don't change during the day: written once per stock, not on every tick.
export const dailyFields = (quote) => ({
  regularMarketOpen: num(quote.open),
  regularMarketPreviousClose: num(quote.close),
});

// What changes on each tick; kept to what the stock list shows, since every field is a write path.
// Plain numbers, not { raw, fmt }: ~3x smaller per write, and the app's _extractDouble reads both forms.
export const tickFields = (quote) => ({
  regularMarketPrice: quote.last,
  regularMarketDayHigh: quote.high,
  regularMarketDayLow: quote.low,
  regularMarketChange: quote.change,
  regularMarketChangePercent: quote.changePercent,
  regularMarketVolume: quote.volume,
  bid: quote.bid,
  ask: quote.ask,
});

// Self-check: node src/models/stock-record.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: assert } = await import('node:assert/strict');
  const quote = { last: 59.95, open: 59.45, close: 59, high: 59.95, low: 59.15, change: 0.95,
    changePercent: 1.610169, volume: 5886552, bid: 59.9, ask: 59.95 };
  assert.ok(stockKey({ symbol: '2010.SR' }) === '2010_SR', 'key');
  const t = tickFields(quote);
  assert.ok(t.regularMarketPrice === 59.95 && t.regularMarketVolume === 5886552, 'tick fields are plain numbers');
  assert.ok(Object.values(t).every((v) => typeof v === 'number'), 'no wrappers on tick fields');
  assert.ok(dailyFields(quote).regularMarketOpen.fmt === '59.45', 'daily fields keep { raw, fmt }');
  console.log('stock-record OK');
}
