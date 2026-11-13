// Transport-free live feed: rows, subscriptions and per-second batches.
// Hosts (Node `ws` server, Cloudflare Durable Object) plug in a send function per client and call flush() every second.
//
// Protocol:
//   server -> client  { type: 'snapshot', rows: [...all stocks], summary }  once, on connect
//   client -> server  { type: 'subscribe', keys: ['1010_SR', ...] }       whenever the visible rows change
//   server -> client  { type: 'batch', rows: [...changed & subscribed], summary }   every second

const MAX_SUBSCRIBED = 500; // a screen shows a few dozen rows; cap protects the server from huge requests

export function createLiveFeedCore() {
  const rows = new Map(); // key -> latest row
  const dirty = new Set(); // keys changed since the last batch
  const clients = new Map(); // client id -> { send, subs }
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
    /** @param send (msgObject) => void; must not throw for a dead client (host decides how to drop it) */
    addClient(send) {
      const id = nextId++;
      const client = { send, subs: new Set() };
      clients.set(id, client);
      send({ type: 'snapshot', rows: [...rows.values()], summary: summary() });

      return {
        receive(text) {
          let msg;
          try {
            msg = JSON.parse(text);
          } catch {
            return; // ignore garbage from clients
          }
          if (msg?.type !== 'subscribe' || !Array.isArray(msg.keys)) return;
          const keys = msg.keys.slice(0, MAX_SUBSCRIBED).filter((k) => typeof k === 'string' && rows.has(k));
          const previous = client.subs;
          client.subs = new Set(keys);
          // Rows that just scrolled into view get their current values now, not at the next batch.
          const added = keys.filter((k) => !previous.has(k)).map((k) => live(rows.get(k)));
          if (added.length) send({ type: 'batch', rows: added });
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
        for (const key of client.subs) if (dirty.has(key)) changed.push(live(rows.get(key)));
        client.send({ type: 'batch', rows: changed, summary: sum });
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

    clientCount: () => clients.size,
    stats: () => ({ clients: clients.size, stocks: rows.size, subscribedPerClient: [...clients.values()].map((c) => c.subs.size) }),
  };
}
