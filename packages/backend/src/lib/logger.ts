/**
 * Sıfır bağımlılıklı yapısal (JSON) log.
 *
 * Üretimde tek satır JSON üretir; böylece herhangi bir log toplayıcı
 * (Vercel, Railway, CloudWatch, Loki) alanlara göre sorgulayabilir.
 * Geliştirmede okunabilir tek satıra düşer.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(
  minLevel: Level = 'info',
  pretty = process.env.NODE_ENV !== 'production',
  bindings: Record<string, unknown> = {},
): Logger {
  function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) return;

    const entry = {
      level,
      time: new Date().toISOString(),
      msg: message,
      ...bindings,
      ...fields,
    };

    const line = pretty
      ? `${entry.time} ${level.toUpperCase().padEnd(5)} ${message}` +
        (Object.keys({ ...bindings, ...fields }).length > 0
          ? ` ${JSON.stringify({ ...bindings, ...fields })}`
          : '')
      : JSON.stringify(entry);

    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  }

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (extra) => createLogger(minLevel, pretty, { ...bindings, ...extra }),
  };
}
