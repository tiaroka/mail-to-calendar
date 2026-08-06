import { describe, it, expect, vi, afterEach } from 'vitest';

// 端末内AI（Prompt API）のタイトル補完を検証する。
// グローバル LanguageModel を差し替えるだけで済むよう、Chrome API は使わない。
import {
  extractOnDevice,
  sanitizeOrgName,
  composeTitle,
  buildOrgPrompt,
} from '../web/src/llm/onDeviceChrome.js';

const EMAIL = `【ABC/取材案内】
〇〇株式会社（ABC）は、2026年9月10日 14:00より新製品発表会を開催します。
会場: 東京国際フォーラム`;

// 実際に補完が効かなかったメール（本文冒頭は略称、署名に正式名称）を模した長文。
const LONG_EMAIL = `<シャープより> 9月1日(火) 統合AIサービス発表会のご案内

報道関係各位
いつもお世話になっております。シャープ広報の岸本です。
この度、AIが暮らしに寄り添い、家電と連携して毎日をサポートする統合AIサービスを発表します。
${'スマートフォン向けアプリを通じて、さまざまな家電と連携し、利用状況に応じた提案を行います。\n'.repeat(20)}
１．日時： 2026年9月1日（火）13:30～14:30（予定）
２．場所： シャープ 芝浦オフィス 22階 多目的ルーム

＜本件に関するお問合せ先＞
シャープ株式会社 広報部：sharppr@mail.sharp`;

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
    expect(sanitizeOrgName('架空商事株式会社', EMAIL)).toBeNull();
  });

  it('法人格を補われた回答は本文寄りの短い表記を採用する', () => {
    // 本文の冒頭は「シャープ」表記。モデルが正式名称を返しても拾えること
    expect(sanitizeOrgName('シャープ株式会社', LONG_EMAIL)).toBe('シャープ株式会社');
    expect(sanitizeOrgName('シャープ株式会社', EMAIL.replace('〇〇株式会社（ABC）', 'シャープ')))
      .toBe('シャープ');
  });

  it('「広報」などの肩書きを落として照合する', () => {
    expect(sanitizeOrgName('シャープ広報部', LONG_EMAIL)).toBe('シャープ');
  });

  it('英語の法人格も落として照合する', () => {
    expect(sanitizeOrgName('Example Inc.', 'Example の発表会です')).toBe('Example');
  });

  it('核が1文字しか残らない回答は採用しない', () => {
    expect(sanitizeOrgName('A株式会社', 'A の発表会です')).toBeNull();
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

describe('buildOrgPrompt（2回目のプロンプト）', () => {
  it('長文では冒頭と署名だけを抜粋し、中間は落とす', () => {
    const p = buildOrgPrompt(LONG_EMAIL);
    expect(p).toContain('<シャープより>');
    expect(p).toContain('シャープ株式会社 広報部');
    expect(p).toContain('（中略）');
    // 中間の繰り返し部分は落として本文より短くする（小型モデルのコンテキスト節約）
    expect(p.length).toBeLessThan(LONG_EMAIL.length);
    const repeats = (p.match(/スマートフォン向けアプリ/g) ?? []).length;
    expect(repeats).toBeLessThan(20);
  });

  it('短い本文はそのまま添える', () => {
    const p = buildOrgPrompt(EMAIL);
    expect(p).toContain('東京国際フォーラム');
    expect(p).not.toContain('（中略）');
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
    expect(session.destroy).toHaveBeenCalled();
  });

  it('署名に正式名称しかない長文でもタイトルを補完する', async () => {
    const json = JSON.stringify({
      title: '統合AIサービス発表会',
      startTime: '2026-09-01T13:30:00',
      endTime: '2026-09-01T14:30:00',
    });
    const session = mockSession([json, 'シャープ株式会社']);
    installLanguageModel(session);

    const info = await extractOnDevice(LONG_EMAIL);

    expect(info.title).toBe('シャープ株式会社 統合AIサービス発表会');
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
