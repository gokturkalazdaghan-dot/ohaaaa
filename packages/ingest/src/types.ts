/**
 * Alım hattının ortak tipleri.
 *
 * Adaptörlerin tek görevi, kaynağın kendi biçimini `RawRecord`'a çevirmektir
 * (anahtar → metin). Anlamlandırma (fiyatı kuruşa çevirme, stok yorumlama,
 * doğrulama) tek bir yerde — `normalize.ts` — yapılır.
 *
 * Bu ayrım sayesinde yeni bir feed biçimi eklemek yalnızca yeni bir ayrıştırıcı
 * demektir; iş kuralları kopyalanmaz.
 */

/** Kaynaktan çıkan ham kayıt: alan adı → ham metin. */
export type RawRecord = Record<string, string>;

export interface AdapterResult {
  records: RawRecord[];
  /** Ayrıştırma sırasında atlanan satırlar ve sebepleri. */
  warnings: string[];
}

/** Ham içeriği kayıtlara çeviren ayrıştırıcı. */
export type FeedAdapter = (content: string) => AdapterResult;

/** Feed kolonlarını kanonik alanlarımıza eşleyen harita (sources.field_mapping). */
export interface FieldMapping {
  external_id: string;
  title: string;
  price: string;
  url: string;
  /** İsteğe bağlı alanlar */
  gtin?: string;
  brand?: string;
  image?: string;
  description?: string;
  stock?: string;
  compare_at_price?: string;
  category?: string;
  shipping_fee?: string;
  currency?: string;
}

/**
 * Doğrulanmış, veritabanına yazılmaya hazır teklif.
 * Tutarlar kuruş; sistemin geri kalanıyla aynı kural.
 */
export interface NormalizedOffer {
  externalId: string;
  title: string;
  productUrl: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: string;
  stock: number;
  gtin: string | null;
  brand: string | null;
  description: string | null;
  imageUrls: string[];
  categorySlug: string | null;
  shippingFeeCents: number;
}

export interface SourceConfig {
  id: string;
  slug: string;
  merchantId: string;
  /**
   * Bu kaynağın veri getirdiği pazar.
   *
   * Para biriminden AYRI taşınır: EUR hem Almanya hem Avusturya demektir
   * ve bir satıcı kendi ülkesi dışındaki bir para birimiyle fiyat
   * verebilir. Pazarı para biriminden türetmek, kullanıcıya kendisine
   * gönderilmeyecek teklifleri "en ucuz" diye göstermeye yol açar.
   */
  market: 'TR' | 'DE' | 'US';
  kind: 'feed_csv' | 'feed_xml' | 'feed_json' | 'api' | 'sitemap' | 'manual';
  endpointUrl: string | null;
  fieldMapping: FieldMapping;
  currency: string;
  /** Mağazanın izinli alan adları — ürün adresleri buraya ait olmalı. */
  allowedHosts: string[];
}

export interface IngestSummary {
  sourceId: string;
  status: 'success' | 'partial' | 'failed';
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSkipped: number;
  itemsFailed: number;
  durationMs: number;
  sampleErrors: Array<{ externalId: string | null; reason: string }>;
  error?: string;
}
