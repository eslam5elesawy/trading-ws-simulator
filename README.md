# Trading WebSocket Simulator

This is a simulated Saudi stock market feed. Dummy data providers send raw price ticks and company details. A Node.js service joins and reshapes them, then pushes live updates to a web page (and the KWealth Flutter app) over a WebSocket. It can also write each update to Firebase Realtime Database.

Its purpose is to test real-time stock lists at scale (3000 stocks, each updating every second) without a real market data subscription.

```
Dummy trade provider ──(raw ticks, ~3000/s)──┐
                                              ├─► Node service ──► WebSocket /ws ──► web page / Flutter app
Dummy details provider ──(company info, once)─┘   normalize+join   (visible rows only, 1 batch/s)
                                                        └────────► Firebase Realtime DB (optional, batched)
```

## Quick start

```bash
npm ci
npm start            # http://localhost:8080
npm test             # self-checks + WebSocket end-to-end check
```

Open http://localhost:8080 for the live stocks page. The page copies the layout of kwealth.sa/market/stocks.

To use real Saudi company names and sectors instead of only generated stocks, run this once:

```bash
REAL_STOCKS_URL=https://<your-db>/REAL_TIME/stocks.json npm run fetch-real
```

This writes `data/real-stocks.json`, which is git-ignored. The server fills the rest of the list up to `STOCK_COUNT` with generated `Test Company 1xxxx` stocks. Prices are always simulated.

## How it works

| Part | File | What it does |
|---|---|---|
| Trade provider | `src/provider/dummy-trade-provider.js` | Emits ticks in the real feed's `startStream` shape. It goes through the stocks in order, so `TICKS_PER_SECOND = STOCK_COUNT` means every stock ticks once a second. |
| Details provider | `src/provider/dummy-details-provider.js` | Sends company details (name, sector, market cap, ratios) once at startup. |
| Instruments | `src/provider/instruments.js` | The stock list both providers share: real stocks from `data/`, then generated ones. |
| Normalize | `src/models/stock-quote.js` | Turns a raw tick into a flat quote. Invalid ticks are dropped. |
| Join | `src/server.js` | Matches each tick to its company using the ISIN (`requestedId` ↔ `isin`). |
| Live feed | `src/services/live-feed.js` | The WebSocket server: snapshot, subscriptions and per-second batches. |
| Firebase writer | `src/services/firebase-writer.js` | Optional. Buffers updates and sends one multi-path update per second. |
| Web page | `public/index.html` | Stocks table, market summary and ticker. Every changed number flashes. |

### WebSocket protocol (`/ws`)

| Direction | Message | When |
|---|---|---|
| server → client | `{ "type": "snapshot", "rows": [...all stocks], "summary": {...} }` | Once, on connect |
| client → server | `{ "type": "subscribe", "keys": ["1010_SR", ...] }` | Whenever the rows on screen change |
| server → client | `{ "type": "batch", "rows": [...changed & subscribed], "summary": {...} }` | Every second |

The server only sends rows a client has subscribed to, so a phone showing 15 rows receives about 15 updates a second, not 3000.

- When a row scrolls into view, the server sends its current value right away.
- A subscription is capped at 500 keys.
- Unknown keys and messages that aren't valid JSON are ignored.
- Clients that fall far behind are skipped rather than letting memory grow.

The web page tracks visible rows with `IntersectionObserver`. The Flutter app does the same by having each list row report when it's built and when it's removed.

### Measured locally

| Measurement | Result |
|---|---|
| 3000 ticks/s | ~23% of one CPU core, ~240 MB memory |
| Snapshot (3000 stocks) | ~650 KB, once |
| Updates for ~30 visible rows | ~3 KB/s |
| Firebase writes at 3000 stocks/s | Each stock updates about every 3 s (the database's write limit), so the WebSocket path is the one that reaches 1 s |

## Configuration

All settings are optional environment variables; see `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port |
| `TICKS_PER_SECOND` | `3000` | Simulated ticks per second (all stocks combined) |
| `STOCK_COUNT` | `3000` | Total stocks, real + generated |
| `REAL_STOCKS_URL` | – | Source for `npm run fetch-real` |
| `FIREBASE_DATABASE_URL`, `FIREBASE_KEY_PATH` | – | Firebase writes are on only when both are set. **Never commit the key file.** |
| `FIREBASE_STOCKS_PATH` | `REAL_TIME/stocks` | Where stocks are written in the database |

## Endpoints

- `GET /` – the live stocks page
- `GET /health` – status, tick counts, connected clients, subscriptions per client, Firebase stats
- `WS /ws` – the live feed

## Deploy (Render, free)

1. In Render, choose **New → Blueprint** and pick this repo. `render.yaml` creates the web service.
2. Optionally, set `REAL_STOCKS_URL` in the service's environment settings to show real company names.
3. Open the service URL. The page connects to `wss://<service>/ws` automatically.

The free plan sleeps after 15 minutes without traffic, so the first visit after that takes about 30 seconds.

## Flutter app

The KWealth app reads this feed when it's built with:

```bash
fvm flutter run --flavor stage --target lib/stage_main.dart --dart-define=STOCKS_WS_URL=wss://<host>/ws
```

Without that flag, the app uses Firebase exactly as before.
