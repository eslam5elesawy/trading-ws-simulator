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
