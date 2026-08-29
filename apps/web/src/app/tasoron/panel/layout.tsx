import Link from 'next/link';

import { NavLink } from '@/components/NavLink';
import { BoxIcon, ChartIcon, KeyIcon, StoreIcon } from '@/components/Icons';

const NAV_ITEMS = [
  { href: '/tasoron/panel', label: 'Genel bakış', icon: ChartIcon, exact: true },
  { href: '/tasoron/panel/urunler', label: 'Ürünler', icon: BoxIcon },
  { href: '/tasoron/panel/siparisler', label: 'Siparişler', icon: StoreIcon },
  { href: '/tasoron/panel/api-anahtarlari', label: 'API anahtarları', icon: KeyIcon },
];

export default function VendorPanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-brand to-electric text-lg font-black text-white">
            T
          </span>
          <div>
            <h1 className="text-xl font-black tracking-tight">Teknomarkt</h1>
            <p className="flex items-center gap-2 text-xs text-muted">
              <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[10px] font-semibold text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Onaylı taşeron
              </span>
              <span>Komisyon oranı %7</span>
            </p>
          </div>
        </div>

        <Link
          href="/tasoron/api"
          className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-brand/45"
        >
          API dokümantasyonu
        </Link>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Panel menüsü">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {NAV_ITEMS.map((item) => (
              <li key={item.href} className="shrink-0">
                <NavLink href={item.href} exact={item.exact}>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
