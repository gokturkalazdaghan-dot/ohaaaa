import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

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
        ],
      },
    ];
  },
};

export default config;
