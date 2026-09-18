import type { MetadataRoute } from 'next';

/**
 * Web uygulaması künyesi (`/manifest.webmanifest`).
 *
 * NE İŞE YARAR
 * Tarayıcı bir siteyi ancak bu dosyayı okuduktan sonra "kurulabilir" sayar.
 * Android/Chrome gerçek yükleme istemini, iOS ise Ana Ekrana Ekle sonrası
 * tam ekran açılışı buradaki değerlere göre kurar.
 *
 * NE DEĞİLDİR
 * Bu bir mağaza uygulaması DEĞİL. App Store / Google Play bağlantısı yok,
 * olmayacak da: Ohaaaa tarayıcıdan kurulan bir web uygulaması. Kullanıcıya
 * native uygulama gibi tanıtmak yanlış beyan olurdu.
 *
 * NEDEN KOD, NEDEN STATİK JSON DEĞİL
 * Next.js'in dosya kuralı: `app/manifest.ts` varsa `<link rel="manifest">`
 * etiketini her sayfaya KENDİSİ ekler. Elle yazılmış bir `public/*.json`
 * için o etiketi ayrıca düzene gömmek ve ikisini elde senkron tutmak
 * gerekirdi.
 */
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ohaaaa — kargo dahil fiyat karşılaştırması',
    short_name: 'Ohaaaa',
    description:
      'Aynı ürünü mağazalarda karşılaştır, kargo dahil tutarı gör, fiyat düşünce haberdar ol.',
    /*
     * `kaynak=pwa`: ana ekrandan açılan oturumlar ölçümde ayırt edilebilsin.
     * Ana sayfa bilinmeyen sorgu parametrelerini yok sayar ve kanonik adres
     * sorgusuz üretilir (bkz. lib/seo.ts), dolayısıyla SEO'ya dokunmaz.
     */
    start_url: '/?kaynak=pwa',
    scope: '/',
    /*
     * `standalone`: tarayıcı çubuğu olmadan açılır ama sistem durum çubuğu
     * kalır. `fullscreen` bir alışveriş uygulaması için yanlış olurdu --
     * kullanıcı saati ve pili görebilmeli.
     */
    display: 'standalone',
    /* Telefonda dikey; tablette yatay çevrilmesini engellemek için değil,
       ilk açılışın dikey olması için. */
    orientation: 'portrait',
    lang: 'tr',
    dir: 'ltr',
    /*
       Açılış ekranının zemini SİTENİN zeminiyle aynı: farklı olursa
       uygulama açılırken bir renk sıçraması görünür. Değerler
       globals.css içindeki `--bg` ile birebir aynı.
    */
    background_color: '#faf6f1',
    theme_color: '#faf6f1',
    categories: ['shopping'],
    /*
     * `purpose: 'any'` -- `maskable` BİLEREK YAZILMADI.
     *
     * Maskable bir simge, kenarlarından %20 kırpılabileceğini varsayarak
     * güvenli alan bırakılmış olmalıdır. Armada böyle bir payanda yok;
     * maskable ilan etmek Android'de armanın kenarlarının kesilmesi
     * demekti. Yanlış beyan etmektense kırpılmamış simge sunuluyor.
     */
    icons: [
      {
        src: '/marka/ohaaaa-arma-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/marka/ohaaaa-arma-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    shortcuts: [
      { name: 'Fırsatlar', short_name: 'Fırsatlar', url: '/firsatlar' },
      { name: 'Fiyat takibi', short_name: 'Takip', url: '/fiyat-takip' },
    ],
  };
}
