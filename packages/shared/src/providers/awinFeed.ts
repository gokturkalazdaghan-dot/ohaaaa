/**
 * Awin ürün feed'i: sütun eşlemesi ve indirme adresinin TÜRETİLMESİ.
 *
 * ADRES SAKLANMAZ, TÜRETİLİR
 * Awin'in yayıncı indirme adresi API ANAHTARINI İÇİNDE TAŞIR. Böyle bir
 * adresi `sources.endpoint_url`e yazmak, sırrı veritabanına yazmaktır:
 * yedeklere, log'lara, panel ekran görüntülerine ve `pg_dump` çıktısına
 * sızar. Bu yüzden veritabanında yalnızca FEED KİMLİĞİ durur; adres, indirme
 * anında anahtarla birleştirilerek üretilir ve hiçbir yere yazılmaz.
 *
 * Aynı kalıp `deeplink_template`in MID'den türetilmesiyle aynıdır.
 */

/** Awin yayıncı feed indirme kökü. */
const AWIN_FEED_HOST = 'productdata.awin.com';

/**
 * Anahtarı metinden siler.
 *
 * Hata mesajları ve log satırları adresi taşıyabilir; adres anahtarı taşır.
 * Redaksiyon TEK YERDE ve adres üreten modülün yanında duruyor: uzağa
 * konsaydı, bir sonraki `catch` bloğu onu çağırmayı unuturdu.
 */
export function redactAwinKey(text: string): string {
  return text.replace(/\/apikey\/[^/\s]+/gi, '/apikey/[REDACTED]');
}

export class AwinFeedError extends Error {
  constructor(
    message: string,
    readonly code: 'missing_api_key' | 'invalid_feed_id',
  ) {
    // Mesaj yine de redaksiyondan geçiyor: bu sınıf ileride adres taşıyan bir
    // mesajla çağrılabilir ve o an kimse redaksiyonu hatırlamayabilir.
    super(redactAwinKey(message));
    this.name = 'AwinFeedError';
  }
}

/** Feed kimliği yalnızca rakamdır (Awin: fid). */
export function isAwinFeedId(value: string): boolean {
  return /^[0-9]{1,12}$/.test(value);
}

/**
 * Feed kimliklerinden indirme adresi üretir.
 *
 * DÖNEN DEĞER BİR SIRDIR. Log'lanmaz, saklanmaz, hataya konmaz; yalnızca
 * `fetch`e verilir. Çağıran bunu bilsin diye tip adı da öyle.
 */
export function buildAwinFeedUrl(input: {
  feedIds: readonly string[];
  apiKey: string;
  /** Awin dil kodu; feed'in kendi dili. */
  language?: string;
  columns: readonly string[];
}): string {
  if (!input.apiKey) {
    throw new AwinFeedError(
      'AWIN_DATAFEED_API_KEY tanımlı değil; feed adresi üretilemez.',
      'missing_api_key',
    );
  }
  if (input.feedIds.length === 0 || !input.feedIds.every(isAwinFeedId)) {
    throw new AwinFeedError('Feed kimliği yalnızca rakam olabilir.', 'invalid_feed_id');
  }

  const fid = input.feedIds.join(',');
  const columns = input.columns.join(',');
  const language = input.language ?? 'en';

  /*
   * `compression/gzip`: alım hattı gzip AÇAR, zip'i reddeder
   * (`decodeFeedPayload`). Sıkıştırılmış istemek hem gövde sınırına takılmayı
   * hem de 100 binlik feed'lerde dakikalarca aktarımı önler.
   */
  return (
    `https://${AWIN_FEED_HOST}/datafeed/download` +
    `/apikey/${encodeURIComponent(input.apiKey)}` +
    `/language/${encodeURIComponent(language)}` +
    `/fid/${encodeURIComponent(fid)}` +
    `/columns/${encodeURIComponent(columns)}` +
    `/format/csv/delimiter/%2C/compression/gzip/adultcontent/1/`
  );
}

/**
 * Awin ürün feed'i -> Ohaaaa alan eşlemesi.
 *
 * GERÇEK BİR FEED'E KARŞI DOĞRULANDI: Alison US CA (MID 120101, feed 111515),
 * 5.594 satır. Sütun adları Awin'in feed'inde SABİTTİR, yani bu eşleme
 * advertiser'a göre değişmez -- her Awin feed'i aynı başlıkla gelir.
 *
 * NEDEN `search_price`
 * `search_price` müşterinin ödeyeceği güncel fiyattır; `store_price` bazı
 * feed'lerde boş ya da vergisiz gelir. Yanlış sütunu seçmek, karşılaştırmada
 * yanlış "en ucuz" göstermek olurdu.
 *
 * `display_price` KULLANILMAZ: biçimlenmiş bir metindir ("USD0.00") ve para
 * birimi ile tutarı tek hücrede taşır. Ondan fiyat ayıklamak, biçim değiştiği
 * gün sessizce yanlış sayı üretirdi.
 *
 * NEDEN `product_GTIN` DEĞİL `ean`
 * Awin ikisini de yayınlar. `normalizeGtin` zaten kontrol basamağını
 * doğruluyor ve 14 haneye tamamlıyor, yani hangisi dolu gelirse gelsin aynı
 * kanonik anahtarı üretir; `ean` sektörde daha yaygın doldurulan sütun.
 *
 * ÖLÇÜM (Alison US CA, feed 111515, 5.594 satır): `ean`, `product_GTIN`,
 * `mpn` ve `brand_name` sütunlarının DÖRDÜ DE tamamen boş. O feed'de kanonik
 * kimlik yalnızca başlıktan türeyebilirdi -- ki markasız başlık en zayıf
 * anahtardır. Eşleme yanlış değil; O FEED'DE VERİ YOK.
 */
export const AWIN_FEED_MAPPING = {
  external_id: 'aw_product_id',
  title: 'product_name',
  url: 'aw_deep_link',
  price: 'search_price',
  compare_at_price: 'rrp_price',
  currency: 'currency',
  stock: 'in_stock',
  gtin: 'ean',
  brand: 'brand_name',
  description: 'description',
  image: 'merchant_image_url',
  category: 'merchant_category',
  sku: 'merchant_product_id',
  shipping_fee: 'delivery_cost',
} as const;

/**
 * İndirmede istenecek sütunlar.
 *
 * HEPSİ İSTENMİYOR. Awin 85 sütun sunuyor; 100 binlik bir feed'de kullanmadığımız
 * 70 sütun, indirilen ve ayrıştırılan gövdenin çoğunu oluşturur. İstenen küme,
 * eşlemenin kullandığı sütunlar ARTI kimlik/denetim için gerekli üç tanesidir.
 */
export const AWIN_FEED_COLUMNS: readonly string[] = [
  ...new Set([
    ...Object.values(AWIN_FEED_MAPPING),
    'merchant_id',
    'data_feed_id',
    'last_updated',
  ]),
];
