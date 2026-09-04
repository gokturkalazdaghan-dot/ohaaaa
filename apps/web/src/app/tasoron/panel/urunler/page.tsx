import type { Metadata } from 'next';

import { discountPercent, formatMoney } from '@ohaaaa/shared';

import { demoProductGroups } from '@/data/demo';

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
  title: 'Ürünler',
  robots: { index: false, follow: false },
};

const VENDOR_ID = 'vendor-teknomarkt';

export default function VendorProductsPage() {
  // Canlı kurulumda: GET /api/v1/products (x-api-key ile) veya
  // supabase.from('products').eq('vendor_id', …)
  const products = demoProductGroups
    .flatMap((group) =>
      group.offers
        .filter((offer) => offer.vendorId === VENDOR_ID)
        .map((offer) => ({ offer, group })),
    )
    .sort((a, b) => b.offer.priceCents - a.offer.priceCents);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Ürünler</h2>
          <p className="mt-1 text-sm text-muted">
            {products.length} teklif · API üzerinden senkronize ediliyor
          </p>
        </div>

        <span className="rounded-xl border border-line bg-surface px-3.5 py-2 text-xs text-muted">
          Son senkron: 4 dakika önce
        </span>
      </header>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Ürün</th>
              <th scope="col" className="px-4 py-3 font-medium">SKU</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Fiyat</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Stok</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Rekabet</th>
              <th scope="col" className="px-4 py-3 font-medium">Durum</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {products.map(({ offer, group }) => {
              const percent = discountPercent(offer.priceCents, offer.compareAtPriceCents);

              // Bu taşeron, kanonik ürünün en ucuz teklifi mi?
              const cheapest = Math.min(...group.offers.map((o) => o.totalCostCents));
              const isCheapest = offer.totalCostCents === cheapest;
              const gapCents = offer.totalCostCents - cheapest;

              return (
                <tr key={offer.id} className="transition-colors hover:bg-surface-hover">
                  <td className="px-4 py-3">
                    <p className="line-clamp-1 font-medium">{offer.title}</p>
                    <p className="text-2xs text-subtle">{group.title}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{offer.sku}</td>
                  <td className="tabular px-4 py-3 text-right">
                    <span className="font-semibold">{formatMoney(offer.priceCents)}</span>
                    {percent !== null && (
                      <span className="ml-1.5 text-2xs text-success">%{percent}</span>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-right">
                    <span className={offer.stock <= 5 ? 'font-semibold text-warning' : ''}>
                      {offer.stock}
                    </span>
                  </td>

                  {/* Agregatörün taşerona sunduğu asıl değer: rakip konumu. */}
                  <td className="px-4 py-3 text-right">
                    {isCheapest ? (
                      <span className="rounded-lg bg-success/12 px-2 py-1 text-2xs font-semibold text-success">
                        En ucuz
                      </span>
                    ) : (
                      <span className="tabular rounded-lg bg-warning/12 px-2 py-1 text-2xs font-semibold text-warning">
                        +{formatMoney(gapCents)} pahalı
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs ${
                        offer.status === 'active' ? 'text-success' : 'text-muted'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          offer.status === 'active' ? 'bg-success' : 'bg-subtle'
                        }`}
                      />
                      {offer.status === 'active' ? 'Yayında' : 'Pasif'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="rounded-xl border border-brand/25 bg-brand/8 p-4 text-xs leading-relaxed text-brand-soft">
        <strong className="font-semibold">Rekabet sütunu</strong> aynı kanonik ürüne teklif veren
        diğer mağazalarla kargo dahil toplam maliyetinizi karşılaştırır. “En ucuz” olduğunuz
        ürünler karşılaştırma listesinde ilk sırada gösterilir.
      </p>
    </div>
  );
}
