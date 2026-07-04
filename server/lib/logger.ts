// 軽量な構造化ロガー。本番は JSON 1行、開発は読みやすい整形で出力する。
// デバッグログは本番では抑制される。
import { config } from '../config/index.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
type Meta = Record<string, unknown>;

function emit(level: Level, msg: string, meta?: Meta): void {
  const line = config.isProd
    ? JSON.stringify({ level, msg, time: new Date().toISOString(), ...meta })
    : `[${level}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug(msg: string, meta?: Meta) {
    if (!config.isProd) emit('debug', msg, meta);
  },
  info(msg: string, meta?: Meta) {
    emit('info', msg, meta);
  },
  warn(msg: string, meta?: Meta) {
    emit('warn', msg, meta);
  },
  error(msg: string, meta?: Meta) {
    emit('error', msg, meta);
  },
};
