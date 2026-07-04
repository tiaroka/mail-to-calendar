import { describe, it, expect, vi, beforeEach } from 'vitest';

// 端末内アダプタとサーバーAPIをモックし、信頼度ゲート/エスカレーションのロジックを検証する。
const { mockAvailable, mockOnDevice, mockServer } = vi.hoisted(() => ({
  mockAvailable: vi.fn(),
  mockOnDevice: vi.fn(),
  mockServer: vi.fn(),
}));

vi.mock('../web/src/llm/onDeviceChrome.js', () => ({
  isOnDeviceAvailable: mockAvailable,
  extractOnDevice: mockOnDevice,
}));
vi.mock('../web/src/api.js', () => ({
  parseEmailOnServer: mockServer,
}));

const { extractEvent } = await import('../web/src/llm/index.js');

const CONFIDENT = {
  title: '会議',
  location: '東京',
  startTime: '2026-05-10T10:00:00',
  endTime: '2026-05-10T11:00:00',
  description: '',
  timezone: 'Asia/Tokyo',
};
const LOW_CONF = { ...CONFIDENT, title: '', startTime: '' };
const SERVER_RESULT = { ...CONFIDENT, title: 'サーバー結果' };

beforeEach(() => {
  vi.clearAllMocks();
  mockServer.mockResolvedValue(SERVER_RESULT);
});

describe('extractEvent（解析オーケストレーション）', () => {
  it('preference=server ならサーバーを使う', async () => {
    const r = await extractEvent('x', 'server');
    expect(r.source).toBe('server');
    expect(mockAvailable).not.toHaveBeenCalled();
    expect(mockServer).toHaveBeenCalledOnce();
  });

  it('端末内が使えて高信頼度なら端末内結果を採用', async () => {
    mockAvailable.mockResolvedValue(true);
    mockOnDevice.mockResolvedValue(CONFIDENT);
    const r = await extractEvent('x', 'auto');
    expect(r.source).toBe('on-device');
    expect(r.escalated).toBeUndefined();
    expect(mockServer).not.toHaveBeenCalled();
  });

  it('auto かつ端末内が低信頼度ならサーバーへ自動エスカレーション', async () => {
    mockAvailable.mockResolvedValue(true);
    mockOnDevice.mockResolvedValue(LOW_CONF);
    const r = await extractEvent('x', 'auto');
    expect(r.source).toBe('server');
    expect(r.escalated).toBe(true);
    expect(mockServer).toHaveBeenCalledOnce();
  });

  it('on-device 固定なら低信頼度でも端末内結果を返す', async () => {
    mockAvailable.mockResolvedValue(true);
    mockOnDevice.mockResolvedValue(LOW_CONF);
    const r = await extractEvent('x', 'on-device');
    expect(r.source).toBe('on-device');
    expect(mockServer).not.toHaveBeenCalled();
  });

  it('端末内が例外を投げたらサーバーで救済', async () => {
    mockAvailable.mockResolvedValue(true);
    mockOnDevice.mockRejectedValue(new Error('boom'));
    const r = await extractEvent('x', 'auto');
    expect(r.source).toBe('server');
    expect(r.escalated).toBe(true);
  });

  it('端末内が使えなければサーバー', async () => {
    mockAvailable.mockResolvedValue(false);
    const r = await extractEvent('x', 'auto');
    expect(r.source).toBe('server');
    expect(mockOnDevice).not.toHaveBeenCalled();
  });
});
