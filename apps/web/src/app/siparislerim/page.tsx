import type { Metadata } from 'next';
import Link from 'next/link';

import { formatMoney } from '@ohaaaa/shared';

import { getCustomerOrders, type CustomerVendorOrder } from '@/data/catalog';
import { getSessionUser } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Siparişlerim',
  description: 'Verdiğiniz siparişlerin durumu ve kargo takibi.',
  alternates: { canonical: '/siparislerim' },
  // Kişiye özel içerik: arama motorunda yeri yok.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/*
 * Durum ALICININ dilinde yazılır, satıcının değil.
 *
 * Veritabanında `awaiting_vendor` var; alıcıya "satıcı onayı bekleniyor"
 * demek gerekir, çünkü alıcı için soru "benim siparişim ne durumda"dır.
 * Her satırda bir de "şimdi ne oluyor" cümlesi var: durum etiketi tek
 * başına, bekleyen kişinin aklındaki soruyu yanıtlamıyor.
 */
const STATUS_META: Record<
  CustomerVendorOrder['status'],
  { label: string; className: string; hint: string }
> = {
  awaiting_vendor: {
    label: 'Satıcı onayı bekleniyor',
    className: 'bg-warning/12 text-warning',
    hint: 'Mağaza siparişinizi henüz onaylamadı.',
  },
  accepted: {
    label: 'Onaylandı',
    className: 'bg-brand/12 text-brand',
    hint: 'Mağaza siparişinizi aldı, hazırlığa geçecek.',
  },
  preparing: {
    label: 'Hazırlanıyor',
    className: 'bg-brand/12 text-brand-soft',
    hint: 'Ürünleriniz paketleniyor.',
  },
  shipped: {
    label: 'Kargoda',
    className: 'bg-brand/12 text-brand',
    hint: 'Gönderi yola çıktı.',
  },
  delivered: {
    label: 'Teslim edildi',
    className: 'bg-success/12 text-success',
    hint: 'Teslim alındı. Artık değerlendirebilirsiniz.',
  },
  cancelled: {
    label: 'İptal edildi',
    className: 'bg-danger/12 text-danger',
    hint: 'Bu gönderi iptal edildi.',
  },
};

export default async function CustomerOrdersPage() {
  const user = await getSessionUser();

  /*
   * Giriş yapılmamışsa sipariş listesi DENENMEZ. Sorgu RLS altında boş
   * dönerdi ve ekran "hiç siparişiniz yok" derdi — oysa sorun siparişin
   * olmaması değil, oturumun olmaması. Yanlış teşhis koyan bir boş ekran,
   * kullanıcıyı siparişini kaybetti sanmaya iter.
   */
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-fg">Siparişlerim</h1>
        <div className="card mt-8 p-6">
          <p className="font-semibold text-fg">Siparişlerinizi görmek için giriş yapın</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Sipariş geçmişi hesabınıza bağlıdır. Üye olmadan verdiğiniz siparişler
            bir hesaba bağlanmadığı için burada listelenmez; onların durumunu
            sipariş numarasıyla{' '}
            <Link href="/iletisim" className="text-brand hover:underline">
              bize sorabilirsiniz
            </Link>
            .
          </p>
          <Link
            href="/giris"
            className="mt-5 inline-block rounded-xl press bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white"
          >
            Giriş yap
          </Link>
        </div>
      </div>
    );
  }

  const orders = await getCustomerOrders();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-fg">Siparişlerim</h1>
      <p className="mt-3 max-w-xl leading-relaxed text-muted">
        Farklı mağazalardan aldıklarınız tek siparişte toplanır ama{' '}
        <strong>ayrı ayrı kargolanır</strong>. Bu yüzden her mağaza aşağıda kendi
        durumu ve kendi takip numarasıyla listelenir.
      </p>

      {orders.length === 0 ? (
        <div className="card mt-8 p-6">
          <p className="font-semibold text-fg">Henüz siparişiniz yok</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Verdiğiniz siparişler burada, durumu ve kargo takibiyle birlikte
            görünecek.
          </p>
          <Link
            href="/arama"
            className="mt-5 inline-block rounded-xl border border-line px-4 py-2 text-sm font-medium transition-colors hover:border-brand/50"
          >
            Ürünlere göz at
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-6">
          {orders.map((order) => (
            <li key={order.id} className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-4">
                <div>
                  <code className="font-mono text-sm font-semibold text-fg">
                    {order.orderNumber}
                  </code>
                  <p className="mt-0.5 text-xs text-muted">{formatDate(order.createdAt)}</p>
                </div>
                <p className="text-right">
                  <span className="tabular text-lg font-bold text-fg">
                    {formatMoney(order.grandTotalCents)}
                  </span>
                  <span className="block text-xs text-muted">
                    {order.paidAt ? 'Ödendi' : 'Ödeme bekleniyor'}
                  </span>
                </p>
              </div>

              <ul className="mt-4 space-y-4">
                {order.vendorOrders.map((vo) => {
                  const status = STATUS_META[vo.status];

                  return (
                    <li key={vo.id} className="rounded-xl border border-line p-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        {vo.vendorSlug ? (
                          <Link
                            href={`/magaza/${vo.vendorSlug}`}
                            className="text-sm font-semibold text-fg hover:underline"
                          >
                            {vo.vendorName}
                          </Link>
                        ) : (
                          <span className="text-sm font-semibold text-fg">{vo.vendorName}</span>
                        )}
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-3xs font-bold uppercase ${status?.className ?? 'bg-surface-2 text-muted'}`}
                        >
                          {status?.label ?? vo.status}
                        </span>
                      </div>

                      <p className="mt-1.5 text-xs text-muted">{status?.hint}</p>

                      <ul className="mt-3 space-y-1.5">
                        {vo.items.map((item, index) => (
                          <li key={index} className="flex justify-between gap-4 text-sm">
                            <span className="min-w-0 text-muted">
                              {item.quantity}×{' '}
                              {item.productSlug ? (
                                <Link
                                  href={`/urun/${item.productSlug}`}
                                  className="text-fg hover:underline"
                                >
                                  {item.title}
                                </Link>
                              ) : (
                                <span className="text-fg">{item.title}</span>
                              )}
                            </span>
                            <span className="tabular shrink-0 text-muted">
                              {formatMoney(item.lineTotalCents)}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {vo.trackingNumber && (
                        <div className="mt-3 border-t border-line pt-3 text-xs">
                          <p className="text-muted">
                            {vo.carrierName ?? 'Kargo'} ·{' '}
                            <span className="font-mono font-medium text-fg">
                              {vo.trackingNumber}
                            </span>
                          </p>
                          {/*
                            Takip bağlantısı yalnızca firma kendi sorgu sayfasını
                            verdiyse çıkar. Olmayan bir adrese bağlantı koymak,
                            tıklayanı boş sayfaya götürür.
                          */}
                          {vo.trackingUrl && (
                            <a
                              href={vo.trackingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-block font-medium text-brand hover:underline"
                            >
                              Kargo firmasında takip et
                            </a>
                          )}
                        </div>
                      )}

                      {vo.status === 'delivered' && (
                        <Link
                          href="/degerlendirmelerim"
                          className="mt-3 inline-block rounded-xl border border-line px-3.5 py-1.5 text-xs font-medium transition-colors hover:border-brand/50"
                        >
                          Değerlendir
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
