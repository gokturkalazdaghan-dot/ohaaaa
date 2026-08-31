'use client';

import Link from 'next/link';
import { Suspense } from 'react';

import { Logo } from './Logo';
import { SearchBar } from './SearchBar';
import { HeartIcon } from './Icons';
import { useCart, useCartSummary } from '@/store/cart';
import { useFavorites } from '@/lib/favorites';

export function Header({ userMenu }: { userMenu?: React.ReactNode }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <Logo />
        <div className="hidden flex-1 md:block">
          <Suspense fallback={<div className="h-10 w-full max-w-xl bg-surface-2" />}>
            <SearchBar />
          </Suspense>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm sm:gap-3">
          {userMenu}
          <FavoritesButton />
          <CartButton />
        </div>
      </div>
      <div className="border-t border-line px-4 py-2 md:hidden">
        <Suspense fallback={<div className="h-10 w-full bg-surface-2" />}>
          <SearchBar />
        </Suspense>
      </div>
    </header>
  );
}

/**
 * Favoriler bağı.
 *
 * Sayaç yalnızca liste DOLUYKEN gösterilir: "0" yazan bir rozet, kullanıcıya
 * hiçbir şey söylemeyip yalnızca gürültü ekler.
 *
 * Sunucuda ve hidrasyondan önce liste boştur; sayaç hidrasyondan sonra
 * belirir. Sunucuda farklı bir sayı çizmek hidrasyon uyuşmazlığı üretirdi.
 */
function FavoritesButton() {
  const count = useFavorites().length;

  return (
    <Link
      href="/favoriler"
      aria-label={count > 0 ? `Favorilerim, ${count} ürün` : 'Favorilerim'}
      className="relative grid h-11 w-11 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <HeartIcon className="h-5 w-5" />
      {count > 0 && (
        <span className="tabular absolute right-1 top-1 min-w-[18px] rounded-full bg-brand-cta px-1 text-[10px] font-bold leading-[18px] text-[#fffaf5]">
          {count}
        </span>
      )}
    </Link>
  );
}

function CartButton() {
  const open = useCart((state) => state.open);
  const summary = useCartSummary();

  return (
    <button
      type="button"
      onClick={open}
      className="border border-line bg-surface px-3 py-1.5 text-sm text-fg"
      aria-label={`Sepeti aç, ${summary.itemCount} ürün`}
    >
      Sepet{summary.itemCount > 0 ? ` (${summary.itemCount})` : ''}
    </button>
  );
}
