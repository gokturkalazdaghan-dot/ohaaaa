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
// Hesap sahibi kimlik bilgisini Vercel'de `AWIN_OAUTH2` adıyla tutuyor. Bu
// çalıştırma ortamına ise `awin_OAuth2` adıyla enjekte ediliyor. İKİ AD DA
// ÖLÇÜLDÜ, ikisi de UYDURULMADI:
//
//   AWIN_OAUTH2   hesap sahibinin beyanı (Vercel Production)
//   awin_OAuth2   bu ortamda `env` çıktısında GÖRÜLEN ad
//
// Aşağıdaki erişimci ikisini SIRAYLA dener. Tek ada kilitlenseydi kimlik
// bilgisi ortamda dururken "tanımlı değil" denirdi -- ve o hata, eksik bir
// secret'la birebir aynı görünürdü.
//
// ---------------------------------------------------------------------------
// KİMLİK BİLGİSİ HÂLÂ HİÇBİR İSTEĞE BAĞLI DEĞİL -- ARTIK BAŞKA SEBEPLE
// ---------------------------------------------------------------------------
//
// EGRESS ARTIK ENGEL DEĞİL. 07/09/2026 ölçümü:
//
//   productdata.awin.com   ULAŞILABİLİR (CloudFront, HTTP/2 404 + x-amz-cf-id)
//   api.awin.com           ULAŞILABİLİR (401 invalid_token -- Awin'in kendi
//                          cevabı, vekilin değil)
//   developer.awin.com     ULAŞILABİLİR (301)
//   ui.awin.com            ENGELLİ (CONNECT'e 403)
//   help.awin.com          ENGELLİ (CONNECT'e 403)
//   wiki.awin.com          ENGELLİ (CONNECT'e 403)
//
// ENGEL ARTIK KİMLİK BİLGİSİNİN KENDİSİ. Ortamdaki değer 36 karakterlik bir
// UUID (değeri okunmadı, YALNIZCA biçimi ölçüldü) ve İKİ YÜZEYİN DE hiçbirinde
// kabul edilmiyor:
//
//   api.awin.com          `Authorization: Bearer <değer>` -> 401 invalid_token
//   productdata.awin.com  `/apikey/<değer>/` -> cevaplar, AYNI BİÇİMDE
//                         UYDURULMUŞ bir UUID'ninkiyle KARAKTERİ KARAKTERİNE
//                         AYNI (fid'siz 400 "You need to specify at least
//                         one of...", fid 111515 ile 404 "Feed not found").
//
// Son satır belirleyici: uç, gerçek değerle sahte değeri AYIRT ETMİYOR. Yani
// bu UUID bir Product Feed API anahtarı DEĞİL. En olası açıklama, OAuth2
// uygulamasının `client_id`si olması -- ama bu bir ÇIKARIM, doğrulanmadı:
// token ucunu, grant type'ı ve alan adlarını yazan help/wiki hostları hâlâ
// engelli.
//
// Bu yüzden karar değişmedi, gerekçesi değişti: değer OKUNUR, maskeleme
// defterine yazılır, HİÇBİR İSTEĞE BAĞLANMAZ. Tahminle kurulmuş bir token
// akışı ilk gerçek çağrıda 401 döner ve hatayı Awin'e yıktırırdı.

/** Kimlik bilgisinin okunacağı ortam değişkeni (kanonik ad). DEĞER DEĞİL, AD. */
export const AWIN_OAUTH2_ENV = 'AWIN_OAUTH2';

/**
 * Kimlik bilgisinin arandığı ADLAR, sırayla.
 *
 * İkisi de GÖZLEMLENMİŞ addır; buraya tahminle bir ad EKLENMEZ. Yeni bir ad
 * ancak o adla enjekte edildiği ölçüldüğünde eklenir -- aksi hâlde liste,
 * "bir yerlerde şöyle de denebilir" tahminlerinin çöplüğüne döner.
 */
export const AWIN_OAUTH2_ENV_NAMES = [AWIN_OAUTH2_ENV, 'awin_OAuth2'] as const;

/** Kimlik bilgisini TAŞIYAN değişkenin ADINI döndürür; değeri DÖNDÜRMEZ. */
export function resolveAwinOAuth2EnvName(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const ad of AWIN_OAUTH2_ENV_NAMES) {
    const deger = env[ad];
    if (typeof deger === 'string' && deger.trim().length > 0) return ad;
  }
  return null;
}

/** Kimlik bilgisi tanımlı mı? Değeri DÖNDÜRMEZ. */
export function hasAwinOAuth2Credential(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveAwinOAuth2EnvName(env) !== null;
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
  const ad = resolveAwinOAuth2EnvName(env);
  if (ad === null) {
    throw new AwinFeedError(
      `${AWIN_OAUTH2_ENV_NAMES.join(' / ')} tanımlı değil; Awin kimlik doğrulaması yapılamaz.`,
      'missing_api_key',
    );
  }
  const deger = env[ad]!.trim();
  registerSecret(deger);
  return deger;
}
