import { EventEmitter } from 'node:events';

// Company reference data (name, sector, ratios), keyed by `isin`, which matches the trade feed's `requestedId`.
// It changes rarely, so the full list is sent once on start, like a reference-data snapshot.
export class DummyDetailsProvider extends EventEmitter {
  #instruments;

  constructor(instruments) {
    super();
    this.#instruments = instruments;
  }

  start() {
    this.emit('message', { data: this.#instruments.map((i) => structuredClone(i.details)) });
  }
}
