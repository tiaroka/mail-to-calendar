# Dockerfile

FROM node:18-slim

WORKDIR /app

# package*.json を先にコピーして依存関係をインストール
COPY package*.json ./
RUN npm install --production

# 残りのソースコードをコピー
COPY . .

# Cloud Run やローカル実行で使うポート
# Cloud Runは動的にPORT環境変数を設定するため、ハードコードしない
EXPOSE 8080

# コンテナ起動時に実行するコマンド
CMD ["node", "app.js"]