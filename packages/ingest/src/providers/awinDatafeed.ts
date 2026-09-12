/**
 * Awin ürün feed'i (datafeed) desteği.
 *
 * ======================================================================
 * BU DOSYA BİR ADAPTÖR DEĞİL, BİR YAPILANDIRMA SÖZLEŞMESİDİR.
 * ======================================================================
 *
 * Hattın adaptör sözleşmesi `(content: string) => AdapterResult`. Awin'in
 * ürün feed'i CSV (çoğunlukla gzip'li) ya da XML olarak sunulur; ikisini de
 * `parseCsv` / `parseXml` ZATEN ayrıştırıyor ve gzip artık
 * `decompressToText` ile açılıyor. Dolayısıyla Awin için YENİ BİR
 * AYRIŞTIRICI YAZMAK GEREKMEZ -- yazmak, var olan iki ayrıştırıcının
 * üçüncü bir kopyasını bakıma sokmak olurdu.
 *
 * Awin'e ÖZGÜ olan tek şey KOLON ADLARI ve bunların kanonik alanlarımıza
 * eşlenmesi. O eşleme `sources.field_mapping` sütununda VERİ olarak durur;
 * burada yalnızca operatörün başlangıç noktası olarak kullanacağı bir
 * ÖNAYAR ve onu gerçek feed'e karşı DOĞRULAYAN bir araç var.
 *
 * ----------------------------------------------------------------------
 * KOLON ADLARI BU ORTAMDAN DOĞRULANAMADI -- ÖNEMLİ
 * ----------------------------------------------------------------------
 * `wiki.awin.com`, `developer.awin.com`, `api.awin.com` ve
 * `productdata.awin.com` bu ortamın ağ politikasıyla ENGELLİ. Aşağıdaki
 * kolon adları Awin'in yayınlanmış datafeed şemasından biliniyor ama
 * CANLI BİR FEED'E KARŞI DOĞRULANMADI.
 *
 * Bu yüzden önayar KENDİLİĞİNDEN UYGULANMAZ. `sources.field_mapping`
 * boş bırakılırsa alım çalışmaz; operatör eşlemeyi bilerek yazar.
 * `verifyAwinMapping` ilk gerçek indirmede başlık satırını önayarla
 * karşılaştırır ve eksik kolonları isim isim söyler. Tahmini KANITA
 * çeviren adım budur; yanlış bir eşlemeyle sessizce ilerlemek,
 * `normalize.ts` her satırı elediği için kaynağın KALICI
 * `VALIDATION_ERROR` ile ölmesi demekti.
 */

import type { FieldMapping } from '../types.js';

/**
 * Kimlik bilgisini taşıyan ORTAM DEĞİŞKENİNİN ADI -- değeri değil.
 *
 * Bu sabit bir SIR DEĞİLDİR; sırrın nerede aranacağını söyler.
 * `sources.auth_secret_ref` sütununa yazılacak değer budur ve gerçek
 * anahtar yalnızca çalışma anında `process.env` üzerinden okunur.
 * Anahtarın kendisi ne bu dosyaya, ne veritabanına, ne de bir günlük
 * satırına girer.
 */
export const AWIN_DATAFEED_SECRET_REF = 'AWIN_DATAFEED_API_KEY';

/**
 * Awin datafeed kolon adları.
 *
 * DOĞRULANMADI (yukarıdaki nota bakın). Tek doğruluk kaynağı, gerçek
 * feed'in başlık satırıdır; `verifyAwinMapping` onu kullanır.
 */
export const AWIN_COLUMNS = {
  /** Awin'in kendi ürün kimliği. Feed sürümleri arasında kararlı. */
  awProductId: 'aw_product_id',
  /** Mağazanın kendi stok kodu (SKU). Mağazadan mağazaya biçimi değişir. */
  merchantProductId: 'merchant_product_id',
  productName: 'product_name',
  description: 'description',
  brandName: 'brand_name',
  /** Awin'in sardığı ortaklık adresi (awin1.com). Aşağıdaki nota bakın. */
  awDeepLink: 'aw_deep_link',
  /** Mağazanın KENDİ ürün adresi. Kanonik `url` alanımız budur. */
  merchantDeepLink: 'merchant_deep_link',
  merchantImageUrl: 'merchant_image_url',
  awImageUrl: 'aw_image_url',
  /** Satış fiyatı. */
  searchPrice: 'search_price',
  /** Liste/tavsiye edilen fiyat -- indirim öncesi. */
  rrpPrice: 'rrp_price',
  currency: 'currency',
  deliveryCost: 'delivery_cost',
  /** 'Yes'/'No' ya da 1/0 olarak gelir; yorumu `normalize.parseStock` yapar. */
  inStock: 'in_stock',
  stockQuantity: 'stock_quantity',
  /** Mağazanın kendi kategori metni. */
  merchantCategory: 'merchant_category',
  /** Awin'in normalize ettiği kategori. */
  categoryName: 'category_name',
  ean: 'ean',
  upc: 'upc',
  isbn: 'isbn',
  mpn: 'mpn',
  /** Feed'in Awin'deki kimliği -- kaynak üstverisi. */
  dataFeedId: 'data_feed_id',
  merchantId: 'merchant_id',
  merchantName: 'merchant_name',
  lastUpdated: 'last_updated',
} as const;

