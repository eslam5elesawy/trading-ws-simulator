# Generic container image (any Docker host). Listens on $PORT (default 8080).
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN chown -R node:node /app
USER node
ENV PORT=8080
EXPOSE 8080
# Real company names are fetched at start when REAL_STOCKS_URL is set; otherwise all stocks are generated.
CMD ["sh", "-c", "npm run fetch-real && npm start"]
