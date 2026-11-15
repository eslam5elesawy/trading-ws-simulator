# Generic container image (any Docker host). Listens on $PORT (default 8080).
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
USER node
ENV PORT=8080
EXPOSE 8080
# Fetches real company names when REAL_STOCKS_URL is set, then `exec`s Node so it receives SIGTERM directly.
ENTRYPOINT ["./docker-entrypoint.sh"]
