// verify-token.js
require('dotenv').config();
const { OAuth2Client } = require('google-auth-library');

// 環境変数からクライアントIDを取得
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const client = new OAuth2Client(CLIENT_ID);

async function verifyIdToken(token) {
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: CLIENT_ID
  });
  return ticket.getPayload();
}

module.exports = { verifyIdToken };
