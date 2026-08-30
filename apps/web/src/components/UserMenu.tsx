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
 */
export async function UserMenu() {
  // Demo modunda auth akışı yoktur; panel örnek verilerle gezilebilir.
  if (!isSupabaseConfigured()) {
    return (
      <Link
        href="/tasoron"
        className="hidden items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-fg sm:flex"
      >
        <StoreIcon className="h-4 w-4" />
        Satıcı Ol
      </Link>
    );
  }

  const user = await getSessionUser();

  if (!user) {
    return (
      <div className="hidden items-center gap-2 sm:flex">
        <Link
          href="/tasoron"
          className="rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-fg"
        >
          Satıcı Ol
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

  return (
    <div className="hidden items-center gap-2 sm:flex">
      <Link
        href={user.role === 'admin' ? '/yonetim' : '/tasoron/panel'}
        className="flex items-center gap-2 rounded-xl border border-line bg-surface px-2 py-1.5 text-sm font-medium transition-colors hover:border-brand/40"
      >
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand to-electric text-xs font-black text-white">
          {initial}
        </span>
        <span className="max-w-28 truncate">{user.fullName ?? user.email}</span>
      </Link>

      {/*
        Çıkış bir FORM'dur, bağlantı değil: GET ile çıkış yaptıran bir uç
        nokta, üçüncü taraf bir sayfanın kullanıcıyı istem dışı çıkarmasına
        izin verir.
      */}
      <form action="/auth/cikis" method="post">
        <button
          type="submit"
          className="rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:text-fg"
        >
          Çıkış
        </button>
      </form>
    </div>
  );
}