/**
 * Önerilen başlangıç eşlemesi.
 *
 * ----------------------------------------------------------------------
 * `url` NEDEN `merchant_deep_link`, `aw_deep_link` DEĞİL
 * ----------------------------------------------------------------------
 * Bu, sessizce atfı bozabilecek tek karar; bu yüzden açıkça yazılıyor.
 *
 * `aw_deep_link` ZATEN sarılmış bir ortaklık adresidir
 * (`awin1.com/cread.php?...&ued=<mağaza adresi>`). Onu `url` olarak
 * saklamak demek, `/git/[offerId]` rotasının `buildAffiliateUrl` ile
 * ÜZERİNE BİR KEZ DAHA sarması demekti: awin1.com içinde awin1.com.
 * Sonuç iki kat zarar: dış sarmalayıcı BİZİM `clickref/subid`'imizi
 * taşır ama iç sarmalayıcı Awin tarafında kazanır ve tıklama ya yanlış
 * yayıncıya ya da referanssız yazılır. Tıklama kaydı yeşil görünür,
 * komisyon hiç gelmez -- arızanın en pahalı biçimi.
 *
 * `merchant_deep_link` mağazanın ham ürün adresidir. Mevcut ortaklık
 * katmanı sarmalamayı `merchants.deeplink_template` ile TEK SEFER yapar
 * ve `clickref/subid` bizim ürettiğimiz değer olur. Yani doğru davranış
 * için hattın hiçbir yerini değiştirmek gerekmiyor; yalnızca doğru
 * kolonu seçmek gerekiyor.
 *
 * Bir feed `merchant_deep_link` YAYINLAMIYORSA bu eşleme kullanılamaz:
 * `verifyAwinMapping` o kolonu eksik bildirir ve kaynak açılmadan önce
 * durulur. Sessizce `aw_deep_link`'e düşmek YASAK -- düşseydi, arıza
 * yalnızca ilk gerçek komisyon mutabakatında fark edilirdi.
 */
export const AWIN_FIELD_MAPPING: FieldMapping = {
  external_id: AWIN_COLUMNS.awProductId,
  title: AWIN_COLUMNS.productName,
  price: AWIN_COLUMNS.searchPrice,
  url: AWIN_COLUMNS.merchantDeepLink,
  gtin: AWIN_COLUMNS.ean,
  brand: AWIN_COLUMNS.brandName,
  image: AWIN_COLUMNS.merchantImageUrl,
  description: AWIN_COLUMNS.description,
  stock: AWIN_COLUMNS.inStock,
  compare_at_price: AWIN_COLUMNS.rrpPrice,
  category: AWIN_COLUMNS.merchantCategory,
  shipping_fee: AWIN_COLUMNS.deliveryCost,
  currency: AWIN_COLUMNS.currency,
  /*
   * ÜRÜN ALANI DEĞİL -- MAĞAZA İZOLASYONUNUN TEK SİNYALİ.
   *
   * Awin'in Product Data indirmesi tek bir dosyada YÜZLERCE reklamverenin
   * ürününü taşıyabiliyor. `assertMerchantIsolation` bu kolonu okuyup her
   * satırın beklenen MID'e ait olduğunu doğrular; eşleşmeyen tek satırda
   * tur durur. Eşlenmezse denetim yapılamaz ve hat FAIL CLOSED davranır.
   */
  merchant_id: AWIN_COLUMNS.merchantId,
};

/** `FieldMapping` üzerinde ZORUNLU alanlar -- eksikse kaynak çalışamaz. */
const ZORUNLU_ALANLAR = ['external_id', 'title', 'price', 'url'] as const;

export interface MappingVerification {
  /** Eşlemenin TAMAMI feed'de bulundu mu (zorunlu + isteğe bağlı)? */
  ok: boolean;
  /** Feed'de bulunamayan ZORUNLU kolonlar. Doluysa kaynak açılmamalı. */
  missingRequired: string[];
  /** Feed'de bulunamayan İSTEĞE BAĞLI kolonlar. Alım çalışır; alan null kalır. */
  missingOptional: string[];
  /** Feed'de olan ama eşlenmeyen kolonlar -- gözden kaçan veri olabilir. */
  unmapped: string[];
  /** İnsan okunur özet; panele ve çalışma kaydına yazılabilir. */
  summary: string;
}

