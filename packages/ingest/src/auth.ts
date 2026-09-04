/**
 * Feed kimlik doğrulaması.
 *
 * NEDEN VAR: sistem yalnızca ADRESE GÖMÜLÜ jetonu destekliyordu
 * (`...?token=${OHAAAA_FEED_TOKEN}`). Ortaklık ağlarının önemli bir kısmı
 * bunun yerine `Authorization` başlığı ister. Sağlayıcı belli olduğunda
 * yöntemin desteklenmediğini keşfetmek, ilk gerçek bağlantıyı kod
 * beklemeye çevirirdi.
 *
 * SAĞLAYICI UYDURULMADI. Burada hiçbir ağın adı, adresi ya da jeton biçimi
 * yok -- yalnızca üç taşıyıcı yöntem. Hangisinin kullanılacağı
 * `sources.auth_type` sütununda, gerçek bir kaynak açıldığında yazılır.
 *
 * SIR SÜTUNDA DEĞİL, SÜTUNDA SIRRIN ADI DURUR.
 * `auth_secret_ref` bir ORTAM DEĞİŞKENİ ADI taşır ("OHAAAA_FEED_TOKEN"),
 * değerini değil. Değeri sütuna yazmak, kimlik bilgisini veritabanında düz
 * metin tutmak demekti: yedeklerde, panelde ve her `select *` çıktısında.
 * Bu, adres şablonunda zaten uygulanan kuralın başlıklara genişletilmiş
 * hâli -- iki ayrı kural değil, aynı kural.
 */

import { IngestError } from './errors.js';
import { registerSecret } from './http/redact.js';

/** Desteklenen taşıyıcı yöntemler. */
export type AuthType = 'query' | 'bearer' | 'basic';

export const AUTH_TYPES: readonly AuthType[] = ['query', 'bearer', 'basic'];

export function isAuthType(value: unknown): value is AuthType {
  return typeof value === 'string' && (AUTH_TYPES as readonly string[]).includes(value);
}

/**
 * Bir kaynağın kimlik doğrulama başlıklarını ortamdan üretir.
 *
 * `query` için başlık YOKTUR: kimlik bilgisi adres şablonunda taşınır ve
 * `expandSecretPlaceholders` onu zaten çözüyor. Buraya boş nesne dönmek,
 * iki yolun tek bir çağrı noktasından geçmesini sağlıyor -- çağıran
 * "hangi yöntem" diye dallanmak zorunda kalmıyor.
 *
 * Üretilen değer ANINDA maskeleme defterine yazılır: bundan sonra jeton bir
 * hata metnine, günlüğe ya da veritabanı sütununa girerse silinir.
 */
export function buildAuthHeaders(
  source: { authType?: AuthType | null; authSecretRef?: string | null; slug?: string },
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const tur: AuthType = source.authType ?? 'query';

  if (tur === 'query') return {};

  const ad = source.authSecretRef;
  if (!ad) {
    /*
     * Yapılandırma eksik: başlık yöntemi seçilmiş ama hangi ortam
     * değişkeninden okunacağı söylenmemiş. Kimliksiz istek gönderip
     * 401 almak ve sebebi "sağlayıcı reddetti" sanmak yerine burada
     * açıkça duruyoruz.
     */
    throw new IngestError(
      'CONFIG_ERROR',
      `Kaynak '${tur}' kimlik doğrulaması istiyor ama auth_secret_ref boş.`,
      true,
    );
  }

  const deger = env[ad];
  if (typeof deger !== 'string' || deger.length === 0) {
    // Hata DEĞİŞKEN ADINI söyler (güvenli), değerini değil.
    throw new IngestError(
      'CONFIG_ERROR',
      `Kimlik doğrulama değişkeni ortamda tanımlı değil: ${ad}`,
      true,
    );
  }

  registerSecret(deger);

  if (tur === 'bearer') {
    return { authorization: `Bearer ${deger}` };
  }

  /*
   * BASIC: değişken `kullanici:parola` biçiminde tutulur ve base64'e
   * burada çevrilir. Base64'ü operatörden istemek iki hataya açıktı --
   * yanlış kodlama ve "base64 şifrelemedir" yanılgısı. Ayrıca kodlanmış
   * hâli maskeleme defterine de yazılıyor: yalnızca ham değeri kaydetmek,
   * başlığa giren kodlanmış biçimin maskelenmeden kalması demekti.
   */
  if (!deger.includes(':')) {
    throw new IngestError(
      'CONFIG_ERROR',
      `Basic kimlik doğrulama için ${ad} değişkeni 'kullanici:parola' biçiminde olmalı.`,
      true,
    );
  }

  const kodlanmis = Buffer.from(deger, 'utf8').toString('base64');
  registerSecret(kodlanmis);

  return { authorization: `Basic ${kodlanmis}` };
}
