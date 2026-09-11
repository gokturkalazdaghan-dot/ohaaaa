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
 *
 * ---------------------------------------------------------------------------
 * BU MODÜL "CREATE-A-FEED" DATAFEED ANAHTARINI KULLANIR -- OAuth2'yi DEĞİL
 * ---------------------------------------------------------------------------
 *
 * Awin'in yayıncı tarafında BİRDEN ÇOK kimlik yüzeyi var ve bunlar
 * birbirinin yerine geçmez. Bu modül, ürün feed'i indirmeye yarayan datafeed
 * anahtarını varsayar (`AWIN_DATAFEED_API_KEY`).
 *
 * Hesabın Publisher API için ayrı bir OAuth2 kimlik bilgisi olabilir. O
 * kimlik bilgisinin bu indirme yüzeyinde geçerli olup olmadığı BU DEPODA
 * DOĞRULANMADI: Awin'in belge ve API hostları (developer/api/productdata)
 * bu ortamın egress izin listesinde değil, yani resmî sözleşmeye birinci
 * elden bakılamadı.
 *
 * Bu yüzden burada OAuth2 akışı UYGULANMADI. Uydurulmuş bir alan adı
 * ("client_id" mi "clientId" mi, token ucu hangisi) ile yazılmış bir akış,
 * ilk gerçek çağrıda sessizce 401 döner ve hatayı Awin'e yıktırırdı.
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
  return (
    text
      // 1) Create-a-Feed biçimi: .../apikey/<ANAHTAR>/...
      .replace(/\/apikey\/[^/\s"]+/gi, '/apikey/[REDACTED]')
      /*
       * 2) Panel biçimi: .../publisher/<yayinciId>/<32 HANE HEX>/...
       *
       * ÖLÇÜLDÜ: Awin'in hata gövdesi istenen adresi AYNEN geri yazıyor --
       *   {"message":"No route found for \"GET https://ui.awin.com/publisher/
       *    3074081/<32 hane hex>/1/feed/111515.csv.gz\""}
       * O hex bir kimlik bilgisidir. Bu mesaj `queueRepository.fail()` ile
       * `ingest_runs`/`jobs` tablosuna YAZILIYOR: redaksiyon olmadan ağın
       * hata cevabı sırrı VERİTABANINA taşırdı. Sızıntı yolu ağdan değil,
       * KENDİ HATA KAYDIMIZDAN geçiyordu.
       */
      .replace(/\/publisher\/(\d+)\/[0-9a-f]{24,}/gi, '/publisher/$1/[REDACTED]')
      // 3) Sorgu dizesi biçimi: ?apikey=... &token=... &key=...
      .replace(/([?&](?:api_?key|token|key|secret)=)[^&\s"]+/gi, '$1[REDACTED]')
      // 4) Adres içinde geçen uzun hex diziler. GTIN en fazla 14 HANEDIR ve
      //    yalnızca rakamdır; 24+ karakterlik hex bir kimlik bilgisidir.
      .replace(/(https?:\/\/[^\s"]*?)\b[0-9a-f]{24,}\b/gi, '$1[REDACTED]')
  );
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
  /*
   * MPN: Awin'in KENDI urettigi indirme adreslerinde yer aliyor (feed
   * listesi CSV'si, fid 102827 ve 111663 icin `...,ean,mpn,product_name,...`).
   * Yani sutun adi tahmin degil, agin kendi ciktisindan.
   *
   * `condition` BILEREK ESLENMEDI: Awin indirme ucu, istenen HER sutun adini
   * -- var olmayan bir adi bile -- basliga oldugu gibi yaziyor (olculdu:
   * uydurma bir ad da aynen dondu). Bu yuzden sutunun gercekten var oldugu
   * bu yolla dogrulanamiyor ve dogrulanmamis bir ad eslemeye konmuyor.
   * `FieldMapping` alani destekliyor; kaynak yapilandirmasindan KOD
   * DEGISIKLIGI OLMADAN verilebilir.
   */
  mpn: 'mpn',
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

/**
 * Feed yerine gelen API HATA GÖVDESİNİ tanır.
 *
 * NEDEN GEREKLİ
 * Awin (ve her ağ) yetki/adres hatasında feed yerine küçük bir JSON döndürür
 * ve bunu feed'in kendi adıyla ("111515.csv.gz") sunar. O gövde tablo değildir:
 * CSV çözümleyici ondan SIFIR satır çıkarır ve hat bunu "feed boş döndü" diye
 * raporlar.
 *
 * "Boş feed" ile "API bizi reddetti" AYNI ŞEY DEĞİLDİR ve çareleri de ayrıdır:
 *   boş feed  -> geçici olabilir, bir sonraki turda düzelir
 *   reddedildi -> anahtar/adres yanlış; tekrar denemek 404'e sonsuza dek
 *                 vurmaktır
 *
 * Ölçüldü: 140 baytlık bir Awin 404 gövdesi, `.csv.gz` adıyla, hattan
 * "0 satır, 0 hata" olarak geçiyordu -- yani gerçekten boş bir feed'den
 * ayırt edilemiyordu.
 *
 * @returns Hata mesajı (REDAKTE EDİLMİŞ) ya da gövde tablo görünüyorsa null.
 */
export function detectFeedErrorEnvelope(body: string): string | null {
  const kirpik = body.trim();
  // Hata gövdeleri küçüktür; 64 KB'lık bir JSON muhtemelen gerçek bir
  // JSON feed'idir ve onu hata sanmak alımı durdururdu.
  if (kirpik.length === 0 || kirpik.length > 64 * 1024) return null;
  if (!kirpik.startsWith('{')) return null;

  let ayrisan: unknown;
  try {
    ayrisan = JSON.parse(kirpik);
  } catch {
    return null;
  }
  if (typeof ayrisan !== 'object' || ayrisan === null || Array.isArray(ayrisan)) return null;

  const kayit = ayrisan as Record<string, unknown>;
  // Ürün taşıyan bir JSON feed'i hata sanmamak için: hata gövdeleri bu
  // alanlardan birini taşır ve ürün dizisi taşımaz.
  for (const alan of ['message', 'error', 'error_description', 'detail', 'errors']) {
    const deger = kayit[alan];
    if (typeof deger === 'string' && deger.trim() !== '') {
      return redactAwinKey(deger.trim()).slice(0, 500);
    }
  }
  return null;
}
