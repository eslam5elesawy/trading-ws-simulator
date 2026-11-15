import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/models/stock-quote.js';
import sample from '../src/provider/sample-tick.json' with { type: 'json' };

test('normalizes the sample tick', () => {
  const q = normalize(sample);
  assert.equal(q.id, 'SA12A0540T12_503');
  assert.equal(q.last, 27.5);
  assert.equal(q.change, 1);
  assert.equal(q.updatedAt, Date.parse('2026-11-11T14:04:28.000+03:00'));
});

test('returns null (never throws) for unusable ticks', () => {
  const ts = '2026-11-11T14:04:28.000000+03:00';
  for (const bad of [
    undefined, {}, { requestedId: 'x' },
    { requestedId: 'x', last: { value: 1 } }, // missing timestamp used to throw (review bug 1)
    { requestedId: 'x', last: { value: NaN, timestamp: ts } },
    { requestedId: 'x', last: { value: -5, timestamp: ts } },
    { requestedId: 'x', last: { value: 0, timestamp: ts } },
    { requestedId: 'x', last: { value: 5, timestamp: 'not a date' } },
    { requestedId: 'x', last: { value: 5, timestamp: 12345 } },
  ]) {
    assert.equal(normalize(bad), null, JSON.stringify(bad));
  }
});
