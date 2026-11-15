// Shared helpers for tests that start the real Node server (Firebase off) and talk to it.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

export const STOCKS = 300;
export const ROOT = join(import.meta.dirname, '../..');

export const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

export async function startServer(cwd, env = {}) {
  const port = await freePort();
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd,
    env: { ...process.env, PORT: String(port), STOCK_COUNT: String(STOCKS), TICKS_PER_SECOND: String(STOCKS), FIREBASE_DATABASE_URL: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => d.toString().includes('WS') && resolve());
    proc.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
  });
  return { port, proc };
}

export function connect(port, host = 'localhost') {
  const ws = new WebSocket(`ws://${host}:${port}/ws`);
  ws.messages = [];
  ws.on('message', (m) => ws.messages.push(JSON.parse(m)));
  ws.closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  return new Promise((resolve, reject) => ws.on('open', () => resolve(ws)).on('error', reject));
}

export async function waitFor(ws, pred) {
  for (let i = 0; i < 50; i++) {
    const found = ws.messages.find(pred);
    if (found) return found;
    await sleep(100);
  }
  throw new Error('expected message never arrived');
}

