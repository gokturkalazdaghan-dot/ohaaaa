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

import { isPrelaunch, siteUrl, warnIfLaunchStateInconsistent } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  /*
   * Yayin durumunun sonucu tam olarak BURADA belirir: bu dosya sitenin
   * indekslenip indekslenmeyecegine karar veriyor. Tutarsizligin
   * bildirilecegi en dogru yer de burasi.
   */
  warnIfLaunchStateInconsistent();

  // Üretim dışı ortamların indekslenmesi, asıl siteyle mükerrer içerik üretir.
  const isProduction =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

  // Yayın öncesi aşamada hiçbir sayfa taranmaz: yasal metinler henüz
  // kurulmamış bir işletmeyi adres gösteriyor olabilir.
  if (!isProduction || isPrelaunch) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  /*
   * Kişiye özel sayfalar taranmaz. `/siparislerim` ve `/degerlendirmelerim`
   * listede yoktu; ikisi de oturuma bağlı ve tarayıcı zaten girişe
   * yönlendirilir, ama adresin robots.txt'te durması bir sipariş sayfasının
   * kazayla dizine düşme ihtimalini tümden kapatır.
   */
  const PRIVATE_PATHS = [
    '/git/',
    '/odeme',
    '/tasoron/panel',
    '/siparislerim',
    '/degerlendirmelerim',
    '/adreslerim',
    '/api/',
  ];
  // Arama sonuçları yalnızca genel tarayıcılara kapalı: sonsuz sayıda
  // parametreli adres üretir ve tarama bütçesini yer.
  const PRIVATE_PATHS_WITH_SEARCH = ['/arama', ...PRIVATE_PATHS];

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: PRIVATE_PATHS_WITH_SEARCH,
      },
      {
        /*
         * Yapay zekâ arama motorlarının ürün sayfalarımızı okumasını
         * istiyoruz: fiyat karşılaştırması sorulduğunda kaynak olabiliriz.
         *
         * AMA `/arama` BURADA DA KAPALI. Önceki hâl `PRIVATE_PATHS`
         * kullanıyordu ve o listede `/arama` yok; sonuç olarak bu üç bot,
         * dosyanın en başında "tarama bütçesini yer" diye engellenen
         * sonsuz parametreli arama adreslerini tarayabiliyordu.
         *
         * Ölçüldü (üretim, 14 Eylül 2026 gecesi): her arama sayfası
         * render'ı `search_products` + `search_facets` olmak üzere İKİ
         * pahalı RPC açıyor ve ikisi de birebir aynı oranda zaman aşımına
         * uğruyordu (85 dakikada 267 + 406 hata). Gerçek kullanıcı
         * trafiğinin olmadığı saatlerde bile sürmesi, kaynağın tarayıcı
         * olduğunu gösteriyor.
         *
         * Sayfadaki `noindex` bunu tek başına çözmüyor: indekslemeyi
         * engeller, TARAMAYI engellemez. Taramayı durduran yer burası.
         */
        userAgent: ['OAI-SearchBot', 'PerplexityBot', 'ClaudeBot'],
        allow: ['/', '/urun/'],
        disallow: PRIVATE_PATHS_WITH_SEARCH,
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
