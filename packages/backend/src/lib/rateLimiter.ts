/**
 * Kayan pencereli (sliding window) hız sınırlayıcı.
 *
 * Sabit pencere (fixed window) sayacı, pencere sınırında iki katı trafiğe
 * izin verir: 09:59:59'da 600, 10:00:00'da 600 daha. Kayan pencere, son
 * 60 saniyeye bakarak bu boşluğu kapatır.
 *
 * KAPSAM: Bu sınırlayıcı süreç belleğindedir. Tek örnek (instance) için
 * doğrudur; yatay ölçeklemede her örnek kendi sayacını tutacağı için efektif
 * tavan örnek sayısıyla çarpılır. Çok örnekli kuruluma geçildiğinde
 * `RateLimiter` arayüzünü koruyup Redis destekli bir uygulamayla
 * değiştirmek yeterlidir (bkz. docs/architecture.md).
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Pencerenin sıfırlanacağı an (Unix saniye) — Retry-After başlığı için. */
  resetAt: number;
}

export interface RateLimiter {
  check(key: string, limitPerMinute: number): RateLimitResult;
}

const WINDOW_MS = 60_000;

export function createRateLimiter(now: () => number = Date.now): RateLimiter & {
  /** Bellek sızıntısını önlemek için eski kayıtları temizler. */
  prune(): number;
  size(): number;
} {
  /** anahtar -> pencere içindeki istek zaman damgaları (artan sırada). */
  const hits = new Map<string, number[]>();

  function check(key: string, limitPerMinute: number): RateLimitResult {
    const current = now();
    const windowStart = current - WINDOW_MS;

    const timestamps = hits.get(key) ?? [];

    // Pencerenin dışında kalanları at. Dizi sıralı olduğu için baştan
    // kaç elemanın düştüğünü bulmak yeterli — tam filtreleme gerekmez.
    let firstInWindow = 0;
    while (firstInWindow < timestamps.length && timestamps[firstInWindow]! <= windowStart) {
      firstInWindow += 1;
    }
    const active = firstInWindow > 0 ? timestamps.slice(firstInWindow) : timestamps;

    if (active.length >= limitPerMinute) {
      hits.set(key, active);
      return {
        allowed: false,
        limit: limitPerMinute,
        remaining: 0,
        resetAt: Math.ceil((active[0]! + WINDOW_MS) / 1000),
      };
    }

    active.push(current);
    hits.set(key, active);

    return {
      allowed: true,
      limit: limitPerMinute,
      remaining: limitPerMinute - active.length,
      resetAt: Math.ceil((active[0]! + WINDOW_MS) / 1000),
    };
  }

  function prune(): number {
    const cutoff = now() - WINDOW_MS;
    let removed = 0;

    for (const [key, timestamps] of hits) {
      const last = timestamps[timestamps.length - 1];
      if (last === undefined || last <= cutoff) {
        hits.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  return { check, prune, size: () => hits.size };
}
