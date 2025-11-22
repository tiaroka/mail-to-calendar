# CalDAV Calendar Event Generator

メール文面から予定情報を自動抽出し、ICSファイル生成やGoogleカレンダーへの直接登録ができるWebアプリケーションです。

## 機能

- 📧 **メール文面の自動解析**: OpenAI GPT-3.5-turboを使用してメール内容から予定情報を抽出
- 📅 **ICSファイル生成**: 標準的なカレンダー形式（iCalendar）でイベントをエクスポート
- 🔗 **Googleカレンダー連携**: OAuth認証を通じて直接カレンダーに予定を登録
- 📱 **レスポンシブデザイン**: モバイルデバイスにも対応したUI
- 🔒 **セキュアな認証**: Google Identity Servicesを使用した安全な認証

## 技術スタック

- **Backend**: Node.js, Express.js
- **AI**: OpenAI GPT-3.5-turbo (Function Calling)
- **認証**: Google OAuth 2.0, Google Identity Services
- **Calendar**: Google Calendar API, iCalendar (ICS)
- **Frontend**: Vanilla JavaScript, React (認証プロキシ)
- **デプロイ**: Google Cloud Run

## セットアップ

### 前提条件

- Node.js 18.0.0以上
- npm
- Google Cloud アカウント
- OpenAI APIアカウント

### 1. リポジトリのクローン

```bash
git clone https://github.com/yourusername/caldav-calendar-generator.git
cd caldav-calendar-generator
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 環境変数の設定

`.env.example`をコピーして`.env`を作成します：

```bash
cp .env.example .env
```

以下の環境変数を設定してください：

#### OpenAI API Key

[OpenAI Platform](https://platform.openai.com/)でAPIキーを取得

```
OPENAI_API_KEY=your-openai-api-key-here
```

#### Google OAuth認証情報

[Google Cloud Console](https://console.cloud.google.com/)で以下を設定：

1. 新しいプロジェクトを作成
2. Google Calendar APIを有効化
3. OAuth 2.0クライアントIDを作成（Webアプリケーション）
4. 承認済みのリダイレクトURIを追加：
   - ローカル: `http://localhost:8080/auth/google/callback`
   - 本番: `https://yourdomain.com/auth/google/callback`

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8080/auth/google/callback
```

#### その他の設定

```
# セッションシークレット（ランダムな文字列を生成）
SESSION_SECRET=your-very-long-random-string-here

# CORS許可オリジン（カンマ区切り）
CORS_ORIGINS=http://localhost:8080

# サーバーポート（オプション）
PORT=8080
```

### 4. アプリケーションの起動

#### 開発環境

```bash
npm start
```

ブラウザで `http://localhost:8080` にアクセス

#### テスト実行

```bash
npm test
```

## 使い方

### 1. Googleアカウントと連携

右上の「Googleカレンダーと連携する」リンクをクリックして、Googleアカウントでログイン

### 2. メール内容を貼り付け

予定が記載されたメール文面をテキストエリアに貼り付け

### 3. GPTで解析

「GPTで解析する」ボタンをクリックして、AIに予定情報を抽出させる

### 4. 結果を確認・編集

解析結果を確認し、必要に応じて「詳細設定」から修正

### 5. カレンダーに登録

以下のいずれかを選択：
- **ICSファイルをダウンロード**: 他のカレンダーアプリでインポート可能
- **Googleカレンダーに登録**: 直接Googleカレンダーに予定を作成

## デプロイ

### Google Cloud Runへのデプロイ

#### 前提条件

- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)がインストール済み
- Google Cloudプロジェクトが作成済み
- Billing（課金）が有効化されている

#### 方法1: デプロイスクリプトを使用（推奨）

**Linux/Mac:**

1. スクリプトに実行権限を付与

```bash
chmod +x deploy-cloud-run.sh
```

2. デプロイを実行

```bash
./deploy-cloud-run.sh YOUR_PROJECT_ID asia-northeast1 calendar-service
```

**Windows (PowerShell):**

```powershell
.\deploy-cloud-run.ps1 -ProjectId "YOUR_PROJECT_ID" -Region "asia-northeast1" -ServiceName "calendar-service"
```

スクリプトが自動的に：
- 環境変数を`.env`から読み込み
- Cloud Runにデプロイ
- 必要な環境変数を設定
- デプロイ後の手順を表示

