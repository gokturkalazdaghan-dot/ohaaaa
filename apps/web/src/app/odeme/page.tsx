import type { Metadata } from 'next';

import { CheckoutFlow } from '@/components/CheckoutFlow';

export const metadata: Metadata = {
  title: 'Ödeme',
  description: 'Siparişinizi tamamlayın.',
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Ödeme</h1>
      <p className="mt-1.5 text-sm text-muted">
        Siparişiniz mağaza bazında bölünür; her mağaza kendi kargosuyla gönderir.
      </p>

      <CheckoutFlow />
    </div>
  );
}
