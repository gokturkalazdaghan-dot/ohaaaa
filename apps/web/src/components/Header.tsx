'use client';

import Link from 'next/link';
import { Suspense } from 'react';

import { CartIcon } from './Icons';
import { Logo } from './Logo';
import { SearchBar } from './SearchBar';
import { ThemeToggle } from './ThemeToggle';
import { useCart, useCartSummary } from '@/store/cart';

/**
 * Üst bar.
 *
 * `userMenu` bir prop olarak alınır çünkü Header istemci bileşenidir
 * (sepet durumunu dinler) ve istemci bileşeni içinden sunucu bileşeni
 * ÇAĞRILAMAZ — ama children/prop olarak GEÇİRİLEBİLİR.
 */
export function Header({ userMenu }: { userMenu?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line glass">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Logo />

        {/* Arama, useSearchParams kullandığı için Suspense sınırı gerekir. */}
        <div className="hidden flex-1 justify-center md:flex">
          <Suspense fallback={<div className="h-11 w-full max-w-xl rounded-2xl skeleton" />}>
            <SearchBar />
          </Suspense>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {userMenu}

          <ThemeToggle />
          <CartButton />
        </div>
      </div>

      {/* Mobilde arama ikinci satıra iner. */}
      <div className="border-t border-line px-4 py-2.5 md:hidden">
        <Suspense fallback={<div className="h-11 w-full rounded-2xl skeleton" />}>
          <SearchBar />
        </Suspense>
      </div>
    </header>
  );
}

function CartButton() {
  const open = useCart((state) => state.open);
  const summary = useCartSummary();

  return (
    <button
      type="button"
      onClick={open}
      className="relative grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-muted transition-colors hover:bg-surface-hover hover:text-fg"
      aria-label={`Sepeti aç, ${summary.itemCount} ürün`}
    >
      <CartIcon className="h-5 w-5" />

      {summary.itemCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-oha px-1 text-[10px] font-bold text-white">
          {summary.itemCount > 99 ? '99+' : summary.itemCount}
        </span>
      )}
    </button>
  );
}
