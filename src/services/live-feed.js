import { WebSocketServer, WebSocket } from 'ws';

const BATCH_MS = 1000;
const MAX_SUBSCRIBED = 500; // a screen shows a few dozen rows; cap protects the server from huge requests
const MAX_BUFFERED_BYTES = 1_000_000; // a client this far behind is too slow; skip it rather than grow memory

// WebSocket at /ws. Protocol:
//   server -> client  { type: 'snapshot', rows: [...all stocks] }        once, on connect
//   client -> server  { type: 'subscribe', keys: ['1010_SR', ...] }     whenever the visible rows change
//   server -> client  { type: 'batch', rows: [...changed & subscribed], summary }   every second
export function createLiveFeed(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const rows = new Map(); // key -> latest row
  const dirty = new Set(); // keys changed since the last batch
  const subs = new WeakMap(); // socket -> Set of subscribed keys

  const live = (r) => ({ key: r.key, price: r.price, change: r.change, changePercent: r.changePercent, volume: r.volume, bid: r.bid });
  const send = (socket, msg) => {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < MAX_BUFFERED_BYTES) socket.send(JSON.stringify(msg));
  };

  function summary() {
    let gainers = 0;
    let losers = 0;
    let totalVolume = 0;
    let marketCap = 0;
    for (const r of rows.values()) {
      if (r.change > 0) gainers++;
      else if (r.change < 0) losers++;
      totalVolume += r.volume ?? 0;
      marketCap += r.marketCap ?? 0;
    }
    return { gainers, losers, totalVolume, marketCap, active: rows.size };
  }

  wss.on('connection', (socket) => {
    subs.set(socket, new Set());
    send(socket, { type: 'snapshot', rows: [...rows.values()], summary: summary() });

    socket.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return; // ignore garbage from clients
      }
      if (msg?.type !== 'subscribe' || !Array.isArray(msg.keys)) return;
      const keys = msg.keys.slice(0, MAX_SUBSCRIBED).filter((k) => typeof k === 'string' && rows.has(k));
      const previous = subs.get(socket);
      subs.set(socket, new Set(keys));
      // Rows that just scrolled into view get their current values now, not at the next batch.
      const added = keys.filter((k) => !previous.has(k)).map((k) => live(rows.get(k)));
      if (added.length) send(socket, { type: 'batch', rows: added });
    });
  });

  setInterval(() => {
    if (dirty.size === 0) return;
    const sum = summary();
    for (const socket of wss.clients) {
      const changed = [];
      for (const key of subs.get(socket) ?? []) if (dirty.has(key)) changed.push(live(rows.get(key)));
      send(socket, { type: 'batch', rows: changed, summary: sum });
    }
    dirty.clear();
  }, BATCH_MS);

  return {
    setStatic(key, fields) {
      rows.set(key, { ...rows.get(key), key, ...fields });
    },
    setLive(key, fields) {
      const row = rows.get(key);
      if (!row) return;
      Object.assign(row, fields);
      dirty.add(key);
    },
    stats: () => ({ clients: wss.clients.size, stocks: rows.size, subscribedPerClient: [...wss.clients].map((s) => subs.get(s)?.size ?? 0) }),
  };
}
