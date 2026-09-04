import type { Metadata, Viewport } from 'next';
import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';

import { Analytics } from '@/components/Analytics';
import { VercelAnalytics } from '@/components/VercelAnalytics';
import { ConsentBanner } from '@/components/ConsentBanner';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { CategoryNav } from '@/components/CategoryNav';
import { FavoritesProvider } from '@/components/FavoritesProvider';
import { UserMenu } from '@/components/UserMenu';
import { CartDrawer } from '@/components/CartDrawer';
import { DemoBanner } from '@/components/DemoBanner';
import { PrelaunchBanner } from '@/components/PrelaunchBanner';
import { JsonLd } from '@/components/JsonLd';
import { isDemoMode } from '@/data/catalog';
import {
  gaMeasurementId,
  isAffiliateOnly,
  isPrelaunch,
  searchConsoleVerification,
  siteUrl,
} from '@/lib/env';
import { getRequestLocale } from '@/lib/locale';

import './globals.css';

/*
 * Tipografi markanin yarisidir. Sistem yazi tipi yiginiyla site her isletim
 * sisteminde baska turlu ve hicbirinde kasitli gorunuyordu. Plus Jakarta Sans
 * geometrik ve yuvarlak - armadaki harflerle ayni ailedeki his.
 *
 * next/font derleme aninda indirip kendi kendine barindirir: calisma aninda
 * Google'a istek gitmez, bu yuzden hem gizlilik hem de yukleme suresi acisindan
 * <link> etiketinden iyidir.
 */
/*
 * Arma Outfit Bold ile cizildi. Basliktaki arma yazisi artik CANLI METIN
 * (harfler tek tek hareket edebilsin diye), dolayisiyla ayni yazi tipinin
 * tarayicida da bulunmasi gerekiyor - yoksa favicon ile baslik farkli
 * harflerle yazilmis gorunur.
 */
const outfit = Outfit({
  subsets: ['latin', 'latin-ext'],
  weight: ['700'],
  display: 'swap',
  variable: '--font-outfit',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],     // latin-ext: Turkce ğ ş ı İ ç ö ü
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-jakarta',
});

/** Header oturum için cookies() kullanır; derlemede statik sayfa üretme. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Ohaaaa — kargo dahil fiyat karşılaştırması',
    template: '%s · Ohaaaa',
  },
  description: 'Aynı ürünü mağazalarda karşılaştır. Kargo dahil tutarı gör.',
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    siteName: 'Ohaaaa',
    title: 'Ohaaaa — kargo dahil fiyat karşılaştırması',
    description: 'Aynı ürünü mağazalarda karşılaştır.',
  },
  robots: {
    index: !isPrelaunch,
    follow: !isPrelaunch,
    googleBot: {
      index: !isPrelaunch,
      follow: !isPrelaunch,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  ...(searchConsoleVerification
    ? { verification: { google: searchConsoleVerification } }
    : {}),
};

const siteJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: 'Ohaaaa',
    url: siteUrl,
    description: 'Kargo dahil fiyat karşılaştırma.',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${siteUrl}/#website`,
    url: siteUrl,
    name: 'Ohaaaa',
    inLanguage: 'tr-TR',
    publisher: { '@id': `${siteUrl}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl}/arama?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  },
];

export const viewport: Viewport = {
  /*
   * Tarayıcı çubuğu rengi ZEMİNLE aynı olmalı.
   *
   * Bu değer bej palete geçişte güncellenmeden kaldı: site açık bej
   * zeminliyken mobil tarayıcı çubuğu hâlâ eski koyu paletin rengini
   * (#0B0B0D) yayınlıyordu -- yani markanın rengi değil, silinmiş bir
   * temanın rengi.
   *
   * İki tema için iki değer verilir; tarayıcı hangisini uygulayacağına
   * kullanıcının ayarına göre karar verir.
   */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf6f1' },
    { media: '(prefers-color-scheme: dark)', color: '#12100e' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * DİL ARTIK SABİT DEĞİL, AMA UYDURMA DA DEĞİL.
   *
   * Önce `lang="tr"` gömülüydü. Şimdi istekten çözülüyor -- ancak
   * `contentTag`, kullanıcının İSTEDİĞİ dili değil GERÇEKTEN SUNULAN dili
   * bildirir. Gerekçesi `lib/locale.ts` içinde yazılı: çevirisi olmayan
   * bir dili ilan etmek, ekran okuyucuya yanlış fonetik ve arama
   * motoruna yanlış dil bildirmek demektir.
   */
  const { contentTag } = await getRequestLocale();

  return (
    <html lang={contentTag} className={`${jakarta.variable} ${outfit.variable}`}>
      <head>
        <JsonLd data={siteJsonLd} />
      </head>
      <body className="min-h-screen bg-bg text-fg">
        <a
          href="#icerik"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:press bg-brand-cta focus:px-4 focus:py-2 focus:text-white"
        >
          İçeriğe atla
        </a>
        {isDemoMode() && <DemoBanner />}
        {/*
          Yayın öncesi şeridi.

          Bu bileşen yazılmıştı, yorumu da yazılmıştı -- ama JSX HİÇBİR ZAMAN
          eklenmemişti: yorum, kodun yapmadığı bir şeyi anlatıyordu.

          `NEXT_PUBLIC_LAUNCH_STATE=prelaunch` iken site robots.txt ile
          tamamen kapalı ve tüm sayfalar `noindex`. Şerit olmayınca bu
          durumun tek görünür işareti de yok: canlıya geçtiğinizi sanıp
          haftalarca hiç indekslenmeyen bir siteyle yaşayabilirsiniz.
        */}
        {isPrelaunch && <PrelaunchBanner />}
        {/*
          Favori sağlayıcısı Header'ı da SARAR: başlıktaki favori sayacı ve
          ürün kartlarındaki kalpler aynı listeyi okumalı. Yalnızca `main`
          sarılsaydı başlık kendi (tarayıcı) listesini, sayfa içeriği hesap
          listesini gösterirdi.
        */}
        <FavoritesProvider>
          <Header userMenu={<UserMenu />} categoryNav={<CategoryNav />} />
          <main id="icerik">{children}</main>
          <Footer />
          {isAffiliateOnly ? null : <CartDrawer />}
        </FavoritesProvider>
        <ConsentBanner />
        {gaMeasurementId && <Analytics measurementId={gaMeasurementId} />}
        <VercelAnalytics />
      </body>
    </html>
  );
}
