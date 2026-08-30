import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { siteUrl } from './src/lib/env';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Kanonik ana ad (host) — NEXT_PUBLIC_SITE_URL'den türetilir.
 *
 * NEDEN BURADA?
 * `www.ohaaaa.com` ile `ohaaaa.com` ikisi de yanıt verirse Google iki ayrı
 * site görür ve otorite ikiye bölünür. Bu yönlendirme Vercel panelinden de
 * kurulabilir — ama panel ayarı depoda görünmez, gözden kaçar ve başka bir
 * ortama taşınınca gelmez. Koda alındığında dağıtım nereye yapılırsa yapılsın
 * geçerlidir.
 *
 * Yön, elle sabitlenmez: hangi biçim kanonik seçildiyse (www'lu ya da
 * www'suz) diğeri ona yönlendirilir.
 */
function canonicalHost(): string | null {
  /*
   * Adres, uygulamanın kullandığı ÇÖZÜMLEMENİN AYNISINDAN okunur
   * (src/lib/env.ts). Buradaki zinciri elle kopyalamak, iki yerin zamanla
   * ayrışmasına ve şu sessiz hataya yol açardı: canonical etiketi çıplak
   * alan adını gösterirken www hâlâ 200 döner — yani tam da önlemek
   * istediğimiz bölünme.
   */
  try {
    const host = new URL(siteUrl).host;
    // Yerel geliştirmede yönlendirme istemeyiz.
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return null;
    return host;
  } catch {
    return null;
  }
}

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: projectRoot,

  // Monorepo'daki paylaşılan paket TypeScript kaynağından derlenir.
  transpilePackages: ['@ohaaaa/shared'],

  images: {
    // Taşeron görselleri kendi CDN'lerinden gelir; üretimde bu liste
    // onaylı taşeron alan adlarıyla daraltılmalıdır.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },

  async redirects() {
    const host = canonicalHost();
    if (!host) return [];

    // Kanonik biçimin karşıtı: www'suzsa www'lu, www'luysa çıplak hâli.
    const other = host.startsWith('www.') ? host.slice(4) : `www.${host}`;

    return [
      {
        source: '/:path*',
        has: [{ type: 'host' as const, value: other }],
        destination: `https://${host}/:path*`,
        permanent: true, // 308 — arama motorlarına kalıcı taşınma bildirir
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'x-content-type-options', value: 'nosniff' },
          { key: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
          { key: 'x-frame-options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default config;
