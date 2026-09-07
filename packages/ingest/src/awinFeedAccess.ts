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

// ---------------------------------------------------------------------------
// AWIN_OAUTH2 -- HESABIN GERÇEKTEN SAHİP OLDUĞU KİMLİK BİLGİSİ
// ---------------------------------------------------------------------------
//
// Hesap sahibi kimlik bilgisini Vercel'de `AWIN_OAUTH2` adıyla tutuyor.
// Aşağıdaki erişimci onu SUNUCU TARAFINDA okur, maskeleme defterine yazar ve
// yoksa fail-closed davranır.
//
// BU KİMLİK BİLGİSİ HİÇBİR İSTEĞE BAĞLANMADI. Sebep, eksiklik değil KARAR:
//
//   * Awin'in OAuth2 sözleşmesi (token ucu, grant type, alan adları, sürenin
//     nasıl yenilendiği) bu ortamda DOĞRULANAMIYOR: developer/help/wiki/api/
//     productdata.awin.com hostlarının beşi de egress izin listesinde değil
//     (ölçüldü: http=000).
//   * Ürün feed indirmenin `productdata.awin.com/.../apikey/<x>/...` biçimi
//     AYRI bir kimlik yüzeyi. OAuth2 jetonunun o yüzeyde geçerli olup
//     olmadığı da doğrulanamadı.
//
// Tahminle yazılmış bir akış -- "client_id mi clientId mi", "Bearer mı
// X-Api-Key mi" -- ilk gerçek çağrıda sessizce 401 döner ve hatayı Awin'e
// yıktırırdı. Doğrulanana kadar bu değer OKUNUR ama KULLANILMAZ.

/** Kimlik bilgisinin okunacağı ortam değişkeni. DEĞER DEĞİL, AD. */
export const AWIN_OAUTH2_ENV = 'AWIN_OAUTH2';

/** Kimlik bilgisi tanımlı mı? Değeri DÖNDÜRMEZ. */
export function hasAwinOAuth2Credential(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env[AWIN_OAUTH2_ENV] === 'string' && env[AWIN_OAUTH2_ENV]!.trim().length > 0;
}

/**
 * Kimlik bilgisini okur ve maskeleme defterine yazar.
 *
 * BİÇİMİ HAKKINDA HİÇBİR ŞEY VARSAYMAZ: JSON mu, `id:secret` mi, düz jeton mu
 * -- ayrıştırmaz. Ayrıştırmak, doğrulanmamış bir sözleşmeyi koda gömmek
 * olurdu. Çağıran, biçimi Awin'in resmî dokümanından DOĞRULADIKTAN sonra
 * yorumlar.
 */
export function requireAwinOAuth2Credential(env: NodeJS.ProcessEnv = process.env): string {
  const deger = env[AWIN_OAUTH2_ENV]?.trim();
  if (!deger) {
    throw new AwinFeedError(
      `${AWIN_OAUTH2_ENV} tanımlı değil; Awin kimlik doğrulaması yapılamaz.`,
      'missing_api_key',
    );
  }
  registerSecret(deger);
  return deger;
}
