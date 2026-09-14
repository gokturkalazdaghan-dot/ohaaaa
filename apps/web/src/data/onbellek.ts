/**
 * Katalog okumalarının önbellek katmanı.
 *
 * `catalog.ts` içinden ÇIKARILDI, çünkü artık tek tüketicisi değil: pazar
 * kataloğu (`markets.ts`) da aynı süreleri ve aynı etiketi kullanmak
 * zorunda. Kopyalamak, iki yerde ayrışacak iki doğruluk kaynağı üretirdi.
 */

import { unstable_cache } from 'next/cache';

export const ONBELLEK = {
  /** Kategori ağacı ve listesi: taksonomi göçle değişir, beslemeyle değil. */
  taksonomi: 3600,
  /** Mağaza listesi: yeni ortak eklenmesi nadir. */
  magazalar: 1800,
  /** Vitrin ve kampanyalar: beslemeden etkilenir. */
  vitrin: 900,
  /** Gezinme amaçlı arama (serbest metin YOK): fiyatlar beslemeyle değişir. */
  listeleme: 600,
} as const;

/**
 * Bir katalog okumasını önbelleğe alır.
 *
 * `unstable_cache` anahtarı `anahtar` + fonksiyonun ARGÜMANLARINDAN üretir,
 * dolayısıyla aynı fonksiyonun farklı parametreli çağrıları birbirine
 * karışmaz.
 */
export function onbellekle<A extends unknown[], R>(
  anahtar: string,
  fn: (...args: A) => Promise<R>,
  saniye: number,
): (...args: A) => Promise<R> {
  return unstable_cache(fn, ['katalog', anahtar], {
    revalidate: saniye,
    tags: ['katalog'],
  });
}
