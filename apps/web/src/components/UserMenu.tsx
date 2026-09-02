import Link from 'next/link';

import { AccountMenu } from './AccountMenu';
import { StoreIcon } from './Icons';
import { getSessionUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/env';

/**
 * Üst bardaki oturum bölümü.
 *
 * Server Component'tir: oturum durumu sunucuda bilinir, istemciye jeton
 * gönderilmez ve "bir an giriş yapmamış görünüp sonra düzelme" (flash of
 * logged-out state) yaşanmaz.
 *
 * MOBİL: Bu bölüm eskiden `hidden sm:flex` ile tümüyle gizleniyordu; 640
 * pikselin altında "Satıcı Ol" ve "Giriş" hiç görünmüyor, başlıkta yalnızca
 * Sepet kalıyordu. Katalog mağazalardan gelir, mağaza da satıcı sayfasından;
 * bu bağlantının mobilde kaybolması işin can damarını kesiyordu. Artık
 * mobilde de duruyor, yalnızca etiket gizlenip simge kalıyor.
 */
export async function UserMenu() {
  // Demo modunda auth akışı yoktur; panel örnek verilerle gezilebilir.
  if (!isSupabaseConfigured() || process.env.NEXT_PHASE === 'phase-production-build') {
    return (
      <Link
        href="/tasoron"
        className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-fg sm:px-3.5"
        aria-label="Satıcı Ol"
      >
        <StoreIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Satıcı Ol</span>
      </Link>
    );
  }

  const user = await getSessionUser();

  if (!user) {
    return (
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Link
          href="/tasoron"
          className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium text-muted transition-colors hover:text-fg sm:px-3"
          aria-label="Satıcı Ol"
        >
          <StoreIcon className="h-4 w-4 sm:hidden" />
          <span className="hidden sm:inline">Satıcı Ol</span>
        </Link>
        <Link
          href="/giris"
          className="rounded-xl border border-line bg-surface px-3.5 py-2 text-sm font-medium transition-colors hover:border-brand/40"
        >
          Giriş
        </Link>
      </div>
    );
  }

  const initial = (user.fullName ?? user.email).charAt(0).toUpperCase();

  /*
   * Menü içeriği ROLE GÖRE kurulur.
   *
   * Eskiden yönetici olmayan HERKES tek bir bağlantıyla /tasoron/panel'e
   * gönderiliyordu. Varsayılan rol `customer`: sıradan bir alıcı kendi adına
   * tıkladığında satıcı paneline düşüyor ve orada kendi mağazası olmadığı
   * için boş bir ekranla karşılaşıyordu. Alıcının kendi sayfaları
   * (siparişler, adresler, değerlendirmeler) ise hiçbir yerden bağlı
   * değildi.
   */
  const links = [
    { href: '/siparislerim', label: 'Siparişlerim' },
    { href: '/favoriler', label: 'Favorilerim' },
    { href: '/adreslerim', label: 'Adreslerim' },
    { href: '/degerlendirmelerim', label: 'Değerlendirmelerim' },
  ];

  if (user.role === 'vendor') {
    links.push({ href: '/tasoron/panel', label: 'Mağaza panelim' });
  }
  if (user.role === 'admin') {
    links.push({ href: '/yonetim', label: 'Yönetim' });
  }

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <AccountMenu label={user.fullName ?? user.email} initial={initial} links={links} />
    </div>
  );
}
