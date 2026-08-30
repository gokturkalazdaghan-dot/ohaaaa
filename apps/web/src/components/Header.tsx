'use client';

import Link from 'next/link';
import { Suspense } from 'react';

import { Logo } from './Logo';
import { SearchBar } from './SearchBar';
import { useCart, useCartSummary } from '@/store/cart';

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
        <div className="ml-auto flex items-center gap-3 text-sm">
          {userMenu}
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
