import { describe, it, expect, vi, afterEach } from 'vitest';

// 端末内AI（Prompt API）のタイトル補完を検証する。
// グローバル LanguageModel を差し替えるだけで済むよう、Chrome API は使わない。
import {
  extractOnDevice,
  sanitizeOrgName,
  composeTitle,
} from '../web/src/llm/onDeviceChrome.js';

const EMAIL = `【ABC/取材案内】
〇〇株式会社（ABC）は、2026年9月10日 14:00より新製品発表会を開催します。
会場: 東京国際フォーラム`;

const EXTRACTED_JSON = JSON.stringify({
  title: '新製品発表会',
  location: '東京国際フォーラム',
  startTime: '2026-09-10T14:00:00',
  endTime: '2026-09-10T15:00:00',
  description: '',
  timezone: 'Asia/Tokyo',
});

/** prompt() の戻り値を呼び出し順に返すセッションのモック。 */
function mockSession(responses: (string | Error)[]) {
  let i = 0;
  return {
    prompt: vi.fn(async (_input: string, _options?: unknown) => {
      const r = responses[i++];
      if (r instanceof Error) throw r;
      return r ?? '';
    }),
    destroy: vi.fn(),
  };
}

function installLanguageModel(session: ReturnType<typeof mockSession>) {
  (globalThis as Record<string, unknown>).LanguageModel = {
    availability: async () => 'available',
    create: async () => session,
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).LanguageModel;
  vi.restoreAllMocks();
});

describe('sanitizeOrgName（企業名の検証）', () => {
  it('本文にある名前はそのまま採用する', () => {
    expect(sanitizeOrgName('ABC', EMAIL)).toBe('ABC');
  });

  it('引用符・鉤括弧・末尾の句読点を落とす', () => {
    expect(sanitizeOrgName('「〇〇株式会社」。', EMAIL)).toBe('〇〇株式会社');
  });

  it('前後の空白と改行以降を落とす', () => {
    expect(sanitizeOrgName('  ABC \n補足: 略称です', EMAIL)).toBe('ABC');
  });

  it('本文にない名前は補わない（ハルシネーション対策）', () => {
    expect(sanitizeOrgName('架空商事', EMAIL)).toBeNull();
  });

  it('NONE や「なし」は企業名なしとみなす', () => {
    expect(sanitizeOrgName('NONE', EMAIL)).toBeNull();
    expect(sanitizeOrgName('なし', EMAIL)).toBeNull();
  });

  it('空文字・文章の返答は捨てる', () => {
    expect(sanitizeOrgName('', EMAIL)).toBeNull();
    expect(sanitizeOrgName('a'.repeat(31), 'a'.repeat(40))).toBeNull();
  });
});

describe('composeTitle（タイトル合成）', () => {
  it('企業名をタイトル先頭に付ける', () => {
    expect(composeTitle('新製品発表会', 'ABC')).toBe('ABC 新製品発表会');
  });

  it('既に企業名を含むタイトルは二重に付けない', () => {
    expect(composeTitle('ABC 新製品発表会', 'ABC')).toBe('ABC 新製品発表会');
  });

  it('タイトルが空なら企業名だけを返す', () => {
    expect(composeTitle('   ', 'ABC')).toBe('ABC');
  });
});

describe('extractOnDevice（抽出＋企業名補完）', () => {
  it('2回目の問い合わせで得た企業名をタイトルに補う', async () => {
    const session = mockSession([EXTRACTED_JSON, 'ABC']);
    installLanguageModel(session);

    const info = await extractOnDevice(EMAIL);

    expect(info.title).toBe('ABC 新製品発表会');
    expect(info.startTime).toBe('2026-09-10T14:00:00');
    expect(session.prompt).toHaveBeenCalledTimes(2);
    // 2回目は本文を再送しない（小型モデルのコンテキストを圧迫しないため）
    expect(session.prompt.mock.calls[1][0]).not.toContain('東京国際フォーラム');
    expect(session.destroy).toHaveBeenCalled();
  });

  it('企業名の問い合わせが失敗しても元のタイトルを返す', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = mockSession([EXTRACTED_JSON, new Error('model error')]);
    installLanguageModel(session);

    const info = await extractOnDevice(EMAIL);

    expect(info.title).toBe('新製品発表会');
  });

  it('本文にない企業名を返してきたら補完しない', async () => {
    const session = mockSession([EXTRACTED_JSON, '架空商事']);
    installLanguageModel(session);

    const info = await extractOnDevice(EMAIL);

    expect(info.title).toBe('新製品発表会');
  });

  it('端末内AIが無い環境では例外を投げる', async () => {
    await expect(extractOnDevice(EMAIL)).rejects.toThrow('端末内AIは利用できません');
  });
});
