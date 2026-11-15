import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFeedCore } from '../src/core/live-feed-core.js';

function feedWith(n) {
  const core = createLiveFeedCore();
  for (let i = 0; i < n; i++) {
    core.setStatic(`K${i}`, { symbol: `S${i}` });
    core.setLive(`K${i}`, { price: 10 });
  }
  core.flush(); // clear dirty
  return core;
}

test('duplicates are removed before the 500 cap, so they cost no coverage (#21)', () => {
  const core = feedWith(600);
  const sent = [];
  const c = core.addClient((m) => sent.push(m));
  const keys = Array.from({ length: 500 }, (_, i) => `K${i}`);
  c.receive(JSON.stringify({ type: 'subscribe', keys: [...keys, ...keys.slice(0, 20)] }));
  assert.equal(core.stats().subscribedPerClient[0], 500);
  assert.equal(sent.at(-1).rows.length, 500);
});

test('the instant batch after subscribing includes the summary (#22)', () => {
  const core = feedWith(3);
  const sent = [];
  const c = core.addClient((m) => sent.push(m));
  c.receive(JSON.stringify({ type: 'subscribe', keys: ['K0'] }));
  assert.equal(sent.at(-1).type, 'batch');
  assert.equal(sent.at(-1).summary.active, 3);
});

test('a skipped batch is recovered: the next delivered batch has every subscribed row (#17)', () => {
  const core = feedWith(3);
  const sent = [];
  let deliver = true;
  const c = core.addClient((m) => (deliver ? (sent.push(m), true) : false));
  c.receive(JSON.stringify({ type: 'subscribe', keys: ['K0', 'K1'] }));

  deliver = false; // client too far behind
  core.setLive('K0', { price: 16 });
  core.flush();

  deliver = true; // caught up; only K2 (not subscribed) ticks
  core.setLive('K2', { price: 11 });
  core.flush();
  const last = sent.at(-1);
  assert.deepEqual(last.rows.map((r) => [r.key, r.price]).sort(), [['K0', 16], ['K1', 10]]);
});
