import type { Metadata, Viewport } from 'next';

import { Analytics } from '@/components/Analytics';
import { ConsentBanner } from '@/components/ConsentBanner';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { UserMenu } from '@/components/UserMenu';
import { CartDrawer } from '@/components/CartDrawer';
import { DemoBanner } from '@/components/DemoBanner';
import { JsonLd } from '@/components/JsonLd';
import { isDemoMode } from '@/data/catalog';
import { gaMeasurementId, isPrelaunch, searchConsoleVerification, siteUrl } from '@/lib/env';

import './globals.css';

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
  themeColor: '#F3EEE6',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <head>
        <JsonLd data={siteJsonLd} />
      </head>
      <body className="min-h-screen bg-bg text-fg">
        <a
          href="#icerik"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-brand focus:px-4 focus:py-2 focus:text-white"
        >
          İçeriğe atla
        </a>
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
