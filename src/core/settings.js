// Reads and validates numeric settings from an env-like object (process.env on Node, `env` on Cloudflare).
// Bad values fail at startup with a clear message instead of crashing later inside a timer.

function intSetting(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}=${JSON.stringify(raw)}: expected a whole number from ${min} to ${max}`);
  }
  return value;
}

export function readSettings(env) {
  return {
    port: intSetting(env, 'PORT', 8080, 0, 65535),
    ticksPerSecond: intSetting(env, 'TICKS_PER_SECOND', 3000, 1, 100_000), // 3000 = each of 3000 stocks once a second
    stockCount: intSetting(env, 'STOCK_COUNT', 3000, 1, 50_000),
    sessionMinutes: intSetting(env, 'SESSION_MINUTES', 480, 1, 7 * 24 * 60), // simulated trading day length
    maxClients: intSetting(env, 'MAX_CLIENTS', 500, 1, 100_000),
  };
}
