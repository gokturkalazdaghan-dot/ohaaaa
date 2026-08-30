import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const config: NextConfig = {
  reactStrictMode: true,

  /*
   * "X-Powered-By: Next.js" başlığını kapatır.
   *
   * Tek başına bir açık değil, ama saldırgana hangi yığını kullandığımızı
   * söyler. Bilinen bir Next.js açığı çıktığında taramalar önce bu başlığa
   * bakarak hedef listesi çıkarır. Söylememek bedava.
   */
  poweredByHeader: false,
  outputFileTracingRoot: projectRoot,

  // Monorepo'daki paylaşılan paket TypeScript kaynağından derlenir.
  transpilePackages: ['@ohaaaa/shared'],

  images: {
    // Taşeron görselleri kendi CDN'lerinden gelir; üretimde bu liste
    // onaylı taşeron alan adlarıyla daraltılmalıdır.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'x-content-type-options', value: 'nosniff' },
          { key: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
          { key: 'x-frame-options', value: 'SAMEORIGIN' },
          /*
           * HSTS burada da tanımlı, yalnızca vercel.json'da değil.
           *
           * Panelde ya da platform yapılandırmasında duran bir güvenlik
           * başlığı, dağıtım başka bir yere taşındığında sessizce kaybolur.
           * Uygulamanın kendisi göndermeli ki nerede çalışırsa çalışsın
           * korunsun. Aynı başlığın iki yerden gelmesi sorun değildir;
           * eksik olması sorundur.
           *
           * Tarayıcılar HSTS'i yalnızca HTTPS yanıtlarında dikkate alır;
           * yerel http sunucuda etkisizdir, zarar vermez.
           *
           * preload YOK: preload listesine girmek geri dönüşü çok zor bir
           * taahhüttür (tüm alt alan adları kalıcı olarak HTTPS zorunlu).
           * Buna site sahibi karar vermeli.
           */
          {
            key: 'strict-transport-security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default config;
