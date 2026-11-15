import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { DummyTradeProvider } from '../src/provider/dummy-trade-provider.js';
import { buildInstruments } from '../src/provider/instruments.js';

const ticksIn = async (provider, ms) => {
  const ticks = [];
  const on = (m) => ticks.push(m.data.startStream[0]);
  provider.on('message', on);
  await sleep(ms);
  provider.off('message', on);
  return ticks;
};

test('rejects an empty instrument list instead of crashing on the first tick', () => {
  assert.throws(() => new DummyTradeProvider([]), /at least one instrument/);
});

test('emits the requested rate, including low rates (review bug 3)', async () => {
  for (const rate of [1, 5, 50]) {
    const p = new DummyTradeProvider(buildInstruments([], 10));
    p.start(rate);
    const got = (await ticksIn(p, 2000)).length / 2;
    p.stop();
    assert.ok(Math.abs(got - rate) <= Math.max(1, rate * 0.15), `asked ${rate}/s, got ${got}/s`);
  }
});

test('prices stay within ±10% of the close, and a new session resets the day (review bug 7)', async () => {
  const instruments = buildInstruments([], 1);
  const close = instruments[0].close;
  const p = new DummyTradeProvider(instruments);
  p.start(5000);
  const ticks = await ticksIn(p, 1500);
  assert.ok(ticks.length > 1000);
  for (const t of ticks) assert.ok(t.last.value >= close * 0.9 - 0.01 && t.last.value <= close * 1.1 + 0.01, `${t.last.value} vs close ${close}`);

  let sessions = 0;
  p.on('session', () => sessions++);
  const lastPrice = ticks.at(-1).last.value;
  p.newSession();
  const [next] = await ticksIn(p, 300);
  p.stop();
  assert.equal(sessions, 1);
  assert.equal(next.type, 'START');
  assert.ok(Math.abs(next.close.value - lastPrice) < close * 0.01, 'close rolled forward to the last price');
  assert.ok(next.numberOfTrades.value < 1000, 'totals reset');
});

test('every stock gets a quote immediately on start (#7)', () => {
  const p = new DummyTradeProvider(buildInstruments([], 40));
  const ticks = [];
  p.on('message', (m) => ticks.push(...m.data.startStream));
  p.start(1);
  p.stop();
  assert.equal(new Set(ticks.map((t) => t.requestedId)).size, 40);
});

test('low-priced stocks still move (#34) and bids are never negative (#27)', async () => {
  const mk = (close) => [{ details: { isin: `L${close}` }, close }];
  const low = new DummyTradeProvider(mk(1.25));
  low.start(2000);
  const prices = new Set((await ticksIn(low, 1500)).map((t) => t.last.value));
  low.stop();
  assert.ok(prices.size > 1, `price never moved from 1.25: ${[...prices]}`);

  const tiny = new DummyTradeProvider(mk(0.01));
  tiny.start(500);
  const ticks = await ticksIn(tiny, 500);
  tiny.stop();
  for (const t of ticks) assert.ok(t.bestBid === null || t.bestBid.value > 0, `bid ${t.bestBid?.value}`);
});

test('raw ticks only carry fields built from the simulated stock (#28)', async () => {
  const p = new DummyTradeProvider([{ details: { isin: 'A' }, close: 12 }, { details: { isin: 'B' }, close: 80 }]);
  const ticks = [];
  p.on('message', (m) => ticks.push(...m.data.startStream));
  p.start(1);
  p.stop();
  for (const t of ticks) {
    assert.equal(t.marketCapitalisation, undefined, 'no inherited sample market cap');
    assert.notEqual(t.close.timestamp, '2026-11-10T15:20:00.000000+03:00', 'no inherited sample close date');
    const spread = t.bestAsk.value - t.bestBid.value;
    assert.ok(Math.abs(t.percentageSpreadBestBidAsk.value - (spread / t.last.value) * 100) < 1e-4, 'spread % matches bid/ask');
  }
});

test('sessions follow the clock: totals, range and open reset at the boundary (#20)', async () => {
  const p = new DummyTradeProvider(buildInstruments([], 1));
  let sessions = 0;
  p.on('session', () => sessions++);
  p.start(50, { sessionMinutes: 0.01 }); // 600 ms sessions
  const ticks = await ticksIn(p, 1500);
  p.stop();
  assert.ok(sessions >= 1, 'a session boundary passed');
  const starts = ticks.filter((t) => t.type === 'START');
  assert.ok(starts.length >= 1);
  for (const s of starts) assert.equal(s.numberOfTrades.value, 1, 'trade count restarts at 1');
});
