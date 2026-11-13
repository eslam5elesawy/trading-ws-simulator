// Values come from environment variables (e.g. `PORT=9000 npm start`), with sensible defaults.
export const config = {
  port: Number(process.env.PORT ?? 8080),
  ticksPerSecond: Number(process.env.TICKS_PER_SECOND ?? 3000), // 3000 = each of 3000 stocks once a second
  firebase: {
    keyPath: process.env.FIREBASE_KEY_PATH ?? 'serviceAccountKey.json',
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    stocksPath: process.env.FIREBASE_STOCKS_PATH ?? 'REAL_TIME/stocks', // same path the app's staging flavor reads
  },
};
