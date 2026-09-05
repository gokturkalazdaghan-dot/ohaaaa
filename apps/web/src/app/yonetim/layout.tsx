import Link from 'next/link';

import { ChainIcon, ChartIcon, StoreIcon } from '@/components/Icons';
import { NavLink } from '@/components/NavLink';

/**
 * Yönetim paneli kabuğu.
 *
 * Erişim middleware'de (`ADMIN_PREFIXES`) kapatılır; buradaki her sayfa
 * ayrıca kendi kontrolünü yapar. Tek katmana güvenmek, yeni bir sayfa
 * eklendiğinde unutmaya açıktır.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight">Yönetim</h1>
          <p className="text-xs text-muted">Ohaaaa işletme paneli</p>
        </div>

        <Link
          href="/"
          className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-brand/45"
        >
          Siteye dön
        </Link>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Yönetim menüsü">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            <li className="shrink-0">
              <NavLink href="/yonetim" exact>
                <ChartIcon className="h-4 w-4" />
                Genel bakış
              </NavLink>
            </li>
            <li className="shrink-0">
              <NavLink href="/yonetim/basvurular">
                <StoreIcon className="h-4 w-4" />
                Başvurular
              </NavLink>
            </li>
            <li className="shrink-0">
              <NavLink href="/yonetim/ortaklar">
                <ChainIcon className="h-4 w-4" />
                Ortaklar
              </NavLink>
            </li>
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
