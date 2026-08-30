'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Aktif sayfayı hem görsel olarak hem de aria-current ile işaretler. */
export function NavLink({
  href,
  exact = false,
  children,
}: {
  href: string;
  exact?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
        isActive
          ? 'bg-brand/12 text-brand-soft'
          : 'text-muted hover:bg-surface-hover hover:text-fg'
      }`}
    >
      {children}
    </Link>
  );
}
