// セッションミドルウェアの構築。
// 本番は Firestore ストア（Cloud Run の複数インスタンス・再起動に耐える）、
// ローカル/テストは既定の MemoryStore（外部依存なし）を使う。
import session from 'express-session';
import { FirestoreStore } from '@google-cloud/connect-firestore';
import { Firestore } from '@google-cloud/firestore';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

export function buildSessionMiddleware() {
  const options: session.SessionOptions = {
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.isProd, // 本番ではHTTPS必須
      httpOnly: true, // XSS対策
      sameSite: 'lax', // CSRF対策
      maxAge: 24 * 60 * 60 * 1000, // 24時間
    },
  };

  if (config.session.useFirestore) {
    // Firestore は最初のRPCまで認証しないため、テスト等でこの分岐に入らなければ
    // 資格情報は不要。projectId 未指定時は ADC（実行環境）から解決される。
    const firestore = new Firestore(
      config.session.projectId ? { projectId: config.session.projectId } : {},
    );
    options.store = new FirestoreStore({
      dataset: firestore,
      kind: config.session.collection,
    });
    logger.info('Session store: Firestore', { collection: config.session.collection });
  } else {
    logger.info('Session store: MemoryStore (development/test)');
  }

  return session(options);
}
