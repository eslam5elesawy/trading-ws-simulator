#!/bin/sh
set -e
node scripts/fetch-real-stocks.js
exec node src/server.js
