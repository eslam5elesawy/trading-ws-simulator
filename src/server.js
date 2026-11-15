import express from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { config } from './config.js';
import { createMarket, staticRow, liveRow } from './core/market.js';
import { loadInstruments } from './provider/load-instruments.js';
import { dailyFields, tickFields } from './models/stock-record.js';
import { createFirebaseWriter } from './services/firebase-writer.js';
import { createLiveFeed } from './services/live-feed.js';

const app = express();
const httpServer = createServer(app); // one port: Express serves HTTP, ws takes the /ws upgrade
const firebase = createFirebaseWriter(config.firebase);
const feed = createLiveFeed(httpServer, { maxClients: config.maxClients });
const seenToday = new Set(); // stocks whose daily Firebase fields were written this trading session

const market = createMarket(loadInstruments(config.stockCount), {
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
  onSession() {
    seenToday.clear(); // new open/previous close for every stock
  },
});

// import.meta.dirname is a real file path, so folders with spaces (%20 in URLs) still work.
app.use(express.static(join(import.meta.dirname, '../public'))); // the stocks page at /
app.get('/health', (req, res) => res.json({ status: 'ok', ...market.stats(), feed: feed.stats(), firebase: firebase.stats() }));

httpServer.listen(config.port, () => {
  const { port } = httpServer.address();
  console.log(`Page  http://localhost:${port}/`);
  console.log(`WS    ws://localhost:${port}/ws`);
  market.start(config.ticksPerSecond, { sessionMinutes: config.sessionMinutes });
});

// Stop cleanly on `docker stop`, Ctrl+C or a platform restart: no new ticks, last Firebase batch written.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  market.stop();
  feed.close();
  httpServer.close();
  await firebase.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
