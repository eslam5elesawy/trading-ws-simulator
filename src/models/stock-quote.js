// Turns one raw provider tick ({ value, timestamp } objects) into our flat, clean quote.
// Returns null when the tick is unusable, so bad data never reaches clients or Firebase and never throws.
export function normalize(raw) {
  const last = raw?.last?.value;
  const ts = raw?.last?.timestamp;
  if (!raw?.requestedId || !Number.isFinite(last) || last <= 0 || typeof ts !== 'string') return null;
  const updatedAt = Date.parse(ts.replace(/(\.\d{3})\d+/, '$1')); // epoch ms; JS Date can't parse microseconds
  if (Number.isNaN(updatedAt)) return null;

  return {
    id: raw.requestedId,
    last,
    open: raw.open?.value ?? null,
    close: raw.close?.value ?? null,
    high: raw.high?.value ?? null,
    low: raw.low?.value ?? null,
    change: raw.netChangeLast?.value ?? null,
    changePercent: raw.percentageChangeLast?.value ?? null,
    volume: raw.volumeTotal?.value ?? null,
    turnover: raw.turnoverTotal?.value ?? null,
    bid: raw.bestBid?.value ?? null,
    ask: raw.bestAsk?.value ?? null,
    trades: raw.numberOfTrades?.value ?? null,
    updatedAt,
  };
}
