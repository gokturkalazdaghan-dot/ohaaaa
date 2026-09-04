import type { AuthType } from './auth.js';
import type { IngestErrorClass } from './errors.js';

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
  /**
   * Kimlik bilgisinin NASIL taşınacağı. Varsayılan `query`: adres
   * şablonundaki ${DEGISKEN} yer tutucusu. `bearer`/`basic` Authorization
   * başlığı kullanır.
   */
  authType?: AuthType;
  /**
   * Kimlik bilgisini taşıyan ORTAM DEĞİŞKENİNİN ADI -- değeri değil.
   * Değeri burada tutmak, sırrı veritabanında düz metin saklamak olurdu.
   */
  authSecretRef?: string | null;
}

export interface IngestSummary {
  sourceId: string;
  status: 'success' | 'partial' | 'failed';
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  /**
   * Delta sınıflandırmasının ham sonucu.
   *
   * `itemsCreated`/`itemsUpdated` veritabanına NE YAPTIĞIMIZI söyler;
   * bunlar KAYNAĞIN NE YAPTIĞINI. İki soru farklı ve ikisi de gerekli:
   * `created=0, updated=0` tek başına "hiçbir şey değişmedi" (sağlıklı)
   * ile "hepsi elendi" (arıza) durumlarını aynı gösterir.
   */
  itemsNew: number;
  itemsChanged: number;
  /**
   * Parmak izi değişmediği için HİÇ YAZILMAYAN kalemler.
   *
   * Delta tespitinin ne kadar iş elediğinin ölçüsü. Sağlıklı bir feed'de
   * çoğunluk burada olmalı: 50.000 üründen üçü değiştiyse 49.997 yazma,
   * tetikleyici ve yeniden indeksleme yapılmamış demektir.
   */
  itemsUnchanged: number;
  /**
   * Kategorisi COZULEMEDIGI icin `category_id` bos yazilan kalemler.
   *
   * Sifirdan buyuk bir deger arizanin kendisi degildir -- feed'in kategori
   * sozlugu bizimkiyle ortusmuyor olabilir. Ama SESSIZ kalmasi arizadir:
   * bu sayi olmadan "ingest basarili" ile "urunler hicbir kategori
   * sayfasinda gorunmuyor" ayni gorunur. Tam da E5 boyle kacmisti.
   */
  itemsUnclassified: number;
  /**
   * Kaynakta artık bulunmayan kalemler.
   *
   * `snapshotComplete` false iken bu HER ZAMAN 0'dır -- ve o sıfır
   * "silinmedi" değil "bakılmadı" anlamına gelir. İkisini ayırmak için
   * `snapshotComplete` ayrıca taşınıyor.
   */
  itemsDeleted: number;
  itemsSkipped: number;
  itemsFailed: number;
  durationMs: number;
  /**
   * Anlık görüntü TAM mıydı?
   *
   * `false` ise bu turda SİLME/BAYATLATMA yapılmaz. Kırpılmış ya da
   * büyük ölçüde doğrulamayı geçemeyen bir feed, eksik kayıtları
   * "kaynakta yok" gibi gösterir.
   */
  snapshotComplete: boolean;
  sampleErrors: Array<{ externalId: string | null; reason: string }>;
  error?: string;
  /**
   * Hatanın SINIFI.
   *
   * `error` metni insana ne olduğunu söyler; bu alan MAKİNEYE söyler.
   * İkisi ayrı çünkü kuyruğun "yeniden denenir mi" kararı bir metne
   * bakılarak verilemez: cümle düzeltildiğinde karar sessizce değişirdi.
   * Ayrıca sınıf sayılabilir -- "bu hafta kaç AUTH_ERROR" sorusu
   * cevaplanabilir hale gelir.
   */
  errorClass?: IngestErrorClass;
  /**
   * Bu hata yeniden denenmeli mi?
   *
   * SINIFTAN AYRI TAŞINIR ÇÜNKÜ AYNI SINIF İKİ KARAR VEREBİLİR.
   * `HTTP_ERROR` bunun kanıtı: 404 kalıcı, 503 geçicidir. Yalnızca sınıfı
   * taşıyıp kalıcılığı sınıf tablosundan okumak, 503'ü kalıcı sayıp
   * toparlanabilecek bir sunucuda kaynağı öldürüyordu -- bu alan tam olarak
   * o kusur bir testle yakalandığı için var.
   */
  errorPermanent?: boolean;
}
