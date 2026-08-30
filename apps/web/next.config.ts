import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
