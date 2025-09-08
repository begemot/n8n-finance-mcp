# ---------- build stage ----------
FROM node:20-alpine AS builder
WORKDIR /app

# сначала только манифесты
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci

# скопировать исходники
COPY . .

# сборка TS -> JS
RUN npx tsc -p .

# ---------- runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# только prod-зависимости
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

# скопировать собранный код
COPY --from=builder /app/dist ./dist

# база данных в volume
ENV DB_PATH=/data/mcp-finance-db.json
VOLUME ["/data"]

# важно: STDIO MCP сервер
CMD ["node", "dist/index.js"]
