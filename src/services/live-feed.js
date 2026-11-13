import { WebSocketServer, WebSocket } from 'ws';
import { createLiveFeedCore } from '../core/live-feed-core.js';

const BATCH_MS = 1000;
const MAX_BUFFERED_BYTES = 1_000_000; // a client this far behind is too slow; skip it rather than grow memory

// Node host for the live feed: a `ws` server at /ws on the given HTTP server. Protocol: see core/live-feed-core.js.
export function createLiveFeed(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const core = createLiveFeedCore();

  wss.on('connection', (socket) => {
    const client = core.addClient((msg) => {
      if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < MAX_BUFFERED_BYTES) socket.send(JSON.stringify(msg));
    });
    socket.on('message', (data) => client.receive(data.toString()));
    socket.on('close', () => client.remove());
  });

  setInterval(() => core.flush(), BATCH_MS);
  return core;
}
