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
npm test             # node:test: models, settings, tick rate/limits, WebSocket end-to-end
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
| Market pipeline | `src/core/market.js` | providers → normalize → join, shared by Node and Cloudflare |
| Live feed | `src/core/live-feed-core.js` (+ `src/services/live-feed.js` for Node, `cloudflare/worker.js` for Cloudflare) | Snapshot, subscriptions and per-second batches. The core has no transport code. |
| Firebase writer | `src/services/firebase-writer.js` | Optional. Buffers updates and sends one multi-path update per second. |
| Web page | `public/index.html` | Stocks table, market summary and ticker. Every changed number flashes. |

### WebSocket protocol (`/ws`)

| Direction | Message | When |
|---|---|---|
| server → client | `{ "type": "snapshot", "rows": [...all stocks], "summary": {...} }` | Once, on connect |
| client → server | `{ "type": "subscribe", "keys": ["1010_SR", ...] }` | Whenever the rows on screen change |
| server → client | `{ "type": "batch", "rows": [...changed & subscribed], "summary": {...} }` | Every second |
| client → server | `{ "type": "ping" }` | Every 20 s (keep-alive; the Cloudflare host drops clients silent for 60 s) |

The server only sends rows a client has subscribed to, so a phone showing 15 rows receives about 15 updates a second, not 3000.

- When a row scrolls into view, the server sends its current value right away.
- A subscription is capped at 500 keys; duplicate and unknown keys are dropped; more than 5 subscribes a second are ignored.
- Messages over 16 KB close the socket (code 1009). Connections over `MAX_CLIENTS` are refused (1013 on Node, 503 on Cloudflare).
- Dead connections are removed: Node pings every 30 s and drops clients that don't answer; Cloudflare drops clients silent for 60 s.
- A client that stays more than 1 MB behind for 10 s is disconnected (Node).

### Simulated market rules

- Prices move up to ±0.3% per tick and stay within **±10% of the previous close** (the Tadawul daily limit).
- Every `SESSION_MINUTES` (default 480) a new trading day starts: the last price becomes the close, and volume, turnover and trade counts reset.

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
| `SESSION_MINUTES` | `480` | Length of a simulated trading day |
| `MAX_CLIENTS` | `500` | Maximum WebSocket clients at once |
| `REAL_STOCKS_URL` | – | Source for `npm run fetch-real` |
| `FIREBASE_DATABASE_URL`, `FIREBASE_KEY_PATH` | – | Firebase writes are on only when both are set. **Never commit the key file.** |
| `FIREBASE_STOCKS_PATH` | `SIMULATOR/stocks` | Where stocks are written. A path outside `SIMULATOR/` also needs `FIREBASE_ALLOW_ANY_PATH=true`, because the simulator overwrites prices there. `npm run firebase:cleanup` deletes the generated `1xxxx_SR` stocks afterwards. |

Invalid numbers (e.g. `STOCK_COUNT=abc`) stop the server at startup with a clear message.

## Endpoints

- `GET /` – the live stocks page
- `GET /health` – status, tick counts, connected clients, subscriptions per client, Firebase stats
- `WS /ws` – the live feed

## Live demo

**https://trading-ws-simulator.eslam5elesawy.workers.dev** (WebSocket: `wss://trading-ws-simulator.eslam5elesawy.workers.dev/ws`, status: `/health`)

## Deploy (Cloudflare Workers, free, no card)

The same simulator runs as a Cloudflare Worker (`cloudflare/worker.js`). The page is served as static assets, and the live feed runs in one **Durable Object**, so every client sees the same market.

```bash
npx wrangler login                     # once, in the browser
REAL_STOCKS_URL=... npm run cf:deploy  # bundles data/real-stocks.json; without the URL, uses the existing snapshot or generated stocks
npm run cf:dev                         # run it locally in Cloudflare's runtime
```

- The market only runs while a client is connected, to stay within the free plan's daily limits.
- Measured on the free plan: about 2,800 ticks/s, with one batch per second per client.
- Firebase writes are Node-only, so this version doesn't write to Firebase.
- Settings (`TICKS_PER_SECOND`, `STOCK_COUNT`) are under `vars` in `wrangler.jsonc`.

## Other hosts

- **Any Docker host:** use the root `Dockerfile`. The server listens on `$PORT`.
- **Render:** `render.yaml` sets up a free web service, but Render asks for a card to verify your identity.

## Flutter app

The KWealth app reads this feed when it's built with:

```bash
fvm flutter run --flavor stage --target lib/stage_main.dart --dart-define=STOCKS_WS_URL=wss://<host>/ws
```

Without that flag, the app uses Firebase exactly as before.
