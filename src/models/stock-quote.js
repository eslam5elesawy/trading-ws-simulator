// Turns one raw provider tick ({ value, timestamp } objects) into our flat, clean quote.
// Returns null when the tick is unusable, so bad data never reaches clients or Firebase.
export function normalize(raw) {
  const last = raw?.last?.value;
  if (!raw?.requestedId || typeof last !== 'number') return null;

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
    updatedAt: Date.parse(raw.last.timestamp.replace(/(\.\d{3})\d+/, '$1')), // epoch ms; JS Date can't parse microseconds
  };
}

// Self-check: node src/models/stock-quote.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: assert } = await import('node:assert/strict');
  const { readFileSync } = await import('node:fs');
  const sample = JSON.parse(readFileSync(new URL('../provider/sample-tick.json', import.meta.url)));
  const q = normalize(sample);
  assert.ok(q.id === 'SA12A0540T12_503' && q.last === 27.5 && q.change === 1, 'fields');
  assert.ok(q.updatedAt === Date.parse('2026-11-11T14:04:28.000+03:00'), 'timestamp');
  assert.ok(normalize({}) === null && normalize({ requestedId: 'x' }) === null, 'rejects bad ticks');
  console.log('stock-quote OK');
}
