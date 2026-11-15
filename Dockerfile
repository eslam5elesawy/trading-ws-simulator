# Generic container image (any Docker host). Listens on $PORT (default 8080).
FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
# WORKDIR is root-owned; the importer writes data/ at startup, so give it to the app user.
RUN mkdir -p data && chown node:node data
USER node
ENV PORT=8080
EXPOSE 8080
# Fetches real company names when REAL_STOCKS_URL is set, then `exec`s Node so it receives SIGTERM directly.
ENTRYPOINT ["./docker-entrypoint.sh"]
