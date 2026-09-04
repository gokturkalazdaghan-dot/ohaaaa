import type { Metadata } from 'next';

import { CheckoutFlow } from '@/components/CheckoutFlow';
import { getSavedAddresses } from '@/data/catalog';
import { requireMarketplaceMode } from '@/lib/commerceGuard';

export const metadata: Metadata = {
  title: 'Ödeme',
  description: 'Siparişinizi tamamlayın.',
  robots: { index: false, follow: false },
};

/*
 * Sayfa artık kullanıcının KAYITLI ADRESLERİNİ okuyor; bir an bile
 * önbelleğe alınamaz. Next, `cookies()` görüldüğünde rotayı kendiliğinden
 * dinamik yapar ama demo modunda Supabase istemcisi çerezlere hiç
 * dokunmadan null döner ve o sinyal oluşmaz. Bir kullanıcının ev adresinin
 * önbellekten başkasına servis edilme ihtimali, açık bir bildirimle
 * kapatılacak kadar ciddidir.
 */
export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  requireMarketplaceMode();

  // Misafir alışverişi destekleniyor: giriş yoksa liste boş döner ve form
  // eskisi gibi elle doldurulur.
  const addresses = await getSavedAddresses();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Ödeme</h1>
      <p className="mt-1.5 text-sm text-muted">
        Siparişiniz mağaza bazında bölünür; her mağaza kendi kargosuyla gönderir.
      </p>

      <CheckoutFlow addresses={addresses} />
    </div>
  );
}
