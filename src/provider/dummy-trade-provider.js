import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { INSTRUMENTS as UNIVERSE } from './instruments.js';

const template = JSON.parse(readFileSync(new URL('./sample-tick.json', import.meta.url)));

// The trade provider only knows ids and prices, never names/sectors (that's the details provider's job).
const INSTRUMENTS = UNIVERSE.map((u) => ({ requestedId: u.details.isin, close: u.close }));

const round = (n, d = 2) => Number(n.toFixed(d));

// Same format as the real feed: 2026-11-11T14:04:28.000000+03:00 (Riyadh time)
function riyadhTimestamp(date = new Date()) {
  const local = new Date(date.getTime() + 3 * 3600_000).toISOString(); // shift UTC -> +03:00
  return local.replace('Z', '000+03:00');
}

export class DummyTradeProvider extends EventEmitter {
  #state = new Map(); // requestedId -> latest tick we sent
  #timer;

  start(ticksPerSecond = 50) {
    // Timers can't fire 1000s of times a second, so emit a burst every 100ms instead.
    // Round-robin, not random: at ticksPerSecond = stock count, every stock ticks exactly once a second.
    const perBurst = Math.max(1, Math.round(ticksPerSecond / 10));
    let cursor = 0;
    this.#timer = setInterval(() => {
      for (let i = 0; i < perBurst; i++) {
        const inst = INSTRUMENTS[cursor++ % INSTRUMENTS.length];
        this.emit('message', { data: { startStream: [this.#nextTick(inst)] } });
      }
    }, 100);
  }

  stop() {
    clearInterval(this.#timer);
  }

  #nextTick({ requestedId, close }) {
    const prev = this.#state.get(requestedId);
    const ts = riyadhTimestamp();
    const at = (value, extra = {}) => ({ value, ...extra, timestamp: ts });

    // Random walk: move up to ±0.3% from the previous last price.
    const prevLast = prev ? prev.last.value : close;
    const last = round(prevLast * (1 + (Math.random() - 0.5) * 0.006));
    const size = 1 + Math.floor(Math.random() * 1000);
    const netChange = round(last - close);
    const pct = round((netChange / close) * 100, 6);
    const high = Math.max(prev?.high.value ?? close, last); // day range always includes the open (= close here)
    const low = Math.min(prev?.low.value ?? close, last);
    const spread = 0.02;

    const tick = {
      ...structuredClone(prev ?? template),
      streamId: prev?.streamId ?? randomUUID(),
      type: prev ? 'UPDATE' : 'START', // shortcut: 'UPDATE' is a guess at the real feed's follow-up type, confirm with a real stream
      requestedId,
      close: { value: close, timestamp: template.close.timestamp },
      open: prev?.open ?? at(close),
      last: at(last),
      reportedPrice: at(last, { size }),
      high: high === prev?.high.value ? prev.high : at(high, { size }),
      low: low === prev?.low.value ? prev.low : at(low, { size }),
      volumeTotal: at((prev?.volumeTotal.value ?? 0) + size),
      turnoverTotal: at(round((prev?.turnoverTotal.value ?? 0) + size * last)),
      numberOfTrades: at((prev?.numberOfTrades.value ?? 0) + 1),
      netChangeLast: at(netChange),
      percentageChangeLast: at(pct),
      bestBid: at(round(last - spread), { size: 1 + Math.floor(Math.random() * 2000) }),
      bestAsk: at(last, { size: 1 + Math.floor(Math.random() * 2000) }),
      spreadBestBidAsk: at(spread),
      valuationPrice: at(last),
      netChangeValuationPrice: at(netChange),
      percentageChangeValuationPrice: at(pct),
    };
    this.#state.set(requestedId, tick);
    return tick;
  }
}

// Run directly to watch the raw feed: node src/provider/dummy-trade-provider.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const p = new DummyTradeProvider();
  p.on('message', (msg) => {
    const t = msg.data.startStream[0];
    console.log(t.type, t.requestedId, t.last.value, t.percentageChangeLast.value + '%', t.last.timestamp);
  });
  p.start(5);
  setTimeout(() => p.stop(), 2000);
}
