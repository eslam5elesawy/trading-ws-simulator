// Transport-free live feed: rows, subscriptions and per-second batches.
// Hosts (Node `ws` server, Cloudflare Durable Object) plug in a send function per client and call flush() every second.
//
// Protocol:
//   server -> client  { type: 'snapshot', rows: [...all stocks], summary }  once, on connect
//   client -> server  { type: 'subscribe', keys: ['1010_SR', ...] }       whenever the visible rows change
//   server -> client  { type: 'batch', rows: [...changed & subscribed], summary }   every second, and right after a
//                     subscribe for rows that just came into view (same shape)
//   client -> server  { type: 'ping' }                                   keep-alive (hosts without protocol pings)

const MAX_SUBSCRIBED = 500; // a screen shows a few dozen rows; cap protects the server from huge requests
export const MAX_MESSAGE_BYTES = 16 * 1024; // a 500-key subscribe is a few KB
const SUBSCRIBES_PER_SECOND = 5; // scrolling sends one per settle; more than this is spam and is ignored

export function createLiveFeedCore() {
  const rows = new Map(); // key -> latest row
  const dirty = new Set(); // keys changed since the last batch
  const clients = new Map(); // client id -> { send, close, subs, lastSeen, subscribe rate window }
  let nextId = 1;

  const live = (r) => ({ key: r.key, price: r.price, change: r.change, changePercent: r.changePercent, volume: r.volume, bid: r.bid });

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

  return {
    /**
     * @param send (msgObject) => boolean|void; return false when the message was not delivered (e.g. the client is
     *   too far behind). The client then gets every subscribed row in its next delivered batch, so a skipped
     *   update can't leave it showing an old price. Must not throw for a dead client.
     * @param close () => void; the host closes the socket (used for idle clients)
     */
    addClient(send, close = () => {}) {
      const id = nextId++;
      const client = { send, close, subs: new Set(), lastSeen: Date.now(), windowStart: 0, windowCount: 0, resync: false };
      clients.set(id, client);
      send({ type: 'snapshot', rows: [...rows.values()], summary: summary() });

      return {
        receive(text) {
          client.lastSeen = Date.now();
          if (typeof text !== 'string' || text.length > MAX_MESSAGE_BYTES) return;
          let msg;
          try {
            msg = JSON.parse(text);
          } catch {
            return; // ignore garbage from clients
          }
          if (msg?.type !== 'subscribe' || !Array.isArray(msg.keys)) return; // 'ping' only refreshes lastSeen

          const now = Date.now();
          if (now - client.windowStart >= 1000) {
            client.windowStart = now;
            client.windowCount = 0;
          }
          if (++client.windowCount > SUBSCRIBES_PER_SECOND) return;

          const keys = [...new Set(msg.keys)].filter((k) => typeof k === 'string' && rows.has(k)).slice(0, MAX_SUBSCRIBED);
          const previous = client.subs;
          client.subs = new Set(keys);
          // Rows that just scrolled into view get their current values now, not at the next batch.
          const added = keys.filter((k) => !previous.has(k)).map((k) => live(rows.get(k)));
          if (added.length && send({ type: 'batch', rows: added, summary: summary() }) === false) client.resync = true;
        },
        remove() {
          clients.delete(id);
        },
      };
    },

    /** Call once a second: sends each client only its changed, subscribed rows. */
    flush() {
      if (dirty.size === 0) return;
      const sum = summary();
      for (const client of clients.values()) {
        const changed = [];
        for (const key of client.subs) if (client.resync || dirty.has(key)) changed.push(live(rows.get(key)));
        client.resync = client.send({ type: 'batch', rows: changed, summary: sum }) === false;
      }
      dirty.clear();
    },

    setStatic(key, fields) {
      rows.set(key, { ...rows.get(key), key, ...fields });
    },

    setLive(key, fields) {
      const row = rows.get(key);
      if (!row) return;
      Object.assign(row, fields);
      dirty.add(key);
    },

    /** Closes clients that sent nothing (not even a ping) for `maxIdleMs`; for hosts without protocol pings. */
    closeIdle(maxIdleMs) {
      const cutoff = Date.now() - maxIdleMs;
      for (const [id, c] of clients) {
        if (c.lastSeen >= cutoff) continue;
        clients.delete(id);
        c.close();
      }
    },

    clientCount: () => clients.size,
    stats: () => ({ clients: clients.size, stocks: rows.size, subscribedPerClient: [...clients.values()].map((c) => c.subs.size) }),
  };
}