/**
 * Bir eşlemeyi gerçek feed başlığına karşı doğrular.
 *
 * TAHMİNİ KANITA ÇEVİREN ADIM BUDUR. Önayar bu ortamdan doğrulanamadığı
 * için, ilk gerçek indirmede bu çağrılır ve sonucu operatöre gösterilir.
 *
 * Eksik ZORUNLU kolon, kaynağı açmamak için yeterli sebeptir: o hâlde
 * `normalize.ts` her satırı eler ve hat KALICI `VALIDATION_ERROR`
 * verir. Hatayı burada, adı sanıyla söylemek; oraya varıp "hiçbir kalem
 * doğrulamayı geçemedi" demekten çok daha kullanışlı.
 */
export function verifyAwinMapping(
  headerColumns: readonly string[],
  mapping: FieldMapping = AWIN_FIELD_MAPPING,
): MappingVerification {
  // Awin kolon adları küçük harfli gelir ama sağlayıcılar arasında
  // büyük/küçük harf tutarsızlığı görülür; karşılaştırma duyarsız yapılır.
  const mevcut = new Set(headerColumns.map((c) => c.trim().toLowerCase()));
  const varMi = (kolon: string): boolean => mevcut.has(kolon.trim().toLowerCase());

  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  const eslenen = new Set<string>();

  for (const [alan, kolon] of Object.entries(mapping)) {
    if (typeof kolon !== 'string' || kolon.length === 0) continue;

    eslenen.add(kolon.trim().toLowerCase());

    if (varMi(kolon)) continue;

    const zorunlu = (ZORUNLU_ALANLAR as readonly string[]).includes(alan);
    (zorunlu ? missingRequired : missingOptional).push(`${alan} -> ${kolon}`);
  }

  const unmapped = headerColumns
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && !eslenen.has(c.toLowerCase()));

  const ok = missingRequired.length === 0 && missingOptional.length === 0;

  const parcalar = [
    `${headerColumns.length} kolonluk feed başlığı incelendi.`,
    missingRequired.length > 0
      ? `EKSİK ZORUNLU: ${missingRequired.join(', ')} -- kaynak açılmamalı.`
      : 'Zorunlu alanların tamamı bulundu.',
  ];

  if (missingOptional.length > 0) {
    parcalar.push(`Eksik isteğe bağlı (null kalacak): ${missingOptional.join(', ')}.`);
  }
  if (unmapped.length > 0) {
    parcalar.push(`Eşlenmeyen ${unmapped.length} kolon: ${unmapped.slice(0, 10).join(', ')}.`);
  }

  return { ok, missingRequired, missingOptional, unmapped, summary: parcalar.join(' ') };
}

/**
 * Bir mağazanın ticari olarak yayına alınıp alınamayacağına karar verir.
 *
 * ======================================================================
 * TEKNİK DESTEK ≠ TİCARİ İZİN
 * ======================================================================
 * Adaptörün bir mağazanın feed'ini OKUYABİLİYOR olması, o mağazanın
 * ortaklık trafiğine açılabileceği anlamına GELMEZ. İkisini ayıran kapı
 * burası.
 *
 * Somut durum (depo kaydı, 07/09/2026): MID 61655 "Back to the Office"
 * `status='prospect'`, `application_status='not_started'` -- yani
 * BAŞVURU BİLE YAPILMAMIŞ. Onaysız bir programa ortaklık trafiği
 * göndermek iki sonuç doğurur: tıklamalar atfedilmez (komisyon yok) ve
 * ağın program şartları ihlal edilmiş olur. İkisi de sessizdir; ilk
 * mutabakata kadar fark edilmez.
 *
 * Bu yüzden kapı VARSAYILAN OLARAK KAPALI: yalnızca `approved` +
 * `approved_at` dolu + MID + deeplink şablonu olan mağaza geçer. Eksik
 * bilgi "muhtemelen tamamdır" diye yorumlanmaz.
 */
export interface CommercialGateInput {
  slug: string;
  applicationStatus: string | null;
  approvedAt: string | Date | null;
  networkAdvertiserId: string | null;
  deeplinkTemplate: string | null;
}

export interface CommercialGateResult {
  activatable: boolean;
  /** Engel sebepleri; boşsa mağaza yayına alınabilir. */
  blockers: string[];
}

