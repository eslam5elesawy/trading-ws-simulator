// The simulated market pipeline, shared by the Node server and the Cloudflare Worker:
// details provider + trade provider -> normalize -> join by ISIN -> callbacks.
import { DummyTradeProvider } from '../provider/dummy-trade-provider.js';
import { DummyDetailsProvider } from '../provider/dummy-details-provider.js';
import { normalize } from '../models/stock-quote.js';
import { stockKey } from '../models/stock-record.js';
import { toNumber, toText } from '../provider/reference-data.js';

/** The row shape clients see (web page / app), built from a details record. Every field has a safe type. */
export const staticRow = (details) => ({
  symbol: toText(details.kwealth_short_name) ?? details.symbol,
  code: details.symbol.replace('.SR', ''),
  name: toText(details.longName) ?? toText(details.shortName) ?? details.symbol,
  sector: toText(details.kwealth_sector) ?? toText(details.sector) ?? '--', // raw code ('CAPITAL_GOODS'); clients prettify
  marketCap: toNumber(details.marketCap), // always a number or null, so the summary sum stays numeric
});

export const liveRow = (quote) => ({
  price: quote.last, change: quote.change, changePercent: quote.changePercent, volume: quote.volume, bid: quote.bid,
});

/**
 * @param instruments from buildInstruments()
 * @param handlers { onDetails(key, details), onQuote(key, quote), onSession?() }
 */
export function createMarket(instruments, { onDetails, onQuote, onSession = () => {} }) {
  const detailsByIsin = new Map(); // join table: trade feed's requestedId === details' isin
  const detailsProvider = new DummyDetailsProvider(instruments);
  const tradeProvider = new DummyTradeProvider(instruments);
  let ticksProcessed = 0;
  let ticksWithoutDetails = 0;

  detailsProvider.on('message', (msg) => {
    for (const details of msg?.data ?? []) {
      if (!details?.isin || !details?.symbol) continue;
      detailsByIsin.set(details.isin, details);
      onDetails(stockKey(details), details);
    }
  });

  tradeProvider.on('message', (msg) => {
    for (const raw of msg?.data?.startStream ?? []) {
      const quote = normalize(raw);
      if (!quote) continue;
      const details = detailsByIsin.get(quote.id);
      if (!details) {
        ticksWithoutDetails++; // can't know which stock this is without its details
        continue;
      }
      onQuote(stockKey(details), quote);
      ticksProcessed++;
    }
  });

  tradeProvider.on('session', onSession); // new trading day: closes rolled forward, totals reset

  return {
    start(ticksPerSecond, { sessionMinutes } = {}) {
      detailsProvider.start(); // details first, so the first ticks can be joined
      tradeProvider.start(ticksPerSecond, { sessionMinutes });
    },
    stop() {
      tradeProvider.stop();
    },
    stats: () => ({ ticksProcessed, ticksWithoutDetails, stocks: detailsByIsin.size }),
  };
}
