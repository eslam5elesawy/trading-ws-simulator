import { WebSocketServer, WebSocket } from 'ws';
import { createLiveFeedCore, MAX_MESSAGE_BYTES } from '../core/live-feed-core.js';

const BATCH_MS = 1000;
const HEARTBEAT_MS = 30_000; // ping everyone; anyone who didn't pong since the last round is gone
const MAX_BUFFERED_BYTES = 1_000_000; // a client this far behind is too slow...
const MAX_SLOW_MS = 10_000; // ...and is disconnected if it stays behind this long

// Node host for the live feed: a `ws` server at /ws on the given HTTP server. Protocol: see core/live-feed-core.js.
export function createLiveFeed(httpServer, { maxClients }) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
  const core = createLiveFeedCore();

  wss.on('connection', (socket) => {
    if (wss.clients.size > maxClients) {
      socket.close(1013, 'Server busy, try again later'); // 1013 = try again later
      return;
    }
    socket.isAlive = true;
    socket.on('pong', () => (socket.isAlive = true));

    let slowSince = 0;
    const client = core.addClient(
      (text) => {
        if (socket.readyState !== WebSocket.OPEN) return false;
        if (socket.bufferedAmount >= MAX_BUFFERED_BYTES) {
          slowSince ||= Date.now();
          if (Date.now() - slowSince > MAX_SLOW_MS) socket.terminate();
          return false; // skipped: the core resends all subscribed rows once this client catches up
        }
        slowSince = 0;
        socket.send(text);
        return true;
      },
      () => socket.terminate(),
    );
    socket.on('message', (data) => client.receive(data.toString()));
    socket.on('close', () => client.remove());
  });

  const batches = setInterval(() => core.flush(), BATCH_MS);
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate(); // no pong since the last ping: half-open connection
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);

  return {
    ...core,
    close() {
      clearInterval(batches);
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.close(1001, 'Server shutting down');
      wss.close();
    },
  };
}
