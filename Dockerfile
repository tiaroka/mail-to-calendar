# syntax=docker/dockerfile:1

# ==================== builder ====================
# 依存を全部入れて server(TS→dist) と web(Vite→dist/public) をビルドする。
FROM node:22-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ==================== runtime ====================
# 本番依存 + ビルド成果物(dist) だけの軽量イメージ。
FROM node:22-slim AS runtime
WORKDIR /app

# NODE_ENV=production は必須。これがないと Firestore セッションに切り替わらず
# MemoryStore になってしまう（Cloud Run の複数インスタンスで破綻する）。
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ビルド成果物のみコピー（dist/server・dist/shared・dist/public を含む）
COPY --from=builder /app/dist ./dist

# Cloud Run は PORT を動的に設定する（config が process.env.PORT を読む）
EXPOSE 8080

CMD ["node", "dist/server/server.js"]
