'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';

import { Logo } from './Logo';
import { SearchBar } from './SearchBar';
import { HeartIcon } from './Icons';
import { useCart, useCartSummary } from '@/store/cart';
import { useFavorites } from '@/lib/favorites';
import { isAffiliateOnly } from '@/lib/env';

export function Header({
  userMenu,
  categoryNav,
  visualSearchEnabled = false,
}: {
  userMenu?: React.ReactNode;
  /** Görme modeli sunucuda açık mı; arama çubuğuna aktarılır. */
  visualSearchEnabled?: boolean;
  /** Kategori şeridi. Sunucuda çizilir; veri için istemciye tur atılmaz. */
  categoryNav?: React.ReactNode;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isStuck = useStuck(sentinelRef);

  return (
    <>
      {/*
        Gözcü öge: sayfanın en tepesinde duran 1 pikselik bir işaret.
        Görünürlükten çıktığı an, üst çubuk gerçekten içeriğin üstüne
        binmiş demektir.

        Neden kaydırma dinleyicisi değil: `scroll` olayı her karede
        çalışır ve ana iş parçacığını meşgul eder. IntersectionObserver
        yalnızca eşik geçildiğinde bir kez haber verir.
      */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

      <header className="site-header" data-stuck={isStuck}>
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <Logo />
        <div className="hidden flex-1 md:block">
          <Suspense fallback={<div className="h-10 w-full max-w-xl bg-surface-2" />}>
            <SearchBar label="Üst çubukta ürün ara" visualSearchEnabled={visualSearchEnabled} />
          </Suspense>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm sm:gap-3">
          {userMenu}
          <FavoritesButton />
          {isAffiliateOnly ? null : <CartButton />}
        </div>
      </div>
      <div className="border-t border-line px-4 py-2 md:hidden">
        <Suspense fallback={<div className="h-10 w-full bg-surface-2" />}>
          <SearchBar label="Üst çubukta ürün ara" visualSearchEnabled={visualSearchEnabled} />
        </Suspense>
      </div>

      {/*
        KATEGORİ ŞERİDİ HER SAYFADA.

        Kategoriler yalnızca ana sayfada vardı: bir ürün sayfasından ya da
        arama sonucundan başka bir kategoriye geçmenin tek yolu ana sayfaya
        dönmekti. Kategoriye göre gezinmek bu tür sitelerde aramanın yanındaki
        ikinci ana yol; üst çubukta olmaması, ziyaretçiyi her seferinde
        başa döndürüyordu.
      */}
      {categoryNav}
      </header>
    </>
  );
}

/**
 * Üst çubuğun içeriğin üstüne binip binmediğini bildirir.
 *
 * Sunucuda ve ilk boyamada `false`: sayfa henüz kaydırılmamıştır ve
 * sunucuda farklı bir değer üretmek hidrasyon uyuşmazlığı olurdu.
 */
function useStuck(sentinelRef: React.RefObject<HTMLDivElement | null>): boolean {
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry?.isIntersecting),
      // Eşik 0: gözcü tamamen görünmez olunca tetiklenir.
      { threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinelRef]);

  return isStuck;
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
        <span className="tabular absolute right-1 top-1 min-w-[18px] rounded-full press bg-brand-cta px-1 text-3xs font-bold leading-[18px] text-[#fffaf5]">
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
