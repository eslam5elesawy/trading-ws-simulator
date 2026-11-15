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
const SPREAD = 0.02; // SAR between best bid and best ask
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

export class DummyTradeProvider extends EventEmitter {
  #state = new Map(); // requestedId -> this session's state for that stock (precise price, day range, totals)
  #timer;
  #instruments;
  #sessionMs = 480 * 60_000;
  #session = -1; // index of the current trading session: floor(now / sessionMs)
  #sessionStartTs;

  /** @param universe instruments from buildInstruments(); only ids and prices are used here */
  constructor(universe) {
    super();
    if (!universe?.length) throw new Error('DummyTradeProvider needs at least one instrument');
    // The trade provider only knows ids and prices, never names/sectors (that's the details provider's job).
    this.#instruments = universe.map((u) => ({ requestedId: u.details.isin, close: u.close }));
  }

  /**
   * @param ticksPerSecond total ticks per second across all instruments
   * @param sessionMinutes length of a simulated trading day. Sessions follow the clock (floor(now / length)),
   *   so every host agrees on the boundary even if it was stopped in between.
   */
  start(ticksPerSecond, { sessionMinutes = 480 } = {}) {
    this.stop();
    this.#sessionMs = sessionMinutes * 60_000;
    this.#checkSession();
    // One quote for every stock right away, so the first snapshot already has prices.
    this.emit('message', { data: { startStream: this.#instruments.map((inst) => this.#nextTick(inst)) } });

    // Timers can't fire 1000s of times a second, so emit a burst every 100ms, sized by the real elapsed time
    // (carrying the fraction), so low rates are exact and timer lag doesn't lose ticks.
    // Round-robin, not random: at ticksPerSecond = stock count, every stock ticks once a second.
    let cursor = 0;
    let last = performance.now();
    let owed = 0;
    this.#timer = setInterval(() => {
      this.#checkSession();
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
  }

  stop() {
    clearInterval(this.#timer);
  }

  #checkSession() {
    const session = Math.floor(Date.now() / this.#sessionMs);
    if (session === this.#session) return;
    const first = this.#session === -1;
    this.#session = session;
    if (!first) this.newSession();
    this.#sessionStartTs = riyadhTimestamp(new Date(session * this.#sessionMs)); // the boundary, not "now"
  }

  /** Starts a new trading day: today's last price becomes the close; day range and totals reset. */
  newSession() {
    for (const inst of this.#instruments) {
      const st = this.#state.get(inst.requestedId);
      if (st) inst.close = round(st.price);
    }
    this.#state.clear();
    this.#sessionStartTs = riyadhTimestamp();
    this.emit('session');
  }

  // Builds the raw tick from this stock's own state (no copying of the sample stock's other fields).
  // Fields the simulator doesn't model (52-week range, market cap, dividends...) are left out.
  #nextTick(inst) {
    const { requestedId, close } = inst;
    const ts = riyadhTimestamp();
    const at = (value, extra = {}) => ({ value, ...extra, timestamp: ts });
    let st = this.#state.get(requestedId);
    const isNew = !st;
    if (isNew) {
      st = { streamId: crypto.randomUUID(), price: close, open: null, high: null, low: null, volume: 0, turnover: 0, trades: 0 };
      this.#state.set(requestedId, st);
    }

    // Random walk on the full-precision price (so low-priced stocks still move), within the daily limit.
    st.price = Math.min(close * (1 + DAILY_LIMIT), Math.max(close * (1 - DAILY_LIMIT), st.price * (1 + (Math.random() - 0.5) * 0.006)));
    const last = round(st.price);
    const size = rand(1, 1000);
    st.open ??= at(last);
    if (!st.high || last > st.high.value) st.high = at(last, { size });
    if (!st.low || last < st.low.value) st.low = at(last, { size });
    st.volume += size;
    st.turnover = round(st.turnover + size * last);
    st.trades += 1;

    const netChange = round(last - close);
    const pct = round((netChange / close) * 100, 6);
    const bid = last > SPREAD ? round(last - SPREAD) : null; // no bid below the minimum price, never negative
    const spread = bid === null ? null : round(last - bid);

    return {
      streamId: st.streamId,
      type: isNew ? 'START' : 'UPDATE', // shortcut: 'UPDATE' is a guess at the real feed's follow-up type, confirm with a real stream
      requestedId,
      requestedScheme: template.requestedScheme,
      qualityOfService: template.qualityOfService,
      open: st.open,
      close: { value: close, timestamp: this.#sessionStartTs },
      last: at(last),
      reportedPrice: at(last, { size }),
      high: st.high,
      low: st.low,
      volumeTotal: at(st.volume),
      turnoverTotal: at(st.turnover),
      numberOfTrades: at(st.trades),
      vwap: at(round(st.turnover / st.volume, 6)),
      netChangeLast: at(netChange),
      percentageChangeLast: at(pct),
      bestBid: bid === null ? null : at(bid, { size: rand(1, 2000) }),
      bestAsk: at(last, { size: rand(1, 2000) }),
      spreadBestBidAsk: spread === null ? null : at(spread),
      percentageSpreadBestBidAsk: spread === null ? null : at(round((spread / last) * 100, 6)),
      valuationPrice: at(last),
      netChangeValuationPrice: at(netChange),
      percentageChangeValuationPrice: at(pct),
    };
  }
}
