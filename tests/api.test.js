const request = require('supertest');
const app = require('../app'); // app.js を読み込む

describe('POST /api/parse', () => {
  // テストケース1: 正常なメール本文
  it('should parse email content and return event info', async () => {
    const emailContent = '会議 on 5/10 at 10:00 in 東京';
    const response = await request(app)
      .post('/api/parse')
      .send({ emailContent })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('title', '会議');
    expect(response.body).toHaveProperty('location', '東京');
    expect(response.body).toHaveProperty('startTime', expect.stringContaining('2025-05-10T10:00'));
  });

  // テストケース2: 空のメール本文
  it('should return 400 if emailContent is missing', async () => {
    const response = await request(app)
      .post('/api/parse')
      .send({})
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error', 'No emailContent provided.');
  });
});