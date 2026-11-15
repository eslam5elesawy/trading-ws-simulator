// Runs the real Cloudflare Worker locally (wrangler dev) and checks the Durable Object's behaviour.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { connect, waitFor, freePort, ROOT } from './helpers/server.js';

const WRANGLER = join(ROOT, 'node_modules/.bin/wrangler');
const STOCKS = 200;
let proc;
let base;

before(async () => {
  if (!existsSync(WRANGLER)) return;
  const data = join(ROOT, 'data/real-stocks.json');
  if (!existsSync(data)) writeFileSync(data, '[]'); // the Worker bundles this file
  const port = await freePort();
  base = `127.0.0.1:${port}`;
  proc = spawn(WRANGLER, ['dev', '--port', String(port), '--ip', '127.0.0.1', '--var', `STOCK_COUNT:${STOCKS}`, '--var', `TICKS_PER_SECOND:${STOCKS}`], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://${base}/health`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('wrangler dev did not start');
});
after(() => proc?.kill());

const health = async () => (await fetch(`http://${base}/health`)).json();

test('Worker: snapshot, batches, clean close, market stops when idle', { skip: !existsSync(WRANGLER) && 'wrangler not installed' }, async () => {
  const page = await fetch(`http://${base}/`);
  assert.equal(page.status, 200);

  const ws = await connect(base.split(':')[1], '127.0.0.1');
  const snapshot = await waitFor(ws, (m) => m.type === 'snapshot');
  assert.equal(snapshot.rows.length, STOCKS);
  assert.ok(snapshot.rows.every((r) => typeof r.price === 'number'), 'priced on first connect');
  assert.equal((await health()).running, true);

  const keys = snapshot.rows.slice(0, 3).map((r) => r.key);
  ws.send(JSON.stringify({ type: 'subscribe', keys }));
  const instant = await waitFor(ws, (m) => m.type === 'batch' && m.rows.length);
  assert.ok(instant.summary, 'instant batch has the summary');
  await sleep(1500);
  assert.ok(ws.messages.filter((m) => m.type === 'batch').flatMap((m) => m.rows).every((r) => keys.includes(r.key)));

  const started = Date.now();
  ws.close(1000);
  assert.equal(await ws.closed, 1000);
  assert.ok(Date.now() - started < 2000, 'close handshake completes promptly');
  await sleep(1500);
  assert.equal((await health()).running, false, 'market stops after the last client leaves');
});

test('Worker: oversized messages close the socket', { skip: !existsSync(WRANGLER) && 'wrangler not installed' }, async () => {
  const ws = await connect(base.split(':')[1], '127.0.0.1');
  ws.send('x'.repeat(20 * 1024));
  assert.equal(await ws.closed, 1009);
});
