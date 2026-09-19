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
 * ÖNBELLEK ANAHTARININ SÜRÜMÜ — TOPLU VERİ DEĞİŞİKLİĞİNDEN SONRA ARTIRIN.
 *
 * NEDEN VAR: ÖLÇÜLEN ARIZA
 * 27.802 ürün grubu yeni kategorilerine taşındı, site iki kez yeniden
 * dağıtıldı ve üst çubuk taşımadan ÖNCEKİ ağacı sunmaya devam etti --
 * bir saatten uzun süre, `revalidate` 3600 olmasına rağmen.
 *
 * Sebebi Next'in kendi kodunda yazılı (`unstable-cache.js`): bayat bir
 * girdi arka planda tazelenir, tazeleme DÜŞERSE hata YUTULUR ve BAYAT
 * DEĞER dönmeye devam eder. Tazeleme, `kategori_grup_sayilari()` 3.444 ms
 * sürdüğü için düşüyordu -- `anon` rolünün deyim zaman aşımı 3 saniye.
 * Sorgu düzeltildi (dar indeks + vacuum, 41 ms) ama girdi yine de
 * kendiliğinden tazelenmedi.
 *
 * Yani elde İKİ kaldıraç olmalı ve ikisi de farklı bir şeye dayanmalı:
 *
 *   POST /api/cron/katalog-tazele   Rutin yol. Sır ister (CRON_SECRET),
 *                                   alım turundan sonra çağrılır.
 *   SÜRÜM (burası)                  Dağıtımla çalışır, sır istemez.
 *                                   Artırıldığında anahtar tamamen
 *                                   değişir; eski girdi öksüz kalır ve
 *                                   ilk istek veriyi SIFIRDAN okur.
 *
 * Sürümü artırmak katalog okumalarını bir kereliğine yavaşlatır (önbellek
 * boş), bu yüzden her dağıtımda değil, YALNIZCA toplu bir veri
 * değişikliğinden sonra artırılır.
 *
 * 2 -> ürünlerin taksonomiye dağıtılması (34.722 grup).
 */
const KATALOG_SURUMU = 'v2';

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
  return unstable_cache(fn, ['katalog', KATALOG_SURUMU, anahtar], {
    revalidate: saniye,
    tags: ['katalog'],
  });
}
