import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBatchWriter } from '../src/services/firebase-writer.js';

const quiet = { error() {} };

test('one permanently rejected stock no longer blocks the others (#16)', async () => {
  const saved = {};
  const ref = {
    async update(paths) {
      if (Object.keys(paths).some((p) => p.startsWith('BAD/'))) throw new Error('permission denied');
      Object.assign(saved, paths);
    },
  };
  const w = createBatchWriter(ref, { log: quiet });
  w.update('BAD', { field: 1 });
  w.update('GOOD', { price: 1 });
  for (let i = 0; i < 4; i++) await w.flush();
  assert.equal(saved['GOOD/price'], 1);
  assert.equal(w.stats().pendingFields, 0);
  assert.equal(w.stats().dropped, 1);
});

test('a retried old value never overwrites a newer one', async () => {
  const saved = {};
  let fail = true;
  const ref = { async update(paths) { if (fail) throw new Error('offline'); Object.assign(saved, paths); } };
  const w = createBatchWriter(ref, { log: quiet });
  w.update('A', { price: 1 });
  await w.flush(); // fails, requeued
  w.update('A', { price: 2 }); // newer value queued meanwhile
  fail = false;
  await w.flush();
  assert.equal(saved['A/price'], 2);
});
