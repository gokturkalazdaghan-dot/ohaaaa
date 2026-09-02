'use client';

/**
 * Hesap menüsü.
 *
 * NEDEN VAR
 * Başlıkta hesap bağlantısı tek bir düğmeydi ve rolüne göre TEK bir yere
 * gidiyordu. Bu yüzden kullanıcının kendi sayfaları — adres defteri, sipariş
 * geçmişi, değerlendirmeler — arayüzden ya hiç görünmüyor ya da başlığa
 * sıkıştırılmış tek bir bağlantıyla temsil ediliyordu. Yazılmış ama
 * ulaşılamayan bir sayfa, yazılmamış sayılır.
 *
 * KLAVYE VE EKRAN OKUYUCU
 * Menü gerçek bir düğme + liste: Escape kapatır, dışarı tıklamak kapatır,
 * odak menüden çıkınca kapanır ve `aria-expanded` durumu söyler. Tıklamayla
 * açılan bir `div` yığını bunların hiçbirini bedavaya vermez.
 */

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

interface MenuLink {
  href: string;
  label: string;
}

export function AccountMenu({
  label,
  initial,
  links,
}: {
  label: string;
  initial: string;
  links: MenuLink[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    /*
     * `focusin` de dinlenir: sekme tuşuyla menünün dışına çıkan bir
     * kullanıcı için menü açık kalmamalı. Yalnızca tıklamayı dinleyen bir
     * menü, klavyeyle gezen birinin ekranında asılı kalır.
     */
    function onFocusIn(event: FocusEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        className="flex items-center gap-2 rounded-xl border border-line bg-surface px-2 py-1.5 text-sm font-medium transition-colors hover:border-brand/40"
      >
        <span className="grid h-7 w-7 place-items-center rounded-lg press bg-brand-cta text-xs font-black text-white">
          {initial}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{label}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-3.5 w-3.5 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Hesap menüsü"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-bg-elevated py-1 shadow-2xl"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-fg transition-colors hover:bg-surface-2"
            >
              {link.label}
            </Link>
          ))}

          <div className="my-1 border-t border-line" />

          {/*
            Çıkış bir FORM'dur, bağlantı değil: GET ile çıkış yaptıran bir uç
            nokta, üçüncü taraf bir sayfanın kullanıcıyı istem dışı
            çıkarmasına izin verir.
          */}
          <form action="/auth/cikis" method="post">
            <button
              type="submit"
              role="menuitem"
              className="w-full px-4 py-2.5 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              Çıkış yap
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
