import type { Metadata, Viewport } from 'next';

import { Analytics } from '@/components/Analytics';
import { ConsentBanner } from '@/components/ConsentBanner';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { UserMenu } from '@/components/UserMenu';
import { CartDrawer } from '@/components/CartDrawer';
import { DemoBanner } from '@/components/DemoBanner';
import { PrelaunchBanner } from '@/components/PrelaunchBanner';
import { JsonLd } from '@/components/JsonLd';
import { isDemoMode } from '@/data/catalog';
import { gaMeasurementId, isPrelaunch, searchConsoleVerification, siteUrl } from '@/lib/env';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Ohaaaa — Tüm mağazalar tek aramada, en iyi fiyat önde',
    template: '%s · Ohaaaa',
  },
  description:
    'Ohaaaa, Türkiye’nin çok satıcılı süper-agregatörü. Aynı ürünü onlarca ' +
    'mağazadan karşılaştır, kargo dahil en iyi toplam fiyatı gör, tek sepetten satın al.',
  keywords: ['fiyat karşılaştırma', 'pazar yeri', 'online alışveriş', 'ohaaaa', 'e-ticaret'],
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    siteName: 'Ohaaaa',
    title: 'Ohaaaa — Tüm mağazalar tek aramada',
    description: 'Kargo dahil en iyi toplam fiyatı gör, tek sepetten satın al.',
  },
  // Yayın öncesinde robots.txt'ye ek olarak meta etiketiyle de kapatılır:
  // robots.txt taramayı engeller, İNDEKSLEMEYİ değil. Bir sayfaya dışarıdan
  // link verilmişse Google onu taramadan da indeksleyebilir; `noindex` bunu
  // kesin olarak durdurur.
  robots: {
    index: !isPrelaunch,
    follow: !isPrelaunch,
    googleBot: {
      index: !isPrelaunch,
      follow: !isPrelaunch,
      // Arama sonucunda ürün görselinin ve daha uzun özetin çıkmasına izin ver.
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  // Search Console doğrulaması (madde 19). Ortam değişkeni boşsa etiket basılmaz.
  ...(searchConsoleVerification
    ? { verification: { google: searchConsoleVerification } }
    : {}),
};

/**
 * Site geneli yapılandırılmış veri.
 *
 * `SearchAction`, Google'ın arama sonucunda doğrudan site içi arama kutusu
 * göstermesini sağlar. `Organization` ise marka bilgisinin bilgi panelinde
 * doğru görünmesi içindir.
 */
const siteJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: 'Ohaaaa',
    url: siteUrl,
    description:
      'Aynı ürünü onlarca mağazadan karşılaştıran, kargo dahil toplam maliyete göre ' +
      'sıralayan fiyat karşılaştırma platformu.',
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'destek@ohaaaa.com',
      availableLanguage: ['Turkish'],
    },
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
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0c' },
    { media: '(prefers-color-scheme: light)', color: '#fbfbfd' },
  ],
};

/**
 * Tema, React yüklenmeden ÖNCE uygulanmalıdır; aksi halde koyu tema
 * kullanıcısı ilk boyamada beyaz ekran görür (flash of wrong theme).
 * Bu betik senkron çalışır ve <html> sınıfını render'dan önce ayarlar.
 */
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('ohaaaa-theme');
    var prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    var theme = stored || (prefersLight ? 'light' : 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.classList.toggle('dark', theme !== 'light');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <JsonLd data={siteJsonLd} />
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">
        {/* Klavye kullanıcıları için içeriğe atlama bağlantısı. */}
        <a
          href="#icerik"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-white"
        >
          İçeriğe atla
        </a>

        {isPrelaunch && <PrelaunchBanner />}
        {isDemoMode() && <DemoBanner />}
        <Header userMenu={<UserMenu />} />
        <main id="icerik">{children}</main>
        <Footer />
        <CartDrawer />
        <ConsentBanner />
        {gaMeasurementId && <Analytics measurementId={gaMeasurementId} />}
      </body>
    </html>
  );
}
