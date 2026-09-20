import 'server-only';

/**
 * Talep-anı dış ürün araması -- Ohaaaa tarafındaki TEK giriş noktası.
 *
 * ======================================================================
 * MEVCUT ARAMAYI BOZMAMA SÖZÜ BURADA TUTULUR
 * ======================================================================
 * Bu modülün dışa açtığı fonksiyon HİÇBİR KOŞULDA FIRLATMAZ. Sağlayıcı
 * 429 verse, 503 verse, zaman aşımına uğrasa, anahtar yanlış olsa ya da
 * hiç yapılandırılmamış olsa bile sonuç tipli bir nesnedir.
 *
 * Sebep tek cümlede: Ohaaaa'nın katalog araması, bu sağlayıcının
 * sağlığına BAĞLI OLMAMALI. Fırlatan bir yardımcı, çağıranın `try/catch`
 * yazmayı unuttuğu ilk yerde arama sayfasının tamamını düşürürdü --
 * kendi verimizle mükemmel çalışabilecekken.
 *
 * ======================================================================
 * ÜÇ KAPI, SIRAYLA
 * ======================================================================
 *   1. YAPILANDIRMA — anahtar yoksa hiç ağa çıkılmaz (`durum: 'kapali'`).
 *   2. BÜTÇE        — kişi başı + küresel tavan (`rateBudget`).
 *   3. ÖNBELLEK     — deterministik anahtar, KISA ve sınırlı TTL.
 *
 * Sıra önemli: bütçe önbellekten ÖNCE sayılır. Tersi cazip görünüyor
 * ("isabet varsa kota harcama") ama koruma tam da orada kaybolurdu:
 * sorgu metnini her istekte değiştiren bir betik zaten ASLA isabet
 * almaz, yani hep sağlayıcıya gider. Kapı, o betiği durdurmak için var.
 * Bedeli, isabetli isteklerde birkaç fazladan sayımdır -- yani tavanın
 * gerçekte biraz daha dar olması. Bu taraf güvenli olan taraftır.
 */

import { unstable_cache } from 'next/cache';

import {
  affiliateComProvider,
  fetchExternalProducts,
  productSearchCacheKey,
  ProductSearchError,
  type ExternalProduct,
  type ProductSearchErrorCode,
  type ProductSearchQuery,
} from '@ohaaaa/shared/product-search';

import { tuketButce } from '@/lib/rateBudget';

import { disAramaAyari } from './ayar';

/**
 * Aramanın sonucu.
 *
 * ÜÇ DURUM AYRI TUTULUR ve bu kasıtlı: "kapalı", "başarısız" ve "sonuç
 * yok" aynı şey değildir. Arayüz ikisini aynı gösterebilir ama
 * GÜNLÜKLERDE ayrılmaları gerekir -- yoksa "hiç sonuç gelmiyor"
 * şikâyetinin sebebi (anahtar mı yok, sağlayıcı mı düşük, sorgu mu boş)
 * hiç bilinemez.
 */
export type DisAramaSonucu =
  | { durum: 'kapali' }
  | { durum: 'basarili'; urunler: ExternalProduct[] }
  | { durum: 'basarisiz'; sebep: ProductSearchErrorCode | 'butce' };

/** Önbellek etiketi -- katalog etiketinden AYRI. */
const ETIKET = 'dis-arama';

/**
 * Sorguyu KANONİK biçime getirir.
 *
 * `unstable_cache` anahtarı argümanların serileştirilmiş hâlinden üretir;
 * yani alan SIRASI anahtarı değiştirir. Çağıran taraf alanları başka
 * sırada verdiğinde aynı arama iki ayrı girdi açardı -- önbellek iki kat
 * yer kaplar, isabet oranı yarıya iner.
 *
 * Bu yüzden nesne burada TEK bir yerde, sabit sırayla kuruluyor.
 */
function kanonikSorgu(sorgu: ProductSearchQuery): ProductSearchQuery {
  return {
    query: sorgu.query.trim(),
    market: sorgu.market,
    country: sorgu.country,
    currency: sorgu.currency,
    network: sorgu.network,
    merchant: sorgu.merchant,
    limit: sorgu.limit,
  };
}

