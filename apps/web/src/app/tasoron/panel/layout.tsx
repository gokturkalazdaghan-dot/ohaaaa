import Link from 'next/link';

import { NavLink } from '@/components/NavLink';
import { BoxIcon, ChartIcon, KeyIcon, StoreIcon } from '@/components/Icons';
import { getOwnedVendor, getSessionUser } from '@/lib/auth';

const NAV_ITEMS = [
  { href: '/tasoron/panel', label: 'Genel bakış', icon: ChartIcon, exact: true },
  { href: '/tasoron/panel/urunler', label: 'Ürünler', icon: BoxIcon },
  { href: '/tasoron/panel/siparisler', label: 'Siparişler', icon: StoreIcon },
  { href: '/tasoron/panel/api-anahtarlari', label: 'API anahtarları', icon: KeyIcon },
];

export default async function VendorPanelLayout({ children }: { children: React.ReactNode }) {
  // Oturum yoksa middleware zaten /giris'e yönlendirir; buraya yalnızca
  // demo modunda (Supabase yapılandırılmamışken) oturumsuz gelinebilir.
  const user = await getSessionUser();
  const vendor = user ? await getOwnedVendor(user.id) : null;

  const displayName = vendor?.displayName ?? 'Teknomarkt';
  const commissionPercent = vendor ? (vendor.commissionRate * 100).toFixed(0) : '7';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl press bg-brand-cta text-lg font-black text-white">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="text-xl font-black tracking-tight">{displayName}</h1>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <VendorStatusBadge status={vendor?.status ?? 'approved'} />
              <span>Komisyon oranı %{commissionPercent}</span>
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

/**
 * Taşeron durum rozeti.
 *
 * "Onaylı" ifadesini sabit yazmak, onay bekleyen bir satıcıya onaylandığını
 * söylerdi — panelin en yanıltıcı hatası bu olurdu.
 */
function VendorStatusBadge({
  status,
}: {
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
}) {
  const meta = {
    approved: { label: 'Onaylı satıcı', className: 'bg-success/12 text-success', dot: 'bg-success' },
    pending: { label: 'Onay bekliyor', className: 'bg-warning/12 text-warning', dot: 'bg-warning' },
    rejected: { label: 'Başvuru reddedildi', className: 'bg-danger/12 text-danger', dot: 'bg-danger' },
    suspended: { label: 'Askıya alındı', className: 'bg-danger/12 text-danger', dot: 'bg-danger' },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-3xs font-semibold ${meta.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
