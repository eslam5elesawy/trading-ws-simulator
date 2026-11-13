import express from 'express';
import { createServer } from 'node:http';
import { config } from './config.js';
import { createMarket, staticRow, liveRow } from './core/market.js';
import { loadInstruments } from './provider/load-instruments.js';
import { dailyFields, tickFields } from './models/stock-record.js';
import { healthRoutes } from './routes/health.routes.js';
import { createFirebaseWriter } from './services/firebase-writer.js';
import { createLiveFeed } from './services/live-feed.js';

const app = express();
const httpServer = createServer(app); // one port: Express serves HTTP, ws takes the /ws upgrade
const firebase = createFirebaseWriter(config.firebase);
const feed = createLiveFeed(httpServer);
const seenToday = new Set(); // stocks whose daily Firebase fields were already written

const market = createMarket(loadInstruments(), {
  onDetails(key, details) {
    firebase.update(key, details);
    feed.setStatic(key, staticRow(details));
  },
  onQuote(key, quote) {
    if (!seenToday.has(key)) {
      seenToday.add(key);
      firebase.update(key, dailyFields(quote));
    }
    firebase.update(key, tickFields(quote));
    feed.setLive(key, liveRow(quote));
  },
});

app.use(express.json());
app.use(express.static(new URL('../public', import.meta.url).pathname)); // the stocks page at /
app.use(healthRoutes(() => ({ ...market.stats(), feed: feed.stats(), firebase: firebase.stats() })));

httpServer.listen(config.port, () => {
  console.log(`Page  http://localhost:${config.port}/`);
  console.log(`WS    ws://localhost:${config.port}/ws`);
  market.start(config.ticksPerSecond);
});
