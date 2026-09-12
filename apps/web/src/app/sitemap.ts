/**
 * XML site haritası (madde 20).
 *
 * Statik sayfalar + katalogdaki tüm kanonik ürünler. Ürün sayfaları
 * veritabanından okunur; demo modunda yerleşik veriden gelir.
 *
 * TASARIM KARARI — arama sonuç sayfaları (`/arama`) haritaya GİRMEZ ve
 * robots.txt'de kapalıdır: sorgu varyantları sonsuzdur, tarama bütçesini
 * tüketir ve ince içerik (thin content) sayılır.
 *
 * Kategori sayfaları ise girer ve bu yüzden AYRI bir yolda (`/kategori/...`)
 * durur. Aynı yolu paylaşsalardı robots.txt biri için yazılan kural
 * diğerini de kapatırdı.
 *
 * Google tek bir haritada en fazla 50.000 URL kabul eder. Katalog bunu
 * aşarsa `generateSitemaps` ile parçalamak gerekir (bkz. aşağıdaki not).
 */

import type { MetadataRoute } from 'next';

import {
  getActiveMerchants,
  getCategoryTree,
  getSitemapProducts,
  getVendors,
} from '@/data/catalog';
import { isAffiliateOnly, siteUrl } from '@/lib/env';

/**
 * Tek haritaya sığdırılacak en fazla ürün.
 *
 * Google tek bir site haritası dosyasında 50.000 adrese kadar kabul eder.
 * 45.000 o tavanın altında bilinçli bir paydır: katalog bugün 34.510 ürün
 * grubu içeriyor (ölçüldü) ve payı aşana kadar bölmeye gerek yok.
 *
 * Katalog 45.000'i geçtiğinde bu sabiti büyütmek YETMEZ -- sitemap index
 * mimarisine geçilmeli (sitemap-products-1.xml, -2.xml ...). O ayrı bir iş;
 * burada kapsamın kendisi düzeltiliyor.
 */
