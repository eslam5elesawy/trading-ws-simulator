# Hugging Face Space (Docker SDK): builds straight from the GitHub repo.
# To deploy a new version: Space Settings > Factory rebuild.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /home/node/app
RUN git clone --depth 1 https://github.com/eslam5elesawy/trading-ws-simulator.git . && npm ci --omit=dev
# Spaces route traffic to port 7860.
ENV PORT=7860 TICKS_PER_SECOND=3000 STOCK_COUNT=3000
EXPOSE 7860
# REAL_STOCKS_URL (optional) is set as a Space variable in Settings.
CMD ["sh", "-c", "npm run fetch-real && npm start"]
