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
