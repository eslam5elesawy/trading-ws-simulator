// Cloudflare host: static page from /public, live feed in one Durable Object.
// Same simulator, providers and protocol as the Node server (src/core/*); only the transport differs.
import { DurableObject } from 'cloudflare:workers';
import realStocks from '../data/real-stocks.json';
import { buildInstruments } from '../src/provider/instruments.js';
import { createMarket, staticRow, liveRow } from '../src/core/market.js';
import { createLiveFeedCore } from '../src/core/live-feed-core.js';

const BATCH_MS = 1000;

// One instance for everyone, so all clients see the same market.
export class Market extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.feed = createLiveFeedCore();
    this.market = createMarket(buildInstruments(realStocks, Number(env.STOCK_COUNT ?? 3000)), {
      onDetails: (key, details) => this.feed.setStatic(key, staticRow(details)),
      onQuote: (key, quote) => this.feed.setLive(key, liveRow(quote)),
    });
    this.running = false;
  }

  // The market only runs while someone is connected, to stay inside the free plan's daily limits.
  #start() {
    if (this.running) return;
    this.running = true;
    this.market.start(Number(this.env.TICKS_PER_SECOND ?? 3000));
    this.timer = setInterval(() => this.feed.flush(), BATCH_MS);
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

    const [clientSocket, server] = Object.values(new WebSocketPair());
    server.accept();
    this.#start(); // before addClient, so the snapshot already has every stock
    const client = this.feed.addClient((msg) => {
      try {
        server.send(JSON.stringify(msg));
      } catch {
        // socket already closed; the close handler removes it
      }
    });
    server.addEventListener('message', (e) => client.receive(typeof e.data === 'string' ? e.data : ''));
    const done = () => {
      client.remove();
      this.#stopIfIdle();
    };
    server.addEventListener('close', done);
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
