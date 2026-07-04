// express-session の SessionData を拡張して、本アプリで使うフィールドを型付けする。
import 'express-session';
import type { Credentials } from 'google-auth-library';

declare module 'express-session' {
  interface SessionData {
    /** ログイン中の Google ユーザー情報 */
    user?: {
      email: string;
      name?: string;
    };
    /** Google OAuth のトークン一式（Phase 3 で Firestore 側へ移す） */
    googleTokens?: Credentials;
  }
}
