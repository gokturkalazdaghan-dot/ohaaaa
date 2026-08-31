/**
 * Ürün besleme alanlarının referansı.
 *
 * NEDEN BURADA ELLE YAZILIYOR
 * Zod şemasını gezip tablo üretmek cazip ama kırılgandır: Zod'un iç yapısı
 * sürümle değişir ve üretilen metin ("string, min 1, max 120") bir
 * entegrasyoncuya asıl gereken şeyi söylemez — alanın NE İŞE YARADIĞINI.
 *
 * NEDEN YİNE DE BAYATLAYAMAZ
 * `feedFields.test.ts` bu tabloyu şemaya karşı DAVRANIŞSAL olarak sınar:
 *   • tablodaki her alan şemada var mı,
 *   • şemadaki her alan tabloda var mı,
 *   • "zorunlu" dediklerimiz gerçekten zorunlu mu (alan çıkarılınca şema
 *     reddediyor mu),
 *   • "isteğe bağlı" dediklerimiz gerçekten isteğe bağlı mı.
 *
 * Yani şemaya yeni bir alan eklenip burası güncellenmezse test düşer.
 * Belgelerin koddan ayrışması, hiç belge olmamasından kötüdür: entegrasyoncu
 * yanlış olana güvenip saatini harcar.
 */

export interface FeedField {
  name: string;
  type: string;
  required: boolean;
  /** Gönderilmezse uygulanan değer. */
  fallback?: string;
  note: string;
}

export const FEED_FIELDS: FeedField[] = [
  {
    name: 'external_id',
    type: 'metin (1–120)',
    required: true,
    note: 'Sizin sisteminizdeki benzersiz kimlik. Upsert anahtarıdır: aynı kimlikle tekrar gönderim yeni kayıt açmaz, mevcut kaydı günceller.',
  },
  {
    name: 'title',
    type: 'metin (2–300)',
    required: true,
    note: 'Ürün adı. Kanonik eşleştirmede marka ile birlikte kullanılır; aynı ürünü tarif eden başlıklar aynı karşılaştırma sayfasında toplanır.',
  },
  {
    name: 'price_cents',
    type: 'tam sayı (kuruş)',
    required: true,
    note: 'Satış fiyatı KURUŞ cinsinden. 549,90 TL → 54990. Ondalık gönderilmez.',
  },
  {
    name: 'stock',
    type: 'tam sayı (0–1.000.000)',
    required: true,
    note: '0 gönderilirse ürün "tükendi" olarak görünür; listeden düşmez, fiyatı karşılaştırmada kalır ama satın alma kapanır.',
  },
  {
    name: 'sku',
    type: 'metin (≤120)',
    required: false,
    note: 'Kendi stok kodunuz. Yalnızca panelde gösterilir, eşleştirmede kullanılmaz.',
  },
  {
    name: 'description',
    type: 'metin (≤20.000)',
    required: false,
    note: 'Ürün açıklaması. Kanonik ürünün açıklaması boşsa buradan doldurulur.',
  },
  {
    name: 'brand',
    type: 'metin (≤120)',
    required: false,
    note: 'Marka. Barkod yoksa eşleştirme marka + başlık imzasıyla yapılır; boş bırakmak aynı ürünün ayrı sayfalara düşmesine yol açabilir.',
  },
  {
    name: 'gtin',
    type: '8, 12, 13 veya 14 hane',
    required: false,
    note: 'Barkod (EAN/UPC). Eşleştirmenin EN GÜVENİLİR yoludur: varsa başlık hiç hesaba katılmaz. Gönderebiliyorsanız gönderin.',
  },
  {
    name: 'category_slug',
    type: 'metin (≤120)',
    required: false,
    note: 'Kategori kısa adı (örn. elektronik). Tanınmayan bir değer ürünü REDDETMEZ; ürün kategorisiz kalır ve katalogda görünmeye devam eder.',
  },
  {
    name: 'image_urls',
    type: 'dizi, en çok 12 adres',
    required: false,
    fallback: '[]',
    note: 'Görsel adresleri (https). İlki kapak görselidir.',
  },
  {
    name: 'compare_at_price_cents',
    type: 'tam sayı (kuruş)',
    required: false,
    note: 'Üstü çizili eski fiyat. Satış fiyatından DÜŞÜK olamaz — düşükse istek reddedilir. İndirim oranı bu ikisinden hesaplanır.',
  },
  {
    name: 'currency',
    type: 'TRY',
    required: false,
    fallback: 'TRY',
    note: 'Para birimi.',
  },
  {
    name: 'condition',
    type: 'new | refurbished | used',
    required: false,
    fallback: 'new',
    note: 'Ürün durumu. Karşılaştırma sayfasında rozet olarak görünür.',
  },
  {
    name: 'shipping_fee_cents',
    type: 'tam sayı (kuruş)',
    required: false,
    fallback: '0',
    note: 'Kargo ücreti. Sıralama ürün fiyatına değil, KARGO DAHİL toplama göre yapılır — burayı doğru doldurmak sıralamadaki yerinizi belirler.',
  },
  {
    name: 'free_shipping_threshold_cents',
    type: 'tam sayı (kuruş)',
    required: false,
    note: 'Bu tutarın üstünde kargo bedava. Sepette "şu kadar daha ekleyin" bilgisi buradan üretilir.',
  },
  {
    name: 'estimated_delivery_days',
    type: 'tam sayı (0–90)',
    required: false,
    fallback: '3',
    note: 'Tahmini teslim süresi. Eşit fiyatta daha kısa süre üste çıkar.',
  },
  {
    name: 'status',
    type: 'draft | active | out_of_stock | archived',
    required: false,
    fallback: 'active',
    note: 'draft ve archived vitrinde GÖRÜNMEZ. Bir ürünü geçici olarak kaldırmak için archived gönderin; silmek gerekmez.',
  },
  {
    name: 'attributes',
    type: 'metin → metin eşlemesi',
    required: false,
    fallback: '{}',
    note: 'Serbest özellikler (renk, beden, hafıza). Ürün sayfasında tablo olarak listelenir.',
  },
];
