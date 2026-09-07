/**
 * Awin feed indirme anahtarının ÇÖZÜMLENMESİ.
 *
 * ANAHTAR TEK YÖNLÜ AKAR: ortam değişkeni -> `buildAwinFeedUrl` -> `fetch`.
 * Başka hiçbir yere gitmez. Özellikle:
 *
 *   - VERİTABANINA YAZILMAZ. `sources.endpoint_url` adres bekler, adres
 *     anahtarı içinde taşır; yazılsaydı yedeklere, `pg_dump` çıktısına ve
 *     yönetim panelindeki her ekran görüntüsüne sızardı. Veritabanında
 *     yalnızca FEED KİMLİĞİ durur (`programs.network_feed_id`).
 *   - LOG'A YAZILMAZ. Hata mesajları adres taşıyabilir; bu yüzden bu
 *     modülden çıkan her metin `redactAwinKey`ten geçer.
 *   - İSTEMCİ PAKETİNE GİRMEZ. Bu dosya `@ohaaaa/ingest` içinde; o paket
 *     sunucu tarafı işçi tarafından kullanılıyor, web istemcisine
 *     paketlenmiyor.
 *   - TEST FIXTURE'INA YAZILMAZ. Testler anahtarı parametreyle veriyor;
 *     depoda gerçek bir anahtar yok.
 */

import { AwinFeedError, redactAwinKey } from '@ohaaaa/shared/providers';

import { redactError, registerSecret } from './http/redact.js';

/** Anahtarın okunacağı ortam değişkeni. DEĞER DEĞİL, AD. */
export const AWIN_DATAFEED_API_KEY_ENV = 'AWIN_DATAFEED_API_KEY';

/**
 * Anahtar tanımlı mı? Değeri DÖNDÜRMEZ.
 *
 * Çağıranların çoğunun bilmek istediği şey budur ("feed çekebilir miyiz")
 * ve bu soruyu değeri eline almadan sorabilmeleri gerekir.
 */
export function hasAwinDatafeedKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env[AWIN_DATAFEED_API_KEY_ENV] === 'string'
    && env[AWIN_DATAFEED_API_KEY_ENV]!.trim().length > 0;
}

/**
 * Anahtarı okur. Yoksa FAIL-CLOSED: boş dizeyle devam edip 401 yemek yerine
 * burada durur, çünkü 401'in gövdesi log'a düşer ve orada adres olur.
 */
export function requireAwinDatafeedKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env[AWIN_DATAFEED_API_KEY_ENV]?.trim();
  if (!key) {
    throw new AwinFeedError(
      `${AWIN_DATAFEED_API_KEY_ENV} tanımlı değil; Awin feed'i indirilemez.`,
      'missing_api_key',
    );
  }

  /*
   * ANAHTAR, DEPONUN KENDI MASKELEME DEFTERINE YAZILIYOR.
   *
   * `redactAwinKey` KALIP tabanlıdır: tanıdığı adres biçimlerini temizler.
   * `registerSecret` ise DEĞER tabanlıdır -- anahtarın geçtiği HER metni,
   * biçimi ne olursa olsun maskeler. İkisi birbirinin yedeği:
   *
   *   kalıp   -> anahtarı görmemiş bir metni de temizler (ör. başka bir
   *              sürecin ürettiği log)
   *   değer   -> hiç öngörmediğimiz bir biçimde sızsa da yakalar
   *
   * İkinci bir maskeleme sistemi kurulmadı: bu, `buildAuthHeaders`ın zaten
   * kullandığı defterin ta kendisi.
   */
  registerSecret(key);
  return key;
}

/**
 * Bir hatayı log'lanabilir hâle getirir.
 *
 * `fetch` hataları istenen adresi mesaja koyar; adres anahtarı taşır. Bu
 * sarmalayıcı olmadan tek bir `console.error(err)` anahtarı log'a basardı --
 * ve log'lar veritabanından daha çok yere kopyalanır.
 */
export function safeAwinError(error: unknown): string {
  // ÖNCE değer tabanlı defter, SONRA kalıp tabanlı temizlik. Sıra önemli
  // değil ama ikisinin de uygulanması önemli: biri diğerinin kaçırdığını
  // yakalıyor.
  return redactAwinKey(redactError(error));
}
