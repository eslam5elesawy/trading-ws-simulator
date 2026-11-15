import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReferenceStocks, toNumber } from '../src/provider/reference-data.js';
import { staticRow } from '../src/core/market.js';
import { buildInstruments } from '../src/provider/instruments.js';
import pkg from '../package.json' with { type: 'json' };

test('prices in either representation, with fallback to the last price (#2)', () => {
  const { stocks } = parseReferenceStocks({
    a: { symbol: '1111.SR', regularMarketPreviousClose: { raw: 23.5 } },
    b: { symbol: '2222.SR', regularMarketPreviousClose: 35.75 },
    c: { symbol: '3333.SR', regularMarketPrice: 44.15 },
    d: { symbol: '4444.SR', regularMarketPreviousClose: { raw: 0 }, regularMarketPrice: { raw: 19.25 } },
  });
  assert.deepEqual(stocks.map((s) => [s.details.symbol, s.close]), [['1111.SR', 23.5], ['2222.SR', 35.75], ['3333.SR', 44.15], ['4444.SR', 19.25]]);
});

test('duplicate symbols keep the first and are reported (#3)', () => {
  const { stocks, duplicates } = parseReferenceStocks({
    a: { symbol: '1111.SR', isin: 'A', regularMarketPrice: 10 },
    b: { symbol: '1111.SR', isin: 'B', regularMarketPrice: 20 },
  });
  assert.equal(stocks.length, 1);
  assert.equal(stocks[0].close, 10);
  assert.equal(duplicates.length, 1);
});

test('non-object responses are rejected instead of saved as empty (#19)', () => {
  for (const bad of [null, 12, 'x', []]) assert.throws(() => parseReferenceStocks(bad), /Expected an object/);
});

test('non-text metadata is dropped, so rows still render (#30)', () => {
  const { stocks } = parseReferenceStocks({ a: { symbol: '1111.SR', kwealth_sector: 123, shortName: { x: 1 }, regularMarketPrice: 5 } });
  assert.equal(stocks[0].details.kwealth_sector, undefined);
  const row = staticRow(stocks[0].details);
  assert.equal(row.sector, '--');
  assert.equal(row.name, '1111.SR');
});

test('market cap is always a number or null (#31)', () => {
  assert.equal(toNumber({ raw: 10000 }), 10000);
  assert.equal(toNumber({ raw: '12000' }), 12000);
  assert.equal(toNumber(4000), 4000);
  assert.equal(toNumber({ raw: 'abc' }), null);
  const caps = [{ raw: 10000 }, { raw: '12000' }, 4000, { raw: 'bad' }].map((m) => staticRow({ symbol: 'X.SR', marketCap: m }).marketCap);
  assert.deepEqual(caps, [10000, 12000, 4000, null]);
  assert.equal(caps.reduce((a, b) => a + (b ?? 0), 0), 26000);
});

test('STOCK_COUNT is the exact total (#23)', () => {
  const real = [1, 2, 3].map((i) => ({ details: { symbol: `${1110 + i}.SR`, isin: `I${i}`, kwealth_sector: 'BANKS' }, close: 10 }));
  assert.equal(buildInstruments(real, 2).length, 2);
  assert.equal(buildInstruments(real, 5).length, 5);
});

// Runs the importer the way `npm run fetch-real` does, against a local fixture server.
async function runImporter(body, { envFile } = {}) {
  const server = createServer((req, res) => res.end(body)).listen(0);
  await new Promise((r) => server.once('listening', r));
  const url = `http://localhost:${server.address().port}/stocks.json`;
  const dir = mkdtempSync(join(tmpdir(), 'tws-import-'));
  const out = join(dir, 'real-stocks.json');
  writeFileSync(out, '"previous snapshot"');
  if (envFile) writeFileSync(join(dir, '.env'), `REAL_STOCKS_URL=${url}\n`);
  const env = { ...process.env, REAL_STOCKS_OUT: out };
  delete env.REAL_STOCKS_URL;
  if (!envFile) env.REAL_STOCKS_URL = url;
  const proc = spawn(process.execPath, ['--env-file-if-exists=.env', join(import.meta.dirname, '../scripts/fetch-real-stocks.js')], { cwd: dir, env, stdio: 'pipe' });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));
  const code = await new Promise((r) => proc.on('exit', r));
  server.close();
  return { code, stderr, saved: readFileSync(out, 'utf8') };
}

test('importer keeps the last snapshot on bad or empty responses (#19)', async () => {
  for (const body of ['null', '12', '{}']) {
    const r = await runImporter(body);
    assert.equal(r.code, 1, body);
    assert.equal(r.saved, '"previous snapshot"', body);
  }
});

test('importer reads REAL_STOCKS_URL from .env, as npm run fetch-real does (#18)', async () => {
  assert.match(pkg.scripts['fetch-real'], /--env-file-if-exists=\.env/);
  const r = await runImporter(JSON.stringify({ a: { symbol: '1111.SR', regularMarketPrice: 5 } }), { envFile: true });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.saved).length, 1);
});
