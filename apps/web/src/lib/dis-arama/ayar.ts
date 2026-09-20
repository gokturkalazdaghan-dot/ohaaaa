import 'server-only';

/**
 * Talep-anı dış ürün aramasının YAPILANDIRMASI -- tek yer.
 *
 * ======================================================================
 * ANAHTAR YALNIZCA SUNUCUDA
 * ======================================================================
 * `server-only` ithali bir belge değil, DERLEME ZAMANI KİLİDİDİR: bu
 * modül bir istemci bileşeninden ithal edilirse Next.js derlemeyi kırar.
 * Anahtarın tarayıcıya sızmasının tek yolu buydu ve kapatıldı.
 *
 * Değişken adında `NEXT_PUBLIC_` ÖNEKİ YOKTUR ve olmamalıdır. `npm run
 * verify:secrets` bunu ayrıca denetler (bkz. scripts/verify-secrets.mjs).
 *
 * ======================================================================
 * KİMLİK BİLGİSİ YOKSA SİSTEM KAPALIDIR -- SAHTE VERİYLE AÇILMAZ
 * ======================================================================
 * `AFFILIATE_COM_API_KEY` tanımsızsa `disAramaAyari()` `null` döner,
 * hiçbir ağ isteği yapılmaz ve arama sayfası yalnızca Ohaaaa kataloğunu
 * gösterir -- yani bugünkü davranışın BİREBİR aynısı.
 *
 * Mock/örnek veriyle "çalışıyor gibi" göstermek bilinçli olarak
 * yapılmadı: sahte ürün, gerçek fiyat ve gerçek stok sanılır; bir
 * karşılaştırma sitesinde bu, kullanıcıya doğrudan yalan söylemektir.
 */

/**
 * ÖNBELLEK SÜRESİ -- ORTAK ŞARTLARININ SINIRI, PERFORMANS AYARI DEĞİL.
 *
 * Talep-anı sağlayıcıların sözleşmeleri genellikle katalog kopyası
 * tutmayı yasaklar. "Önbellek" ile "ayna" arasındaki fark tek bir sayıdır:
 * SÜRE. Bu yüzden süre hem varsayılanı hem de ÜST SINIRI olan bir değer:
 * yanlış yapılandırılmış bir ortam değişkeni, sistemi sessizce bir
 * katalog aynasına çeviremez.
 *
 * Alt sınır da var: 30 saniyenin altındaki bir süre önbelleği anlamsız
 * kılar (her istek sağlayıcıya gider) ve hız sınırını yer.
 */
export const ONBELLEK_VARSAYILAN_SANIYE = 300;
export const ONBELLEK_EN_UZUN_SANIYE = 900;
export const ONBELLEK_EN_KISA_SANIYE = 30;

/** Zaman aşımı sınırları. Üst sınır arama sayfasının önünde durduğu için dar. */
export const ZAMAN_ASIMI_VARSAYILAN_MS = 4000;
export const ZAMAN_ASIMI_EN_UZUN_MS = 10_000;

export interface DisAramaAyari {
  apiKey: string;
  /** Boşsa sağlayıcının kendi varsayılan ucu kullanılır. */
  endpoint: string;
  timeoutMs: number;
  onbellekSaniye: number;
}

/** Ortam değişkenini sayı olarak okur; yoksa/geçersizse yedeği verir, sonra sınırlar. */
function sayi(ad: string, yedek: number, enAz: number, enCok: number): number {
  const ham = process.env[ad]?.trim();
  const deger = ham ? Number(ham) : NaN;
  const secilen = Number.isFinite(deger) && deger > 0 ? Math.trunc(deger) : yedek;

  return Math.min(Math.max(secilen, enAz), enCok);
}

/**
 * Yapılandırma -- kimlik bilgisi yoksa `null`.
 *
 * Her çağrıda ortam okunur, modül düzeyinde ÖNBELLEKLENMEZ. Sunucusuz
 * ortamda modül ömrü belirsizdir ve anahtarı bir modül değişkeninde
 * tutmak, onu gereğinden uzun süre bellekte tutmak demektir.
 */
export function disAramaAyari(): DisAramaAyari | null {
  const apiKey = process.env.AFFILIATE_COM_API_KEY?.trim() ?? '';
  if (apiKey === '') return null;

  return {
    apiKey,
    endpoint: process.env.AFFILIATE_COM_ENDPOINT?.trim() ?? '',
    timeoutMs: sayi(
      'AFFILIATE_COM_TIMEOUT_MS',
      ZAMAN_ASIMI_VARSAYILAN_MS,
      500,
      ZAMAN_ASIMI_EN_UZUN_MS,
    ),
    onbellekSaniye: sayi(
      'AFFILIATE_COM_ONBELLEK_SANIYE',
      ONBELLEK_VARSAYILAN_SANIYE,
      ONBELLEK_EN_KISA_SANIYE,
      ONBELLEK_EN_UZUN_SANIYE,
    ),
  };
}

/** Dış arama yapılandırılmış mı? Arayüz ve sağlık sayfaları için. */
export function disAramaAcikMi(): boolean {
  return disAramaAyari() !== null;
}
