import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

// ==================== テストの外部依存について ====================
// /api/parse の正常系（LLM呼び出しを伴う）は、OpenAI 呼び出しがまだ route に
// インラインのため決定的にモックしにくい。Phase 4 で LLM を service 層へ抽出し
// 依存注入可能にした上で有効化する（下部の it.skip 参照）。
//
// テストは vitest.config.ts の env によりダミーキーで密閉化されており、
// 万一 openai を呼んでも実APIには到達しない（.env の実キーは読み込まれない）。

const { default: app } = await import('../server/app.js');

// テスト用セッションセットアップ（認証済み状態を作る）
// 重複登録防止ガード付き
if (!app._testLoginRouteAdded) {
  app.get('/__test-login', (req, res) => {
    req.session.user = { email: 'test@example.com', name: 'Test User' };
    res.json({ ok: true });
  });
  app._testLoginRouteAdded = true;
}

let agent;

beforeAll(async () => {
  agent = request.agent(app);
  await agent.get('/__test-login');
});

describe('POST /api/parse', () => {
  // TODO(Phase 4): LLM を service 層へ抽出し依存注入可能にしたら、
  // モックした抽出結果がレスポンスへ受け渡されることを検証する。
  it.skip('should pass parsed event info through to the response (Phase 4で有効化)', async () => {
    const emailContent = '会議 on 5/10 at 10:00 in 東京';
    const response = await agent
      .post('/api/parse')
      .send({ emailContent })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('title');
    expect(response.body).toHaveProperty('startTime');
  });

  // 空のメール本文（LLM呼び出し前に 400 を返すためオフラインで検証可能）
  it('should return 400 if emailContent is missing', async () => {
    const response = await agent
      .post('/api/parse')
      .send({})
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error', 'No emailContent provided.');
  });
});

describe('POST /api/create-ics', () => {
  // Bug 1: CRLF インジェクションでプロパティが注入されないこと
  it('should not allow CRLF injection in title', async () => {
    const response = await agent
      .post('/api/create-ics')
      .send({
        title: 'Meeting\r\nATTENDEE:mailto:hacker@evil.com',
        location: '東京',
        startTime: '2025-07-01T10:00:00',
        endTime: '2025-07-01T11:00:00',
        description: 'テスト',
        emailContent: '本文'
      })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    const ics = response.text;
    // \r\n で分割後、各行内に bare \r が残っていないこと
    const lines = ics.split('\r\n');
    for (const line of lines) {
      expect(line).not.toContain('\r');
    }
  });

  // Bug 2: DESCRIPTION 内に生改行が含まれないこと
  it('should not have raw newlines inside DESCRIPTION value', async () => {
    const response = await agent
      .post('/api/create-ics')
      .send({
        title: 'テスト会議',
        location: '大阪',
        startTime: '2025-07-01T10:00:00',
        endTime: '2025-07-01T11:00:00',
        description: '説明文',
        emailContent: 'メール本文'
      })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    const ics = response.text;
    // \r\n で分割後、各行内に bare \n が残っていないこと
    // （bare \n があると ICS パーサーがプロパティを誤認する）
    const lines = ics.split('\r\n');
    for (const line of lines) {
      expect(line).not.toContain('\n');
    }
  });

  // Bug 3: 不正な日付入力で NaN が出力されないこと
  it('should not output NaN for invalid date input', async () => {
    const response = await agent
      .post('/api/create-ics')
      .send({
        title: 'テスト',
        location: '',
        startTime: 'not-a-date',
        endTime: 'also-invalid',
        description: '',
        emailContent: ''
      })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    const ics = response.text;
    expect(ics).not.toContain('NaN');
  });
});
