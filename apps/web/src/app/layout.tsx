import type { Metadata, Viewport } from 'next';

import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { CartDrawer } from '@/components/CartDrawer';
import { DemoBanner } from '@/components/DemoBanner';
import { isDemoMode } from '@/data/catalog';
import { siteUrl } from '@/lib/env';

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
  robots: { index: true, follow: true },
};

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
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">
        {/* Klavye kullanıcıları için içeriğe atlama bağlantısı. */}
        <a
          href="#icerik"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-white"
        >
          İçeriğe atla
        </a>

        {isDemoMode() && <DemoBanner />}
        <Header />
        <main id="icerik">{children}</main>
        <Footer />
        <CartDrawer />
      </body>
    </html>
  );
}
