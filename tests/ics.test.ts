import { describe, it, expect } from 'vitest';
import { createICS, escapeICS, foldICSLine } from '../server/services/ics.js';
import { formatICSDate, ensureSeconds } from '../server/lib/datetime.js';

describe('formatICSDate', () => {
  it('秒付きISO文字列を YYYYMMDDTHHMMSS に変換する', () => {
    expect(formatICSDate('2026-05-10T10:30:45')).toBe('20260510T103045');
  });

  it('秒なしの場合は 00 を補う', () => {
    expect(formatICSDate('2026-05-10T10:30')).toBe('20260510T103000');
  });

  it('不正な入力には空文字を返す（NaN を出さない）', () => {
    expect(formatICSDate('not-a-date')).toBe('');
    expect(formatICSDate('')).toBe('');
    expect(formatICSDate(undefined)).toBe('');
    expect(formatICSDate(null)).toBe('');
  });

  it('サーバーTZに依存せず文字列をそのまま扱う', () => {
    // タイムゾーン変換をしないので、入力の時刻がそのまま出る
    expect(formatICSDate('2026-12-31T23:59:59')).toBe('20261231T235959');
  });
});

describe('ensureSeconds', () => {
  it('分までの形式に :00 を補う', () => {
    expect(ensureSeconds('2026-05-10T10:30')).toBe('2026-05-10T10:30:00');
  });

  it('秒付きはそのまま返す', () => {
    expect(ensureSeconds('2026-05-10T10:30:45')).toBe('2026-05-10T10:30:45');
  });

  it('空文字・未定義は空文字', () => {
    expect(ensureSeconds('')).toBe('');
    expect(ensureSeconds(undefined)).toBe('');
  });
});

describe('escapeICS', () => {
  it('セミコロン・カンマ・バックスラッシュをエスケープする', () => {
    expect(escapeICS('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
  });

  it('生のCRを除去し、LFを \\n リテラルへ変換する（CRLFインジェクション対策）', () => {
    const result = escapeICS('Meeting\r\nATTENDEE:mailto:x@evil.com');
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
    expect(result).toContain('\\n');
  });
});

describe('foldICSLine', () => {
  it('75オクテット以内はそのまま返す', () => {
    const short = 'SUMMARY:短い';
    expect(foldICSLine(short)).toBe(short);
  });

  it('75オクテット超は CRLF+空白 で折り返す', () => {
    const long = 'DESCRIPTION:' + 'a'.repeat(200);
    const folded = foldICSLine(long);
    expect(folded).toContain('\r\n ');
    // 折り返し後、各物理行がオクテット制限内であること
    for (const physical of folded.split('\r\n')) {
      expect(Buffer.from(physical, 'utf-8').length).toBeLessThanOrEqual(75);
    }
  });

  it('マルチバイト文字の途中で分割しない（文字化けしない）', () => {
    const long = 'SUMMARY:' + 'あ'.repeat(60); // あ=3バイト → 180バイト超
    const folded = foldICSLine(long);
    // 連結し直すと元の文字列に戻る（バイト境界破壊なし）
    const rejoined = folded.split('\r\n ').join('');
    expect(rejoined).toBe(long);
    // 各物理行が有効なUTF-8（置換文字 U+FFFD を含まない）
    for (const physical of folded.split('\r\n ')) {
      expect(physical).not.toContain('�');
    }
  });
});

describe('createICS', () => {
  const base = {
    title: 'テスト会議',
    location: '東京',
    startTime: '2026-07-01T10:00:00',
    endTime: '2026-07-01T11:00:00',
    description: '説明',
    emailContent: 'メール本文',
    timezone: 'Asia/Tokyo',
  };

  it('VCALENDAR/VEVENT 構造を生成し CRLF で連結する', () => {
    const ics = createICS(base);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('DTSTART;TZID=Asia/Tokyo:20260701T100000');
    expect(ics).toContain('DTEND;TZID=Asia/Tokyo:20260701T110000');
  });

  it('Bug1: CRLFインジェクションで新プロパティが注入されない', () => {
    const ics = createICS({ ...base, title: 'Meeting\r\nATTENDEE:mailto:hacker@evil.com' });
    for (const line of ics.split('\r\n')) {
      expect(line).not.toContain('\r');
    }
    // 注入された ATTENDEE は独立した行にならない（SUMMARY値内にエスケープされる）
    expect(ics).not.toMatch(/^ATTENDEE:/m);
  });

  it('Bug2: DESCRIPTION 値内に生改行が含まれない', () => {
    const ics = createICS(base);
    for (const line of ics.split('\r\n')) {
      expect(line).not.toContain('\n');
    }
  });

  it('Bug3: 不正な日付入力で NaN を出力しない', () => {
    const ics = createICS({ ...base, startTime: 'not-a-date', endTime: 'also-invalid' });
    expect(ics).not.toContain('NaN');
  });

  it('タイムゾーン未指定時は Asia/Tokyo を使う', () => {
    const { timezone, ...noTz } = base;
    const ics = createICS(noTz);
    expect(ics).toContain('DTSTART;TZID=Asia/Tokyo:');
  });
});