const MAX_PRODUCTS = 45_000;

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // --- Statik sayfalar -------------------------------------------------------
  // priority değerleri göreli önemi bildirir; Google bunu bir ipucu olarak
  // kullanır, emir olarak değil.
  /*
   * Ortaklik kipinde pazar yeri adresleri haritaya GIRMEZ. Sayfalarin
   * kendisi 404 donuyor; haritada durmalari arama motoruna olmayan bir
   * sayfayi bildirmek olurdu.
   */
  const marketplacePages: MetadataRoute.Sitemap = isAffiliateOnly
    ? []
    : [
        {
          url: `${siteUrl}/tasoron`,
          lastModified: now,
          changeFrequency: 'monthly',
          priority: 0.6,
        },
        {
          url: `${siteUrl}/tasoron/api`,
          lastModified: now,
          changeFrequency: 'monthly',
          priority: 0.4,
        },
        {
          url: `${siteUrl}/tasoron/basvuru`,
          lastModified: now,
          changeFrequency: 'monthly',
          priority: 0.5,
        },
        {
          url: `${siteUrl}/tasoron/marka`,
          lastModified: now,
          changeFrequency: 'monthly',
          priority: 0.4,
        },
      ];

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/hakkimizda`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${siteUrl}/iletisim`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${siteUrl}/sss`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${siteUrl}/gizlilik`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${siteUrl}/kosullar`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    {
      url: `${siteUrl}/ortaklik-aciklamasi`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.4,
    },
    { url: `${siteUrl}/bot`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    /* Yasal sayfa: diğer üçü (gizlilik, koşullar, ortaklık) listedeyken
       KVKK aydınlatma metni atlanmıştı. */
    { url: `${siteUrl}/kvkk`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    /* Fırsat sayfası içeriği fiyat ölçümleriyle günlük değişir; yöntemi
       anlatan /fiyat-takip ise kararlı bir metin. */
    { url: `${siteUrl}/firsatlar`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    {
      url: `${siteUrl}/fiyat-takip`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  try {
    /* --- Kategori sayfaları ------------------------------------------------
       AĞAÇTAN geliyor, düz listeden değil. İki sonucu var:

         1) ALT KATEGORİLER ARTIK SİTE HARİTASINDA. Eskiden yalnızca üst
            seviye listeleniyordu; bilgisayar/telefon/kulaklık sayfaları
            (34.249 grup -- ölçüldü) hiç bildirilmiyordu. Zaten 404
            döndükleri için bu tutarlıydı; artık çalıştıklarına göre
            bildirilmeleri gerekiyor.

         2) BOŞ KATEGORİLER ÇIKTI. Altı üst kategorinin dördü tamamen boş.
            İçinde tek ürün olmayan bir sayfayı site haritasıyla taramaya
            davet etmek, tarama bütçesini ince içeriğe harcamaktır. Sayfa
            silinmiyor -- yalnızca davet edilmiyor (ve `noindex` alıyor). */
    const tree = await getCategoryTree();
    const categories = tree.flatMap((node) => [node.category, ...node.children.map((c) => c.category)]);

    const categoryPages: MetadataRoute.Sitemap = categories.flatMap((category) => [
      {
        url: `${siteUrl}/kategori/${category.slug}`,
        lastModified: now,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      },
      /* Kategori fırsat sayfası. Sayfa kümesi kategori sayısıyla SINIRLI:
         her marka/fiyat aralığı için otomatik sayfa üretmiyoruz, o ince
         içerik olurdu. */
      {
        url: `${siteUrl}/firsatlar/${category.slug}`,
        lastModified: now,
        changeFrequency: 'daily' as const,
        priority: 0.6,
      },
    ]);

    /* --- Ürün sayfaları ------------------------------------------------------
       `searchProducts` KULLANILMIYOR ve bu bilinçli: o yol `search_products`
       işlevine gidiyor, işlev de limiti `least(p_limit, 100)` ile kesiyor.
       Yani burada 45.000 istenip 100 alınıyordu -- canlı site haritasında
       34.510 üründen 100'ü vardı, kapsam %0,29 (ölçüldü). `MAX_PRODUCTS`
       sabiti bir niyet beyanıydı, etkisi yoktu.

       `getSitemapProducts` grupları doğrudan ve keyset sayfalamayla okuyor;
       sayfa maliyeti konumdan bağımsız (~38 ms). */
    const products = await getSitemapProducts(MAX_PRODUCTS);

    const productPages: MetadataRoute.Sitemap = products.map((product) => ({
      url: `${siteUrl}/urun/${product.slug}`,
      lastModified: now,
      // Fiyatlar günde birkaç kez değişir; sayfa içeriği de onunla değişir.
      changeFrequency: 'daily' as const,
      // Çok satıcılı ürünler daha değerlidir: karşılaştırma vaadini onlar taşır.
      priority: product.offerCount > 1 ? 0.9 : 0.6,
    }));

    // --- Mağaza vitrinleri ---------------------------------------------------
    // Sayıları sınırlı ve içerikleri kararlı; "X mağazası fiyatları" gibi
    // gerçek aramalara denk gelirler.
    const vendors = await getVendors().catch(() => []);

    /* Ortak mağazalar da aynı rotayı kullanıyor. Eskiden yalnızca taşeronlar
       listeleniyordu ve o tablo üretimde boş: kataloğun tamamını sağlayan
       mağazanın vitrini haritada hiç yoktu. Teklifi olmayan mağaza yine
       dışarıda -- ürünsüz vitrin ince içeriktir. */
    /*
     * Hata SESSİZCE yutulmuyor. İlk hâli `.catch(() => [])` idi ve ortak
     * mağazalar haritadan düştüğünde hiçbir iz bırakmıyordu; sorunun canlıda
     * fark edilmesi ancak XML'i saymakla oldu. Harita mağazasız da yayımlanır
     * -- ürün adresleri çok daha değerli -- ama sebebi loglanır.
     */
    const merchants = await getActiveMerchants().catch((error: unknown) => {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'Site haritasi icin ortak magazalar okunamadi',
          hata: error instanceof Error ? error.message : String(error),
        }),
      );
      return [] as Array<{ slug: string }>;
    });

    const vendorPages: MetadataRoute.Sitemap = [
      ...vendors.filter((vendor) => vendor.activeProductCount > 0).map((vendor) => vendor.slug),
      ...merchants.map((merchant) => merchant.slug),
    ].map((slug) => ({
      url: `${siteUrl}/magaza/${slug}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    }));

    return [...staticPages, ...marketplacePages, ...categoryPages, ...vendorPages, ...productPages];
  } catch (error) {
    // Katalog okunamazsa BOŞ harita döndürmek, Google'a "sitede sayfa yok"
    // demektir. Statik sayfalarla dönmek çok daha güvenlidir.
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Site haritası ürünleri okunamadı; yalnızca statik sayfalar yayımlandı',
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    return [...staticPages, ...marketplacePages];
  }
}
