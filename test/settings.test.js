import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSettings } from '../src/core/settings.js';

test('defaults when unset or empty', () => {
  const s = readSettings({ STOCK_COUNT: '', TICKS_PER_SECOND: '' });
  assert.equal(s.stockCount, 3000);
  assert.equal(s.ticksPerSecond, 3000);
  assert.equal(s.port, 8080);
});

test('bad values fail at startup with a clear message (review bug 2)', () => {
  for (const env of [{ STOCK_COUNT: '0' }, { STOCK_COUNT: 'abc' }, { TICKS_PER_SECOND: '-1' }, { PORT: '70000' }, { PORT: '8.5' }]) {
    assert.throws(() => readSettings(env), /Invalid/, JSON.stringify(env));
  }
});
