/**
 * robots.txt.
 *
 * Neyin taranmasını istemediğimiz, neyi istediğimiz kadar önemlidir:
 *
 *   • /arama  — sonsuz varyantlı sorgu sayfaları. Taranırsa tarama bütçesi
 *               ürün sayfalarına değil, boş arama sonuçlarına harcanır.
 *   • /git    — ortaklık yönlendirmeleri. Tarayıcının tıklaması sahte
 *               tıklama üretir ve ortaklık raporlarımızı kirletir.
 *   • /odeme  — kişisel veri içerir, hiçbir koşulda indekslenmemeli.
 *   • /tasoron/panel — satıcıya özel alan.
 *   • /api    — makineler için, insanlar için değil.
 *
 * Not: robots.txt taramayı engeller, İNDEKSLEMEYİ değil. Bir sayfanın arama
 * sonuçlarında hiç çıkmaması için `noindex` meta etiketi gerekir; ilgili
 * sayfalarda o da tanımlıdır.
 */

import type { MetadataRoute } from 'next';

import { isPrelaunch, siteUrl } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  // Üretim dışı ortamların indekslenmesi, asıl siteyle mükerrer içerik üretir.
  const isProduction =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

  // Yayın öncesi aşamada hiçbir sayfa taranmaz: yasal metinler henüz
  // kurulmamış bir işletmeyi adres gösteriyor olabilir.
  if (!isProduction || isPrelaunch) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/arama', '/git/', '/odeme', '/tasoron/panel', '/api/'],
      },
      {
        // Yapay zekâ arama motorlarının ürün sayfalarımızı okumasını
        // istiyoruz: fiyat karşılaştırması sorulduğunda kaynak olabiliriz.
        userAgent: ['OAI-SearchBot', 'PerplexityBot', 'ClaudeBot'],
        allow: ['/', '/urun/'],
        disallow: ['/git/', '/odeme', '/tasoron/panel', '/api/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
