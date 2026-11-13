import express from 'express';
import { createServer } from 'node:http';
import { config } from './config.js';
import { DummyTradeProvider } from './provider/dummy-trade-provider.js';
import { DummyDetailsProvider } from './provider/dummy-details-provider.js';
import { normalize } from './models/stock-quote.js';
import { stockKey, dailyFields, tickFields } from './models/stock-record.js';
import { healthRoutes } from './routes/health.routes.js';
import { createFirebaseWriter } from './services/firebase-writer.js';
import { createLiveFeed } from './services/live-feed.js';

const app = express();
const httpServer = createServer(app); // one port: Express serves HTTP, ws takes the /ws upgrade
const firebase = createFirebaseWriter(config.firebase);
const feed = createLiveFeed(httpServer);
const detailsByIsin = new Map(); // join table: trade feed's requestedId === details' isin
const seenToday = new Set(); // stocks whose daily fields were already written
let ticksProcessed = 0;
let ticksWithoutDetails = 0;

app.use(express.json());
app.use(express.static(new URL('../public', import.meta.url).pathname)); // the stocks page at /
app.use(healthRoutes(() => ({
  ticksProcessed,
  ticksWithoutDetails,
  stocks: detailsByIsin.size,
  feed: feed.stats(),
  firebase: firebase.stats(),
})));

// Details pipeline: remember each company, write its static fields once, and add it to the live table.
const detailsProvider = new DummyDetailsProvider();
detailsProvider.on('message', (msg) => {
  for (const details of msg?.data ?? []) {
    if (!details?.isin || !details?.symbol) continue;
    detailsByIsin.set(details.isin, details);
    const key = stockKey(details);
    firebase.update(key, details);
    feed.setStatic(key, {
      symbol: details.kwealth_short_name ?? details.symbol,
      code: details.symbol.replace('.SR', ''),
      name: details.longName ?? details.shortName,
      sector: details.kwealth_sector ?? details.sector ?? '--', // raw code ('CAPITAL_GOODS'); clients prettify (the app maps codes to its filters)
      marketCap: details.marketCap?.raw ?? null,
    });
  }
});

// Tick pipeline: raw tick -> normalize -> join with details -> Firebase + WebSocket.
const tradeProvider = new DummyTradeProvider();
tradeProvider.on('message', (msg) => {
  for (const raw of msg?.data?.startStream ?? []) {
    const quote = normalize(raw);
    if (!quote) continue;
    const details = detailsByIsin.get(quote.id);
    if (!details) {
      ticksWithoutDetails++; // can't know which stock this is without its details
      continue;
    }
    const key = stockKey(details);
    if (!seenToday.has(key)) {
      seenToday.add(key);
      firebase.update(key, dailyFields(quote));
    }
    firebase.update(key, tickFields(quote));
    feed.setLive(key, { price: quote.last, change: quote.change, changePercent: quote.changePercent, volume: quote.volume, bid: quote.bid });
    ticksProcessed++;
  }
});

httpServer.listen(config.port, () => {
  console.log(`Page  http://localhost:${config.port}/`);
  console.log(`WS    ws://localhost:${config.port}/ws`);
  detailsProvider.start(); // details first, so the first ticks can be joined
  tradeProvider.start(config.ticksPerSecond);
});