/**
 * TTL başına bir sarmal.
 *
 * `unstable_cache` süreyi SARMALAMA anında alır, çağrı anında değil. Süre
 * ortam değişkeninden geldiği için sarmal, ilk kullanılan süreye göre bir
 * kez üretilip saklanıyor. Harita sınırlıdır: `ayar.ts` süreyi zaten
 * 30–900 saniye arasına kıstığı için burada sınırsız büyüyebilecek bir
 * anahtar uzayı yok.
 */
const sarmallar = new Map<number, (anahtar: string, sorgu: ProductSearchQuery) => Promise<ExternalProduct[]>>();

function sarmalAl(
  saniye: number,
): (anahtar: string, sorgu: ProductSearchQuery) => Promise<ExternalProduct[]> {
  const mevcut = sarmallar.get(saniye);
  if (mevcut) return mevcut;

  /*
   * İÇERİDE FIRLATILIR, DIŞARIDA YAKALANIR.
   *
   * Hata `unstable_cache`'in içinden geçerse ÖNBELLEĞE GİRMEZ. Başarısız
   * turu "sonuç yok" diye önbelleğe yazsaydık, sağlayıcının beş saniyelik
   * bir kesintisi bizim tarafımızda TTL boyunca sürerdi.
   */
  const sarmal = unstable_cache(
    async (_anahtar: string, sorgu: ProductSearchQuery): Promise<ExternalProduct[]> => {
      const ayar = disAramaAyari();

      // Sarmalama ile çağrı arasında anahtar kaldırılmış olabilir.
      if (!ayar) throw new ProductSearchError('Yapilandirma yok.', 'not_configured');

      const sonuc = await fetchExternalProducts({
        provider: affiliateComProvider,
        apiKey: ayar.apiKey,
        query: sorgu,
        endpoint: ayar.endpoint,
        timeoutMs: ayar.timeoutMs,
      });

      return sonuc.products;
    },
    [ETIKET, String(saniye)],
    { revalidate: saniye, tags: [ETIKET] },
  );

  sarmallar.set(saniye, sarmal);
  return sarmal;
}

/**
 * Dış kaynakta ürün arar. FIRLATMAZ.
 *
 * @param headers İstek başlıkları -- bütçe sayımı için. Verilmezse bütçe
 *   SAYILMAZ; bu yüzden kullanıcıdan tetiklenen her çağrıda verilmelidir.
 *   İsteğe bağlı olması, bir cron ya da operatör betiğinin ziyaretçi
 *   kotasını yemeden çalışabilmesi içindir.
 */
export async function disKaynaktaAra(
  sorgu: ProductSearchQuery,
  headers?: Headers,
): Promise<DisAramaSonucu> {
  const ayar = disAramaAyari();
  if (!ayar) return { durum: 'kapali' };

  const kanonik = kanonikSorgu(sorgu);
  if (kanonik.query === '') return { durum: 'basarili', urunler: [] };

  if (headers) {
    const butce = await tuketButce('dis-arama', headers);
    if (!butce.izin) {
      gunlukle('warn', 'Dis urun arama butcesi asildi', { sebep: butce.sebep });
      return { durum: 'basarisiz', sebep: 'butce' };
    }
  }

  const anahtar = productSearchCacheKey(affiliateComProvider.id, kanonik);

  try {
    const urunler = await sarmalAl(ayar.onbellekSaniye)(anahtar, kanonik);
    return { durum: 'basarili', urunler };
  } catch (error) {
    const sebep: ProductSearchErrorCode =
      error instanceof ProductSearchError ? error.code : 'bad_response';

    /*
     * SORGU METNİ GÜNLÜĞE YAZILMAZ.
     *
     * Kullanıcının arama metni kişisel veri sayılabilir ve bir hata
     * satırının içinde süresiz yaşar. Teşhis için gereken şey metin değil,
     * SEBEP ve durum kodudur.
     */
    gunlukle('error', 'Dis urun arama basarisiz -- katalog sonuclariyla devam ediliyor', {
      sebep,
      status: error instanceof ProductSearchError ? error.status : undefined,
      retryAfter: error instanceof ProductSearchError ? error.retryAfterSeconds : undefined,
    });

    return { durum: 'basarisiz', sebep };
  }
}

/** Yapısal günlük -- depo genelindeki biçimle aynı. */
function gunlukle(level: 'warn' | 'error', msg: string, alanlar: Record<string, unknown>): void {
  const satir = JSON.stringify({ level, msg, ...alanlar });

  if (level === 'warn') console.warn(satir);
  else console.error(satir);
}
