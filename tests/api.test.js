const request = require('supertest');
const app = require('../app'); // app.js を読み込む

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
  // テストケース1: 正常なメール本文
  it('should parse email content and return event info', async () => {
    // 現在の日付を基準に、5月10日が未来になる年を動的に決定
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const expectedYear = (currentMonth > 5 || (currentMonth === 5 && now.getDate() > 10))
      ? currentYear + 1
      : currentYear;

    const emailContent = '会議 on 5/10 at 10:00 in 東京';
    const response = await agent
      .post('/api/parse')
      .send({ emailContent })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('title', '会議');
    expect(response.body).toHaveProperty('location', '東京');
    expect(response.body).toHaveProperty('startTime', expect.stringContaining(`${expectedYear}-05-10T10:00`));
  });

  // テストケース2: 空のメール本文
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