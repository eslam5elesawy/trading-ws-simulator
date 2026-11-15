// End-to-end: starts the real Node server (Firebase off) and talks to it over HTTP and WebSocket.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer, connect, waitFor, ROOT, STOCKS } from './helpers/server.js';


let server;
before(async () => { server = await startServer(ROOT); });
after(() => server.proc.kill());

test('snapshot, then batches with only subscribed rows', async () => {
  const ws = await connect(server.port);
  const snapshot = await waitFor(ws, (m) => m.type === 'snapshot');
  assert.equal(snapshot.rows.length, STOCKS);
  assert.ok(snapshot.rows.every((r) => typeof r.price === 'number'), 'every stock already has a price (#7)');

  ws.send('not json'); // ignored, not fatal
  const keys = snapshot.rows.slice(0, 5).map((r) => r.key);
  ws.send(JSON.stringify({ type: 'subscribe', keys }));
  await sleep(2500);
  const batches = ws.messages.filter((m) => m.type === 'batch' && m.rows.length);
  assert.ok(batches.length > 0);
  assert.ok(batches.flatMap((b) => b.rows).every((r) => keys.includes(r.key)));
  assert.ok(batches.some((b) => b.summary?.active === STOCKS));
  ws.close();
});

test('duplicate keys are counted once (review bug 5)', async () => {
  const ws = await connect(server.port);
  const snapshot = await waitFor(ws, (m) => m.type === 'snapshot');
  ws.send(JSON.stringify({ type: 'subscribe', keys: Array(500).fill(snapshot.rows[0].key) }));
  const first = await waitFor(ws, (m) => m.type === 'batch' && m.rows.length);
  assert.equal(first.rows.length, 1);
  ws.close();
});

test('oversized messages close the socket (review bug 5)', async () => {
  const ws = await connect(server.port);
  ws.send('x'.repeat(50 * 1024));
  assert.equal(await ws.closed, 1009); // 1009 = message too big
});

test('clients over MAX_CLIENTS are turned away (review bug 5)', async () => {
  const small = await startServer(ROOT, { MAX_CLIENTS: '1' });
  try {
    const a = await connect(small.port);
    const b = await connect(small.port);
    assert.equal(await b.closed, 1013); // 1013 = try again later
    a.close();
  } finally {
    small.proc.kill();
  }
});

test('invalid settings stop the server at startup (review bug 2)', async () => {
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, STOCK_COUNT: 'abc' }, stdio: 'pipe' });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));
  const code = await new Promise((resolve) => proc.on('exit', resolve));
  assert.notEqual(code, 0);
  assert.match(stderr, /Invalid STOCK_COUNT/);
});

test('the page is served from a folder with a space in its path (review bug 4)', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'tws-')), 'my repo');
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
  cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  const spaced = await startServer(dir);
  try {
    const res = await fetch(`http://localhost:${spaced.port}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Saudi Stocks Overview/);
  } finally {
    spaced.proc.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
