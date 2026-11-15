// Node-only: reads the real-stock snapshot from disk (if any) and builds the instrument list.
import { existsSync, readFileSync } from 'node:fs';
import { buildInstruments } from './instruments.js';

export function loadInstruments(count) {
  const file = new URL('../../data/real-stocks.json', import.meta.url);
  const real = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  if (real.length === 0) console.warn('No real stocks in data/real-stocks.json (see `npm run fetch-real`): using generated stocks only.');
  return buildInstruments(real, count);
}
