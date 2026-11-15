// All settings come from environment variables (e.g. `PORT=9000 npm start`); see .env.example.
import { readSettings } from './core/settings.js';

const SANDBOX_PATH = 'SIMULATOR/stocks';
const stocksPath = process.env.FIREBASE_STOCKS_PATH || SANDBOX_PATH;
// Writing outside the sandbox can overwrite real data (e.g. a staging app's stocks), so it must be asked for.
if (!stocksPath.startsWith('SIMULATOR/') && process.env.FIREBASE_ALLOW_ANY_PATH !== 'true') {
  throw new Error(`FIREBASE_STOCKS_PATH=${stocksPath} is outside SIMULATOR/. Set FIREBASE_ALLOW_ANY_PATH=true if you really mean it.`);
}

export const config = {
  ...readSettings(process.env),
  firebase: {
    keyPath: process.env.FIREBASE_KEY_PATH || 'serviceAccountKey.json',
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    stocksPath,
  },
};
