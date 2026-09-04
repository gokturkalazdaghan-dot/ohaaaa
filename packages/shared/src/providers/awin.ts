/**
 * `awin` — Awin ortaklık ağı.
 *
 * ======================================================================
 * BU DOSYA BİLEREK YARIM. NEDENİNİ OKUYUN.
 * ======================================================================
 * Awin publisher başvurusu (publisher ID 3074081) yazıldığı sırada
 * İNCELEMEDEYDİ. Awin'in resmî dokümanlarına bu ortamdan erişilemedi
 * (wiki.awin.com ve developer.awin.com ağ politikasıyla engelli).
 *
 * Dolayısıyla AŞAĞIDAKİLER YAZILMADI:
 *   • Postback/dönüşüm bildiriminin imza algoritması
 *   • Bildirimdeki alan adları (sipariş no, tutar, komisyon, durum)
 *   • API uç noktaları ve kimlik doğrulama biçimi
 *
 * Bunları tahmin ederek yazmak, ilk gerçek dönüşümde ya sessizce yanlış
 * tutar kaydetmek ya da doğrulamayı anlamsız kılmak demekti. Yanlış komisyon
 * kaydı, hiç kayıt olmamasından kötüdür: mutabakat gerçek sanılan bir sayının
 * üzerine kurulur.
 *
 * Bu yüzden `verifyPostback` ve `normalizePostback` KAPALI BAŞARISIZ OLUR
 * (fail closed): çağrıldıklarında `verification_unavailable` fırlatır ve
 * route bunu 503 ile yanıtlar. Hiçbir Awin bildirimi doğrulanmadan
 * veritabanına giremez.
 *
 * YAZILAN kısım, doğrulanabilir olanlarla sınırlı:
 *   • Yayıncı kimliği (operatör tarafından verildi)
 *   • clickref ↔ subid eşlemesi (deeplink şablonundan doğrudan çıkar)
 *   • Şablon iskeleti (operatör tarafından verildi)
 *
 * AÇILDIĞINDA NE GEREKİYOR: aşağıdaki iki metodun gövdesi + alan eşlemesi.
 * Sözleşmenin geri kalanı, registry ve route değişmeden kalır.
 */

import {
  ProviderError,
  type AffiliateProvider,
  type NormalizedConversion,
  type PostbackContext,
} from './types.js';

/**
 * Yayıncı kimliğimiz (`awinaffid`). Operatör tarafından bildirildi.
 *
 * Bu bir SIR DEĞİLDİR — her ortaklık linkinin içinde açıkça görünür ve
 * yayıncıyı tanımlar, yetkilendirmez. Sır olan `postback_secret` ve API
 * anahtarlarıdır; onlar koda hiç girmez, ortamdan okunur.
 */
export const AWIN_PUBLISHER_ID = '3074081';

/**
 * Deeplink şablonu iskeleti — OPERATÖR İÇİN REFERANS.
 *
 * Kod bunu kullanmaz; `merchants.deeplink_template` sütununa yazılacak
 * değerin biçimini gösterir. `{awinmid}` her REKLAMVEREN için farklıdır ve
 * Awin panelinden alınır; burada sabitlenmesi mümkün değildir.
 *
 * Ortak `buildAffiliateUrl` bu şablonu ZATEN üretebiliyor: `{url_encoded}` ve
 * `{subid}` yer tutucuları destekli, `awin1.com` de mağazanın izinli alan
 * adları arasına `allowedHostsForMerchant` tarafından otomatik ekleniyor.
 * Bu yüzden bu sağlayıcı `buildDeeplink` TANIMLAMAZ — çalışan bir mekanizmayı
 * ikizlemek, iki kopyanın zamanla ayrışması demektir.
 */
export const AWIN_DEEPLINK_TEMPLATE_SHAPE =
  'https://www.awin1.com/cread.php' +
  '?awinmid={awinmid}' +
  `&awinaffid=${AWIN_PUBLISHER_ID}` +
  '&clickref={subid}' +
  '&ued={url_encoded}';

/**
 * Awin `clickref` ↔ Ohaaaa `subid` eşlemesi.
 *
 * Awin, yayıncının tıklama anında gönderdiği `clickref` değerini dönüşüm
 * raporunda geri verir. Bizim tarafta bu değer `clicks.subid`'dir.
 * Eşleme saf bir ad değişikliğidir; protokol varsayımı içermez.
 *
 * Boş/eksik değer `null` döner: atıfsız bir dönüşüm, yanlış atfedilmiş bir
 * dönüşümden iyidir.
 */
export function awinClickrefToSubid(clickref: unknown): string | null {
  if (typeof clickref !== 'string') return null;

  const trimmed = clickref.trim();
  if (trimmed === '') return null;

  // `clicks_subid_format` kısıtı: [A-Za-z0-9_-]{16,64}
  // Uymayan bir değer bizim üretmediğimiz bir clickref'tir; atıf kurulmaz.
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(trimmed)) return null;

  return trimmed;
}

/** Açılış için gereken bilgiler — hata metninde ve panelde aynı liste. */
const EKSIK_BILGILER = [
  'postback imza algoritmasi',
  'bildirim alan adlari (siparis no, tutar, komisyon, durum)',
  'durum degerlerinin karsiliklari',
].join(', ');

export const awinProvider: AffiliateProvider = {
  network: 'awin',
  displayName: 'Awin',

  verifyPostback(_context: PostbackContext): never {
    throw new ProviderError(
      `Awin postback dogrulamasi henuz yapilandirilmadi. Gerekenler: ${EKSIK_BILGILER}.`,
      'verification_unavailable',
    );
  },

  normalizePostback(_payload: unknown): NormalizedConversion {
    throw new ProviderError(
      `Awin bildirim alan eslemesi henuz yapilandirilmadi. Gerekenler: ${EKSIK_BILGILER}.`,
      'verification_unavailable',
    );
  },

  // buildDeeplink BILEREK TANIMSIZ: ortak sablon akisi Awin'i zaten karsiliyor.
};
