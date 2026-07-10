import { describe, it, expect, vi, beforeEach } from 'vitest';

// 端末内アダプタとサーバーAPIをモックし、信頼度ゲート/エスカレーションのロジックを検証する。
const { mockStatus, mockOnDevice, mockServer, mockDownload } = vi.hoisted(() => ({
  mockStatus: vi.fn(),
  mockOnDevice: vi.fn(),
  mockServer: vi.fn(),
  mockDownload: vi.fn(),
}));

vi.mock('../web/src/llm/onDeviceChrome.js', () => ({
  getOnDeviceStatus: mockStatus,
  extractOnDevice: mockOnDevice,
  triggerModelDownload: mockDownload,
}));
vi.mock('../web/src/api.js', () => ({
  parseEmailOnServer: mockServer,
}));

const { extractEvent, OnDeviceParseError } = await import('../web/src/llm/index.js');

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
  mockDownload.mockResolvedValue(undefined);
});

describe('extractEvent（解析オーケストレーション）', () => {
  it('preference=server ならサーバーを使う', async () => {
    const r = await extractEvent('x', 'server');
    expect(r.source).toBe('server');
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockServer).toHaveBeenCalledOnce();
  });

  it('端末内が使えて高信頼度なら端末内結果を採用', async () => {
    mockStatus.mockResolvedValue('available');
    mockOnDevice.mockResolvedValue(CONFIDENT);
    const r = await extractEvent('x', 'auto');
    expect(r.source).toBe('on-device');
    expect(r.escalated).toBeUndefined();
    expect(mockServer).not.toHaveBeenCalled();
  });

  it('auto かつ端末内が低信頼度ならサーバーへ自動エスカレーション', async () => {
    mockStatus.mockResolvedValue('available');
    mockOnDevice.mockResolvedValue(LOW_CONF);
    const r = await extractEvent('x', 'auto');
    expect(r.source).toBe('server');
    expect(r.escalated).toBe(true);
    expect(mockServer).toHaveBeenCalledOnce();
  });

  it('on-device 固定なら低信頼度でも端末内結果を返す', async () => {
    mockStatus.mockResolvedValue('available');
    mockOnDevice.mockResolvedValue(LOW_CONF);
    const r = await extractEvent('x', 'on-device');
    expect(r.source).toBe('on-device');
    expect(mockServer).not.toHaveBeenCalled();
  });

  it('on-device 固定で端末内が失敗したらクラウドへ送らずエラー', async () => {
    mockStatus.mockResolvedValue('available');
    mockOnDevice.mockRejectedValue(new Error('boom'));
    await expect(extractEvent('x', 'on-device')).rejects.toThrow(OnDeviceParseError);
    expect(mockServer).not.toHaveBeenCalled();
  });

  it('on-device 固定でモデル未ダウンロードならダウンロード開始しエラー（クラウドへ送らない）', async () => {
    mockStatus.mockResolvedValue('downloadable');
    await expect(extractEvent('x', 'on-device')).rejects.toThrow(OnDeviceParseError);
    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockServer).not.toHaveBeenCalled();
  });

  it('on-device 固定でダウンロード中ならエラー（クラウドへ送らない）', async () => {
    mockStatus.mockResolvedValue('downloading');
    await expect(extractEvent('x', 'on-device')).rejects.toThrow(OnDeviceParseError);
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockServer).not.toHaveBeenCalled();
  });

  it('on-device 固定で利用不可環境ならエラー（クラウドへ送らない）', async () => {
    mockStatus.mockResolvedValue('unavailable');
    await expect(extractEvent('x', 'on-device')).rejects.toThrow(OnDeviceParseError);
    expect(mockServer).not.toHaveBeenCalled();
  });

  it('端末内が例外を投げたらサーバーで救済', async () => {
    mockStatus.mockResolvedValue('available');
    mockOnDevice.mockRejectedValue(new Error('boom'));
    const r = await extractEvent('x', 'auto');
    expect(r.source).toBe('server');
    expect(r.escalated).toBe(true);
  });

  it('端末内が使えなければサーバー（ダウンロードは開始しない）', async () => {
    mockStatus.mockResolvedValue('unavailable');
    const r = await extractEvent('x', 'auto');
    expect(r.source).toBe('server');
    expect(mockOnDevice).not.toHaveBeenCalled();
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('モデル未ダウンロードならダウンロードを開始しつつサーバーで解析', async () => {
    mockStatus.mockResolvedValue('downloadable');
    const r = await extractEvent('x', 'auto');
    expect(r.source).toBe('server');
    expect(r.modelDownloadStarted).toBe(true);
    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockOnDevice).not.toHaveBeenCalled();
  });

  it('ダウンロード中はサーバーで解析（多重ダウンロードは誘発しない）', async () => {
    mockStatus.mockResolvedValue('downloading');
    const r = await extractEvent('x', 'auto');
    expect(r.source).toBe('server');
    expect(r.modelDownloadStarted).toBeUndefined();
    expect(mockDownload).not.toHaveBeenCalled();
  });
});
