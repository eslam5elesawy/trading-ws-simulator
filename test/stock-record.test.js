import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockKey, tickFields, dailyFields } from '../src/models/stock-record.js';

const quote = { last: 59.95, open: 59.45, close: 59, high: 59.95, low: 59.15, change: 0.95,
  changePercent: 1.610169, volume: 5886552, bid: 59.9, ask: 59.95 };

test('stock key matches the app format', () => assert.equal(stockKey({ symbol: '2010.SR' }), '2010_SR'));

test('tick fields are plain numbers, daily fields keep { raw, fmt }', () => {
  const t = tickFields(quote);
  assert.equal(t.regularMarketPrice, 59.95);
  assert.ok(Object.values(t).every((v) => typeof v === 'number'));
  assert.equal(dailyFields(quote).regularMarketOpen.fmt, '59.45');
});
