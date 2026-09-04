import type { Metadata } from 'next';

import { VendorApplicationForm } from '@/components/VendorApplicationForm';
import { requireMarketplaceMode } from '@/lib/commerceGuard';

export const metadata: Metadata = {
  title: 'Taşeron başvurusu',
  description: 'Ohaaaa’da satış yapmak için başvurun.',
  alternates: { canonical: '/tasoron/basvuru' },
};

export default function VendorApplicationPage() {
  requireMarketplaceMode();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-fg">Taşeron başvurusu</h1>
      <p className="mt-2 leading-relaxed text-muted">
        Formu doldurun; vergi numarası doğrulaması sonrası hesabınız genellikle 1 iş günü
        içinde onaylanır. Onay sonrası panelden API anahtarınızı oluşturup kataloğunuzu
        besleyebilirsiniz.
      </p>

      <VendorApplicationForm />
    </div>
  );
}
