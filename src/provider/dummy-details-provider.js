import { EventEmitter } from 'node:events';
import { INSTRUMENTS } from './instruments.js';

// Company reference data (name, sector, ratios), keyed by `isin`, which matches the trade feed's `requestedId`.
// It changes rarely, so the full list is sent once on start, like a reference-data snapshot.
export class DummyDetailsProvider extends EventEmitter {
  start() {
    this.emit('message', { data: INSTRUMENTS.map((i) => structuredClone(i.details)) });
  }
}
