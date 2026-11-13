// End-to-end check of the WebSocket protocol: snapshot -> subscribe -> batches with only subscribed rows.
// Starts the real server on a spare port with Firebase off. Run: npm test
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const PORT = 18099;
const STOCKS = 300;
const server = spawn(process.execPath, ['src/server.js'], {
  env: { ...process.env, PORT: String(PORT), STOCK_COUNT: String(STOCKS), TICKS_PER_SECOND: String(STOCKS), FIREBASE_DATABASE_URL: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const fail = (err) => {
  server.kill();
  console.error('live-feed check FAILED:', err.message);
  process.exit(1);
};
setTimeout(() => fail(new Error('timed out')), 15000);

await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('WS') && resolve()));

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
const messages = [];
ws.on('message', (m) => messages.push(JSON.parse(m)));
await new Promise((resolve, reject) => ws.on('open', resolve).on('error', reject));

try {
  const waitFor = async (pred) => {
    for (let i = 0; i < 50; i++) {
      const found = messages.find(pred);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('expected message never arrived');
  };

  const snapshot = await waitFor((m) => m.type === 'snapshot');
  assert.equal(snapshot.rows.length, STOCKS, 'snapshot has every stock');
  assert.ok(snapshot.rows.every((r) => r.key && r.name && r.sector), 'rows carry key, name, sector');

  ws.send('not json'); // must be ignored, not crash the server
  ws.send(JSON.stringify({ type: 'subscribe', keys: ['NOPE', 42] })); // unknown keys dropped

  const keys = snapshot.rows.slice(0, 5).map((r) => r.key);
  ws.send(JSON.stringify({ type: 'subscribe', keys }));
  await new Promise((r) => setTimeout(r, 2500)); // let a couple of 1s batches pass

  const batches = messages.filter((m) => m.type === 'batch' && m.rows.length > 0);
  assert.ok(batches.length > 0, 'received batches after subscribing');
  const seen = new Set(batches.flatMap((b) => b.rows.map((r) => r.key)));
  assert.ok([...seen].every((k) => keys.includes(k)), 'batches only contain subscribed rows');
  assert.ok(batches.some((b) => b.summary?.active === STOCKS), 'batches carry the market summary');

  console.log(`live-feed OK (${batches.length} batches, ${seen.size} subscribed rows updated)`);
  ws.close();
  server.kill();
  process.exit(0);
} catch (err) {
  fail(err);
}