#### 方法2: 手動デプロイ

1. プロジェクトIDを設定

```bash
gcloud config set project YOUR_PROJECT_ID
```

2. Cloud Runにデプロイ

```bash
gcloud run deploy calendar-service \
  --source . \
  --platform managed \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars "OPENAI_API_KEY=your-key" \
  --set-env-vars "GOOGLE_CLIENT_ID=your-client-id" \
  --set-env-vars "GOOGLE_CLIENT_SECRET=your-secret" \
  --set-env-vars "SESSION_SECRET=your-session-secret" \
  --set-env-vars "GOOGLE_REDIRECT_URI=https://your-service-url/auth/google/callback" \
  --set-env-vars "CORS_ORIGINS=https://your-service-url"
```

#### デプロイ後の設定

1. **Google OAuth認証情報の更新**

[Google Cloud Console](https://console.cloud.google.com/apis/credentials)で：
   - OAuth 2.0クライアントIDを選択
   - 「承認済みのリダイレクトURI」に以下を追加：
     ```
     https://your-service-url/auth/google/callback
     ```

2. **環境変数の確認**

Cloud Runコンソールで環境変数が正しく設定されているか確認：
   - `OPENAI_API_KEY`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `SESSION_SECRET`
   - `GOOGLE_REDIRECT_URI`
   - `CORS_ORIGINS`

3. **動作確認**

デプロイされたURLにアクセスして動作を確認

#### トラブルシューティング

**デプロイが失敗する場合:**
- Cloud Build APIとCloud Run APIが有効になっているか確認
- プロジェクトのBillingが有効か確認
- `.gcloudignore`で必要なファイルが除外されていないか確認

**アプリケーションが起動しない場合:**
- Cloud Runのログを確認: `gcloud run logs read calendar-service --region=asia-northeast1`
- 環境変数が正しく設定されているか確認
- PORT環境変数はCloud Runが自動設定するため不要

**OAuth認証エラー:**
- リダイレクトURIが正確に一致しているか確認（末尾のスラッシュなど）
- Google Cloud ConsoleでOAuth同意画面が正しく設定されているか確認

## プロジェクト構造

```
.
├── app.js                  # メインアプリケーション
├── verify-token.js         # JWT検証モジュール
├── package.json            # 依存関係定義
├── .env.example            # 環境変数テンプレート
├── .gitignore             # Git除外設定
├── auth-proxy/            # 認証プロキシ
│   ├── auth-wrapper.js    # Google Identity Services統合
│   └── index.html         # 認証プロキシHTML
├── public/                # 公開ファイル
│   └── index.html         # メインUI
└── tests/                 # テストファイル
    └── api.test.js        # APIテスト

```

## APIエンドポイント

### `POST /api/parse`
メール内容をGPTで解析し、イベント情報を抽出

### `POST /api/create-ics`
イベント情報からICSファイルを生成

### `POST /api/google-calendar-create`
Googleカレンダーにイベントを作成（要認証）

### `GET /api/config`
クライアント設定（Client ID、Service URL）を取得

### `GET /auth/google`
Google OAuth認証フローを開始

### `GET /auth/google/callback`
Google OAuthコールバック

## セキュリティに関する注意

- `.env`ファイルは**絶対に**コミットしないでください
- 本番環境では強力なセッションシークレットを使用してください
- HTTPS経由でのみアプリケーションを公開してください
- APIキーは定期的にローテーションしてください

## トラブルシューティング

### Google OAuth認証エラー

- Google Cloud ConsoleでリダイレクトURIが正しく設定されているか確認
- `GOOGLE_REDIRECT_URI`環境変数が実際のURLと一致しているか確認

### GPT解析が失敗する

- OpenAI APIキーが有効か確認
- APIの利用上限に達していないか確認
- メール内容に予定情報が含まれているか確認

### Googleカレンダー登録エラー

- Google Calendar APIが有効になっているか確認
- OAuth認証が完了しているか確認
- 日時フォーマットが正しいか確認

## ライセンス

MIT License - 詳細は[LICENSE](LICENSE)ファイルを参照

## 貢献

プルリクエストを歓迎します。大きな変更の場合は、まずIssueを開いて変更内容を議論してください。

## 作者

Toru Ishii

## 謝辞

- OpenAI for GPT API
- Google for Calendar API and OAuth services
