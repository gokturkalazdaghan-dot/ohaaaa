import Link from 'next/link';

import { formatMoney } from '@ohaaaa/shared';

import { ProductCard } from '@/components/ProductCard';
import { getCategories, getFlashDeals, getVendors, searchProducts } from '@/data/catalog';

export default async function HomePage() {
  const [deals, categories, vendors, trending] = await Promise.all([
    getFlashDeals(3),
    getCategories(),
    getVendors(),
    searchProducts({ sort: 'offers', limit: 8 }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      {/* --- Giris -----------------------------------------------------------
          Onceki hali baslik + tek satir alt metinden ibaretti ve sayfanin
          ustunde bos bir serit birakiyordu. Deger onermesi ("kargo dahil")
          burada acikca soylenir; fiyat karsilastirmada asil fark budur. */}
      <section className="py-10 sm:py-14">
        <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-fg sm:text-5xl">
          Aynı ürün, <span className="text-brand">kargo dahil</span> fiyat
        </h1>
        <p className="mt-4 max-w-xl text-base text-muted sm:text-lg">
          Mağazaların kargo ve indirimlerini hesaba katıp toplam tutarı karşılaştırıyoruz.
          En düşük toplam üstte durur.
        </p>

        {categories.length > 0 && (
          <nav aria-label="Kategoriler" className="mt-7">
            <ul className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <li key={category.id}>
                  <Link href={`/kategori/${category.slug}`} className="chip">
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>

      {/* --- Firsatlar ----------------------------------------------------- */}
      {deals.length > 0 && (
        <section className="mt-2">
          <SectionHead title="Fırsat fiyatı" />
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {deals.map((deal) => {
              const off =
                deal.originalPriceCents > deal.dealPriceCents
                  ? Math.round(
                      ((deal.originalPriceCents - deal.dealPriceCents) / deal.originalPriceCents) *
                        100,
                    )
                  : null;
              return (
                <li key={deal.id}>
                  <Link
                    href={deal.groupSlug ? `/urun/${deal.groupSlug}` : '/arama'}
                    className="card-link flex h-full flex-col justify-between gap-4 p-5"
                  >
                    <p className="clamp-2 text-sm font-semibold leading-snug text-fg">
                      {deal.title}
                    </p>
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="tabular text-2xl font-extrabold leading-none text-brand">
                          {formatMoney(deal.dealPriceCents)}
                        </p>
                        {off !== null && (
                          <p className="tabular mt-1 text-xs text-subtle line-through">
                            {formatMoney(deal.originalPriceCents)}
                          </p>
                        )}
                      </div>
                      {off !== null && (
                        <span className="shrink-0 rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-[#fffaf5]">
                          %{off}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* --- Urunler -------------------------------------------------------- */}
      {trending.length > 0 && (
        <section className="mt-12">
          <SectionHead title="Çok karşılaştırılanlar" href="/arama" linkLabel="Tümü" />
          <ul className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {trending.map((result) => (
              <li key={result.groupId}>
                <ProductCard result={result} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- Magazalar ------------------------------------------------------ */}
      {vendors.length > 0 && (
        <section className="mt-12">
          <SectionHead title="Karşılaştırdığımız mağazalar" />
          <ul className="mt-4 flex flex-wrap gap-2">
            {vendors.map((vendor) => (
              <li key={vendor.id} className="chip cursor-default">
                {vendor.displayName}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionHead({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
      <h2 className="text-xl font-bold tracking-tight text-fg">{title}</h2>
      {href && linkLabel && (
        <Link href={href} className="text-sm font-semibold text-brand hover:underline">
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}
