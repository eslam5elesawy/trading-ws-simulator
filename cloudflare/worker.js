// Cloudflare host: static page from /public, live feed in one Durable Object.
// Same simulator, providers and protocol as the Node server (src/core/*); only the transport differs.
import { DurableObject } from 'cloudflare:workers';
import realStocks from '../data/real-stocks.json';
import { buildInstruments } from '../src/provider/instruments.js';
import { createMarket, staticRow, liveRow } from '../src/core/market.js';
import { createLiveFeedCore, MAX_MESSAGE_BYTES } from '../src/core/live-feed-core.js';
import { readSettings } from '../src/core/settings.js';

const BATCH_MS = 1000;
// Workers have no protocol-level ping we can watch, so clients send { type: 'ping' } every 20 s and anyone
// silent for 60 s is dropped. Otherwise one half-open socket would keep the market ticking (and the quota burning).
const MAX_IDLE_MS = 60_000;

// One instance for everyone, so all clients see the same market.
export class Market extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.settings = readSettings(env);
    this.feed = createLiveFeedCore();
    this.market = createMarket(buildInstruments(realStocks, this.settings.stockCount), {
      onDetails: (key, details) => this.feed.setStatic(key, staticRow(details)),
      onQuote: (key, quote) => this.feed.setLive(key, liveRow(quote)),
    });
    this.running = false;
  }

  // The market only runs while someone is connected, to stay inside the free plan's daily limits.
  #start() {
    if (this.running) return;
    this.running = true;
    this.market.start(this.settings.ticksPerSecond, { sessionMinutes: this.settings.sessionMinutes });
    this.timer = setInterval(() => {
      this.feed.closeIdle(MAX_IDLE_MS);
      this.feed.flush();
      this.#stopIfIdle();
    }, BATCH_MS);
  }

  #stopIfIdle() {
    if (!this.running || this.feed.clientCount() > 0) return;
    this.market.stop();
    clearInterval(this.timer);
    this.running = false;
  }

  async fetch(request) {
    if (new URL(request.url).pathname === '/health') {
      return Response.json({ status: 'ok', running: this.running, ...this.market.stats(), feed: this.feed.stats() });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket upgrade', { status: 426 });

    if (this.feed.clientCount() >= this.settings.maxClients) return new Response('Server busy, try again later', { status: 503 });

    const [clientSocket, server] = Object.values(new WebSocketPair());
    server.accept();
    this.#start(); // before addClient, so the snapshot already has every stock
    const client = this.feed.addClient(
      (msg) => {
        try {
          server.send(JSON.stringify(msg));
          return true;
        } catch {
          return false; // socket already closed; the close handler removes it
        }
      },
      () => server.close(1001, 'Idle timeout'),
    );
    server.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE_BYTES) {
        server.close(1009, 'Message too big'); // 1009 = message too big
        return;
      }
      client.receive(e.data);
    });
    const done = () => {
      client.remove();
      this.#stopIfIdle();
    };
    server.addEventListener('close', (e) => {
      // Answer the client's close frame, so its close completes promptly instead of hanging in CLOSING.
      try {
        server.close(e.code === 1005 ? 1000 : e.code, e.reason);
      } catch {
        // already closed
      }
      done();
    });
    server.addEventListener('error', done);
    return new Response(null, { status: 101, webSocket: clientSocket });
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/ws' || pathname === '/health') {
      return env.MARKET.get(env.MARKET.idFromName('market')).fetch(request);
    }
    return env.ASSETS.fetch(request); // index.html and anything else in /public
  },
};
