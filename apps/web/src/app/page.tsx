import Link from 'next/link';

import { formatMoney } from '@ohaaaa/shared';

import { getCategories, getFlashDeals, getVendors, searchProducts } from '@/data/catalog';

export default async function HomePage() {
  const [deals, categories, vendors, trending] = await Promise.all([
    getFlashDeals(3),
    getCategories(),
    getVendors(),
    searchProducts({ sort: 'offers', limit: 8 }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <section className="max-w-xl text-left">
        <h1 className="text-3xl font-bold tracking-tight text-fg">
          Aynı ürün, kargo dahil fiyat
        </h1>
        <p className="mt-2 text-muted">En düşük toplam tutar üstte durur.</p>
      </section>

      {categories.length > 0 && (
        <nav aria-label="Kategoriler" className="mt-8 text-left">
          <p className="text-sm font-semibold text-fg">Kategoriler</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {categories.map((category) => (
              <li key={category.id}>
                <Link href={`/kategori/${category.slug}`} className="text-sm text-brand underline-offset-2 hover:underline">
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {deals.length > 0 && (
        <section className="mt-10 text-left">
          <h2 className="text-lg font-semibold">Fırsat fiyatı</h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {deals.map((deal) => (
              <li key={deal.id} className="flex items-baseline justify-between gap-4 py-3">
                <Link href={deal.groupSlug ? `/urun/${deal.groupSlug}` : '/arama'} className="min-w-0 truncate text-fg hover:underline">
                  {deal.title}
                </Link>
                <span className="shrink-0 tabular font-semibold text-brand">
                  {formatMoney(deal.dealPriceCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trending.length > 0 && (
        <section className="mt-10 text-left">
          <h2 className="text-lg font-semibold">
            Ürünler{' '}
            <Link href="/arama" className="text-sm font-normal text-brand hover:underline">
              tümü
            </Link>
          </h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {trending.map((result) => (
              <li key={result.groupId} className="py-3">
                <Link href={`/urun/${result.slug}`} className="text-fg hover:underline">
                  {result.title}
                </Link>
                {result.minPriceCents !== null && (
                  <p className="mt-1 tabular text-sm font-semibold text-brand">
                    {formatMoney(result.minPriceCents)}
                    {result.offerCount > 1 ? (
                      <span className="ml-2 font-normal text-muted">{result.offerCount} mağaza</span>
                    ) : null}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {vendors.length > 0 && (
        <section className="mt-10 text-left">
          <h2 className="text-lg font-semibold">Mağazalar</h2>
          <p className="mt-2 text-sm text-muted">
            {vendors.map((vendor) => vendor.displayName).join(' · ')}
          </p>
        </section>
      )}
    </div>
  );
}
