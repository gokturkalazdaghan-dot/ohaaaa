import type { Metadata } from 'next';

import { ApiKeyManager } from '@/components/ApiKeyManager';

export const metadata: Metadata = {
  title: 'API anahtarları',
  robots: { index: false, follow: false },
};

export default function ApiKeysPage() {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-bold">API anahtarları</h2>
        <p className="mt-1 text-sm text-muted">
          Kataloğunuzu otomatik senkronize etmek için anahtar oluşturun. Her anahtara
          yalnızca ihtiyaç duyduğu yetkileri verin.
        </p>
      </header>

      <ApiKeyManager />
    </div>
  );
}