export function checkCommercialActivation(
  merchant: CommercialGateInput,
): CommercialGateResult {
  const blockers: string[] = [];

  if (merchant.applicationStatus !== 'approved') {
    blockers.push(
      `Program onaylı değil (application_status=${merchant.applicationStatus ?? 'null'}).`,
    );
  }
  if (!merchant.approvedAt) {
    blockers.push('Onay tarihi (approved_at) boş.');
  }
  if (!merchant.networkAdvertiserId) {
    blockers.push('MID (network_advertiser_id) boş -- tıklamalar atfedilemez.');
  }
  if (!merchant.deeplinkTemplate) {
    blockers.push('Deeplink şablonu boş -- ortaklık adresi üretilemez.');
  }

  return { activatable: blockers.length === 0, blockers };
}

/**
 * ---------------------------------------------------------------------------
 * AWIN "RETAIL" ÜRÜN VERİSİ — GOOGLE SHOPPING ŞEMASI
 * ---------------------------------------------------------------------------
 * Yukarıdaki `AWIN_COLUMNS` Awin'in KLASİK datafeed şemasıdır ve hâlâ
 * doğrulanmamıştır. Awin ayrıca ürün verisini GOOGLE SHOPPING biçiminde
 * yayınlıyor ve Simple Project'in feed'i bu biçimde geldi.
 *
 * BU BLOK GERÇEK BİR FEED DOSYASINA KARŞI DOĞRULANDI
 * (advertiser 99013, 636 satır, 62 kolon): kolon adları aşağıdaki
 * sabitlerle birebir eşleşti.
 *
 * Google Shopping alanları (`id`, `title`, `link`, `price`, `gtin`, `mpn`,
 * `availability`…) + Awin uzantıları (`advertiser_id`, `advertiser_name`,
 * `aw_deep_link`, `aw_mobile_link`).
 */
export const AWIN_RETAIL_COLUMNS = {
  advertiserId: 'advertiser_id',
  advertiserName: 'advertiser_name',
  id: 'id',
  title: 'title',
  description: 'description',
  link: 'link',
  imageLink: 'image_link',
  /** Awin'in sardığı ortaklık adresi -- katalogda SAKLANMAZ (aşağıdaki nota bakın). */
  awDeepLink: 'aw_deep_link',
  googleProductCategory: 'google_product_category',
  productType: 'product_type',
  gtin: 'gtin',
  mpn: 'mpn',
  brand: 'brand',
  availability: 'availability',
  /** Biçim: "659.00 USD" -- para birimi değerin İÇİNDE. */
  price: 'price',
  salePrice: 'sale_price',
  condition: 'condition',
  itemGroupId: 'item_group_id',
  shipping: 'shipping',
} as const;

/**
 * Google Shopping biçimli Awin feed'i için DOĞRULANMIŞ eşleme.
 *
 * `url` yine `link` (mağazanın kendi adresi), `aw_deep_link` DEĞİL --
 * gerekçe `AWIN_FIELD_MAPPING` üzerindeki notta; çift sarmalama tıklamayı
 * bizim clickref'imizle atfedilemez hâle getirir.
 *
 * EŞLENMEYENLER ve sebepleri (uydurulmadı, ölçüldü):
 *   • currency  -> ayrı kolon YOK; para birimi "659.00 USD" gibi değerin
 *     içinde geliyor ve `parseMoneyToCents` sayıyı doğru çıkarıyor.
 *     Kanonik para birimi kaynağın `currency` alanından gelir.
 *   • compare_at_price -> `sale_price` ölçülen dosyada 636 satırın
 *     TAMAMINDA boştu; eşlemek her satırda boş bir alan okumak olurdu.
 *   • shipping_fee -> `shipping` Google'ın bileşik biçiminde
 *     (ülke:bölge:servis:tutar); tek sayıya indirgemek tahmin olurdu.
 */
export const AWIN_RETAIL_FIELD_MAPPING: FieldMapping = {
  external_id: AWIN_RETAIL_COLUMNS.id,
  title: AWIN_RETAIL_COLUMNS.title,
  price: AWIN_RETAIL_COLUMNS.price,
  url: AWIN_RETAIL_COLUMNS.link,
  gtin: AWIN_RETAIL_COLUMNS.gtin,
  brand: AWIN_RETAIL_COLUMNS.brand,
  image: AWIN_RETAIL_COLUMNS.imageLink,
  description: AWIN_RETAIL_COLUMNS.description,
  stock: AWIN_RETAIL_COLUMNS.availability,
  category: AWIN_RETAIL_COLUMNS.googleProductCategory,
  /** Mağaza izolasyonunun sinyali -- klasik şemada `merchant_id`, burada `advertiser_id`. */
  merchant_id: AWIN_RETAIL_COLUMNS.advertiserId,
};
