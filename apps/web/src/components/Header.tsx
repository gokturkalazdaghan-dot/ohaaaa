'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { yoluAyristir } from '@ohaaaa/shared';

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

  /*
   * ANA SAYFADA ÜST ÇUBUKTA İKİNCİ BİR ARAMA KUTUSU ÇİZİLMEZ.
   *
   * Ölçülen durum: ana sayfada aynı anda ÜÇ `role="search"` bölgesi
   * vardı -- üst çubuğun masaüstü kopyası, mobil kopyası ve kahraman
   * alanındaki kutu. Telefonda ikisi birden GÖRÜNÜYORDU: biri üstte,
   * biri hemen altında. Ekran okuyucu da üç kez "arama" duyuruyordu ve
   * üçünün etiketi aynıydı.
   *
   * Kahraman alanı ekrandayken arama zaten orada; üst çubuğunki fazladan.
   * Kullanıcı aşağı kaydırıp kahraman alanı çıkınca (`isStuck`) üst
   * çubuktaki kutu devreye giriyor. Yani her an TAM BİR arama kutusu var
   * ve kaydırdıktan sonra arama kaybolmuyor.
   *
   * Dil öneki ayıklanıyor: `/en-uk` da ana sayfadır.
   */
  const { kalan } = yoluAyristir(usePathname() ?? '/');
  const anaSayfa = kalan === '/';
  const aramaGoster = !anaSayfa || isStuck;

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
      {/*
        ARAMA KUTUSU DOM'DA TEK. Önce iki kez çiziliyordu -- biri
        `hidden md:block`, diğeri `md:hidden` -- ve yalnızca biri
        görünüyordu ama İKİSİ DE belgede duruyordu: iki `role="search"`
        bölgesi, iki gizli dosya girdisi. Şimdi tek düğüm var; yerini
        `flex-wrap` + `order` değiştiriyor, kopyalama değil.
      */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Logo />
        <div className="order-3 ml-auto flex items-center gap-2 text-sm sm:gap-3 md:order-4">
          {userMenu}
          <FavoritesButton />
          {isAffiliateOnly ? null : <CartButton />}
        </div>
        {aramaGoster && (
          <div className="order-4 w-full border-t border-line pt-2 md:order-3 md:ml-0 md:w-auto md:flex-1 md:border-t-0 md:pt-0">
            <Suspense fallback={<div className="h-10 w-full bg-surface-2 md:max-w-xl" />}>
              <SearchBar label="Üst çubukta ürün ara" visualSearchEnabled={visualSearchEnabled} />
            </Suspense>
          </div>
        )}
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
