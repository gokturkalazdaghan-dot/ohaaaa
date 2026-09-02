import Link from 'next/link';

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
   * Hesap bağlantısı ROLE GÖRE gider.
   *
   * Eskiden yönetici olmayan HERKES `/tasoron/panel`e gönderiliyordu. Oysa
   * varsayılan rol `customer`: sıradan bir alıcı kendi adına tıkladığında
   * satıcı paneline düşüyor ve orada kendi mağazası olmadığı için boş bir
   * ekranla karşılaşıyordu. Kullanıcının kendi adı, kendi sayfasına gitmeli.
   */
  const accountHref =
    user.role === 'admin' ? '/yonetim' : user.role === 'vendor' ? '/tasoron/panel' : '/siparislerim';

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {/*
        Değerlendirme sayfası bir süre HİÇBİR yerden bağlı değildi: sayfa
        çalışıyordu ama adresini bilmeyen bulamıyordu. Yazılmış ama
        ulaşılamayan bir özellik, yazılmamış sayılır.
      */}
      <Link
        href="/degerlendirmelerim"
        className="hidden rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-fg lg:block"
      >
        Değerlendirmelerim
      </Link>
      <Link
        href={accountHref}
        className="flex items-center gap-2 rounded-xl border border-line bg-surface px-2 py-1.5 text-sm font-medium transition-colors hover:border-brand/40"
      >
        <span className="grid h-7 w-7 place-items-center rounded-lg press bg-brand-cta text-xs font-black text-white">
          {initial}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{user.fullName ?? user.email}</span>
      </Link>

      {/*
        Çıkış bir FORM'dur, bağlantı değil: GET ile çıkış yaptıran bir uç
        nokta, üçüncü taraf bir sayfanın kullanıcıyı istem dışı çıkarmasına
        izin verir.
      */}
      <form action="/auth/cikis" method="post">
        <button
          type="submit"
          className="hidden rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:text-fg sm:block"
        >
          Çıkış
        </button>
      </form>
    </div>
  );
}
