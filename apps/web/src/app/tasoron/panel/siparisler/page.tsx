import type { Metadata } from 'next';

import { formatMoney } from '@ohaaaa/shared';

import { DataSourceNotice } from '@/components/DataSourceNotice';
import { getOwnedVendor, getSessionUser } from '@/lib/auth';
import { getVendorOrders } from '@/data/vendorStats';

/*
 * Oturuma bağlı sayfalar ASLA önbelleğe alınmamalıdır. Next, `cookies()`
 * çağrısını görürse rotayı kendiliğinden dinamik yapar — ama demo modunda
 * Supabase istemcisi çerezlere hiç dokunmadan null döndüğü için bu sinyal
 * oluşmuyor ve sayfa statik üretiliyordu. Bir yöneticinin verisinin
 * önbellekten başkasına servis edilmesi ihtimali, açık bir bildirimle
 * kapatılacak kadar ciddidir.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Siparişler',
  robots: { index: false, follow: false },
};

const STATUS_META = {
  awaiting_vendor: { label: 'Onay bekliyor', className: 'bg-warning/12 text-warning' },
  accepted: { label: 'Onaylandı', className: 'bg-electric/12 text-electric' },
  preparing: { label: 'Hazırlanıyor', className: 'bg-brand/12 text-brand-soft' },
  shipped: { label: 'Kargoda', className: 'bg-cyan/12 text-cyan' },
  delivered: { label: 'Teslim edildi', className: 'bg-success/12 text-success' },
} as const;

export default async function VendorOrdersPage() {
  const user = await getSessionUser();
  const vendor = user ? await getOwnedVendor(user.id) : null;

  const { orders, isLive } = await getVendorOrders(vendor?.id ?? null);

  return (
    <div className="space-y-5">
      <DataSourceNotice isLive={isLive} vendorStatus={vendor?.status ?? null} />

      <header>
        <h2 className="text-lg font-bold">Siparişler</h2>
        <p className="mt-1 text-sm text-muted">
          Yalnızca size düşen kalemler gösterilir. Müşterinin diğer mağazalardan aldığı
          ürünler görünmez.
        </p>
      </header>

      <ul className="space-y-3">
        {orders.map((order) => {
          const status = STATUS_META[order.status];

          return (
            <li key={order.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-sm font-semibold">{order.orderNumber}</code>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-muted">
                    {order.customerCity} · {formatDateTime(order.createdAt)} ·{' '}
                    {order.itemCount} kalem
                  </p>

                  <ul className="mt-3 space-y-1">
                    {order.items.map((item, index) => (
                      <li key={index} className="text-xs text-muted">
                        {item.quantity}× {item.title}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Taşeronun asıl ilgilendiği sayı hakediştir; ciro ve
                    komisyon onu doğrulayan ara adımlardır. */}
                <dl className="shrink-0 text-right text-xs">
                  <div className="flex items-baseline justify-end gap-3">
                    <dt className="text-muted">Ciro</dt>
                    <dd className="tabular w-24 font-medium">
                      {formatMoney(order.itemsSubtotalCents)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-end gap-3">
                    <dt className="text-muted">Komisyon %7</dt>
                    <dd className="tabular w-24 text-danger">
                      −{formatMoney(order.commissionCents)}
                    </dd>
                  </div>
                  <div className="mt-1 flex items-baseline justify-end gap-3 border-t border-line pt-1">
                    <dt className="font-medium">Hakediş</dt>
                    <dd className="tabular w-24 text-base font-bold text-success">
                      {formatMoney(order.payoutCents)}
                    </dd>
                  </div>
                </dl>
              </div>

              {order.status === 'awaiting_vendor' && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                  <button
                    type="button"
                    className="rounded-xl bg-gradient-to-r from-brand to-electric px-4 py-2 text-xs font-semibold text-white transition-transform hover:scale-[1.03]"
                  >
                    Siparişi onayla
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-line px-4 py-2 text-xs font-medium text-muted transition-colors hover:text-fg"
                  >
                    Reddet
                  </button>
                  <p className="ml-auto self-center text-[11px] text-subtle">
                    API: <code className="font-mono">PATCH /api/v1/orders/{'{id}'}</code>
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
