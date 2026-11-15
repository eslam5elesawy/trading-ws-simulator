import { EventEmitter } from 'node:events';
import template from './sample-tick.json' with { type: 'json' };

const round = (n, d = 2) => Number(n.toFixed(d));

// Same format as the real feed: 2026-11-11T14:04:28.000000+03:00 (Riyadh time)
function riyadhTimestamp(date = new Date()) {
  const local = new Date(date.getTime() + 3 * 3600_000).toISOString(); // shift UTC -> +03:00
  return local.replace('Z', '000+03:00');
}

const DAILY_LIMIT = 0.1; // Tadawul main market: price can move at most ±10% from the previous close in a day
const MAX_OWED_SECONDS = 1; // after a long pause, catch up at most one second of ticks, not one huge burst

export class DummyTradeProvider extends EventEmitter {
  #state = new Map(); // requestedId -> latest tick we sent (this trading session)
  #timer;
  #sessionTimer;
  #instruments;

  /** @param universe instruments from buildInstruments(); only ids and prices are used here */
  constructor(universe) {
    super();
    if (!universe?.length) throw new Error('DummyTradeProvider needs at least one instrument');
    // The trade provider only knows ids and prices, never names/sectors (that's the details provider's job).
    this.#instruments = universe.map((u) => ({ requestedId: u.details.isin, close: u.close }));
  }

  /**
   * @param ticksPerSecond total ticks per second across all instruments
   * @param sessionMinutes length of a simulated trading day; then closes roll forward and totals reset
   */
  start(ticksPerSecond, { sessionMinutes = 480 } = {}) {
    this.stop();
    // Timers can't fire 1000s of times a second, so emit a burst every 100ms, sized by the real elapsed time
    // (carrying the fraction), so low rates are exact and timer lag doesn't lose ticks.
    // Round-robin, not random: at ticksPerSecond = stock count, every stock ticks once a second.
    let cursor = 0;
    let last = performance.now();
    let owed = 0;
    this.#timer = setInterval(() => {
      const now = performance.now();
      owed = Math.min(owed + ((now - last) / 1000) * ticksPerSecond, ticksPerSecond * MAX_OWED_SECONDS);
      last = now;
      const n = Math.floor(owed);
      owed -= n;
      for (let i = 0; i < n; i++) {
        const inst = this.#instruments[cursor++ % this.#instruments.length];
        this.emit('message', { data: { startStream: [this.#nextTick(inst)] } });
      }
    }, 100);
    this.#sessionTimer = setInterval(() => this.newSession(), sessionMinutes * 60_000);
  }

  stop() {
    clearInterval(this.#timer);
    clearInterval(this.#sessionTimer);
  }

  /** Starts a new trading day: today's last price becomes the close, totals and day range reset. */
  newSession() {
    for (const inst of this.#instruments) {
      const prev = this.#state.get(inst.requestedId);
      if (prev) inst.close = prev.last.value;
    }
    this.#state.clear();
    this.emit('session');
  }

  #nextTick({ requestedId, close }) {
    const prev = this.#state.get(requestedId);
    const ts = riyadhTimestamp();
    const at = (value, extra = {}) => ({ value, ...extra, timestamp: ts });

    // Random walk: move up to ±0.3% from the previous last price, within the daily limit.
    const prevLast = prev ? prev.last.value : close;
    const walked = prevLast * (1 + (Math.random() - 0.5) * 0.006);
    const last = round(Math.min(close * (1 + DAILY_LIMIT), Math.max(close * (1 - DAILY_LIMIT), walked)));
    const size = 1 + Math.floor(Math.random() * 1000);
    const netChange = round(last - close);
    const pct = round((netChange / close) * 100, 6);
    const high = Math.max(prev?.high.value ?? close, last); // day range always includes the open (= close here)
    const low = Math.min(prev?.low.value ?? close, last);
    const spread = 0.02;

    const tick = {
      ...structuredClone(prev ?? template),
      streamId: prev?.streamId ?? crypto.randomUUID(),
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

