// ICS（iCalendar / RFC 5545）生成サービス（純粋関数）
// 旧 app.js の createICS / escapeICS / foldICSLine を集約・TS化。挙動は不変。

import { randomUUID } from 'node:crypto';
import { formatICSDate } from '../lib/datetime.js';
import { DEFAULT_TIMEZONE, type CalendarEventInput } from '../../shared/types.js';

/**
 * ICS テキストプロパティ値をエスケープする（RFC 5545 §3.3.11）。
 * バックスラッシュ・セミコロン・カンマをエスケープし、
 * 生の CR は除去、LF は `\n` リテラルへ変換する（CRLFインジェクション対策）。
 */
export function escapeICS(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: 1行を75オクテット以内に折り返す。
 * マルチバイト文字の途中で切らないようバイト境界を調整し、
 * 継続行の先頭に空白を付ける。
 */
export function foldICSLine(line: string): string {
  const MAX_OCTETS = 75;
  const bytes = Buffer.from(line, 'utf-8');
  if (bytes.length <= MAX_OCTETS) return line;

  const parts: string[] = [];
  let start = 0;
  let limit = MAX_OCTETS;
  while (start < bytes.length) {
    // マルチバイト文字の途中で切らないよう調整（継続バイト 0b10xxxxxx を避ける）
    let end = Math.min(start + limit, bytes.length);
    while (end > start && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }
    parts.push(bytes.subarray(start, end).toString('utf-8'));
    start = end;
    limit = MAX_OCTETS - 1; // 継続行は先頭にスペースが付くため1オクテット減
  }
  return parts.join('\r\n ');
}

/**
 * 予定情報から ICS（VCALENDAR/VEVENT）テキストを生成する。
 * - CRLFインジェクション対策として全プロパティ値をエスケープ
 * - 不正日時は空文字（NaN を出力しない）
 * - 全行を75オクテットで折り返し、CRLF で連結
 */
export function createICS(input: CalendarEventInput): string {
  const { title, location, startTime, endTime, description, emailContent, timezone } = input;

  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const uid = randomUUID() + '@example.com';

  const dtStart = formatICSDate(startTime);
  const dtEnd = formatICSDate(endTime);
  const tz = timezone || DEFAULT_TIMEZONE;

  const escTitle = escapeICS(title || '');
  const escLocation = escapeICS(location || '');
  const escDescription = escapeICS(description || '');
  const escEmailBody = escapeICS(emailContent || '');

  const fullDescription = `${escDescription}\\n\\n--- Original Email ---\\n${escEmailBody}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'PRODID:-//Example Inc.//Calendar Test//JA',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `SUMMARY:${escTitle}`,
    `LOCATION:${escLocation}`,
    `DESCRIPTION:${fullDescription}`,
    `DTSTART;TZID=${tz}:${dtStart}`,
    `DTEND;TZID=${tz}:${dtEnd}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldICSLine).join('\r\n');
}
