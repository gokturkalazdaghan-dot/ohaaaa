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

import { getCategories, getVendors, searchProducts } from '@/data/catalog';
import { isAffiliateOnly, siteUrl } from '@/lib/env';

/** Tek haritaya sığdırılacak en fazla ürün. */
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
    // --- Kategori sayfaları --------------------------------------------------
    const categories = await getCategories();

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

    // --- Ürün sayfaları ------------------------------------------------------
    const { results: products } = await searchProducts({ limit: MAX_PRODUCTS, sort: 'offers' });

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

    const vendorPages: MetadataRoute.Sitemap = vendors
      .filter((vendor) => vendor.activeProductCount > 0)
      .map((vendor) => ({
        url: `${siteUrl}/magaza/${vendor.slug}`,
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
