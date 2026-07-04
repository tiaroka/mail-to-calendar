// サーバー起動とグレースフルシャットダウン（旧 app.js 末尾から分離）。
import app from './app.js';
import { config } from './config/index.js';

const server = app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});

// Cloud Run は SIGTERM を送る。猶予時間内に安全に閉じる。
function shutdown() {
  console.log('Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  // Cloud Run の猶予（10秒）内に収める安全マージン
  setTimeout(() => {
    console.warn('Forceful shutdown after timeout');
    process.exit(1);
  }, 8000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
