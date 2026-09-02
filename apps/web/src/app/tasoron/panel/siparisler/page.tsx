import type { Metadata } from 'next';

import { formatMoney } from '@ohaaaa/shared';

import { DataSourceNotice } from '@/components/DataSourceNotice';
import { getOwnedVendor, getSessionUser } from '@/lib/auth';
import { getCarriers } from '@/data/carriers';
import { getVendorOrders } from '@/data/vendorStats';

import { OrderActions } from './OrderActions';

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

  const [{ orders, isLive }, carriers] = await Promise.all([
    getVendorOrders(vendor?.id ?? null),
    getCarriers(),
  ]);

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
                      className={`rounded-full px-2.5 py-0.5 text-3xs font-bold uppercase ${status.className}`}
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
                  {/* Etikette "%7" sabit yaziliydi ve bu, komisyon almadigimiz
                      soylenen bir platformda saticinin gordugu tek sayiydi.
                      Oran artik satirin kendisinden okunur; sifirsa kesinti
                      satiri hic cizilmez, cunku olmayan bir kesintiyi
                      gostermek onu varmis gibi gosterir. */}
                  {order.commissionCents > 0 && (
                    <div className="flex items-baseline justify-end gap-3">
                      <dt className="text-muted">Komisyon</dt>
                      <dd className="tabular w-24 text-danger">
                        −{formatMoney(order.commissionCents)}
                      </dd>
                    </div>
                  )}
                  <div className="mt-1 flex items-baseline justify-end gap-3 border-t border-line pt-1">
                    <dt className="font-medium">Hakediş</dt>
                    <dd className="tabular w-24 text-base font-bold text-success">
                      {formatMoney(order.payoutCents)}
                    </dd>
                  </div>
                </dl>
              </div>

              {/*
                Burada iki oluk dugme vardi: "Siparisi onayla" ve "Reddet".
                Ikisi de hicbir seye bagli degildi -- type="button", olay
                yok. Siparisi ilerletmenin tek gercek yolu API anahtari
                uretip PATCH istegi yazmakti; gelistiricisi olmayan bir
                magaza gelen siparisi GORUYOR ama yerine getiremiyordu.

                "Reddet" geri konmadi: iptal, alicinin parasinin iadesi
                demektir ve tahsilat henuz gercek degil. Para yolunu
                kapatmadan iptal dugmesi koymak, alicinin parasini havada
                birakan bir dugme koymak olurdu. Iptal, odeme saglayicisi
                baglandiginda iade akisiyla birlikte gelir.
              */}
              <OrderActions
                vendorOrderId={order.id}
                status={order.status}
                carriers={carriers}
                carrier={order.carrier}
                trackingNumber={order.trackingNumber}
              />
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
