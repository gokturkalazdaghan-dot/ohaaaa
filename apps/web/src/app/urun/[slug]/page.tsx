import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatMoney } from '@ohaaaa/shared';

import { ShieldIcon, TruckIcon } from '@/components/Icons';
import { OfferRow } from '@/components/OfferRow';
import { ProductCard, ProductThumb } from '@/components/ProductCard';
import { getProductGroup, getRelatedGroups } from '@/data/catalog';

export const revalidate = 120;

type ProductPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const group = await getProductGroup(slug);

  if (!group) return { title: 'Ürün bulunamadı' };

  const priceText =
    group.minPriceCents !== null ? ` — ${formatMoney(group.minPriceCents)}'den başlayan fiyatlarla` : '';

  return {
    title: group.title,
    description:
      `${group.title}${priceText}. ${group.offerCount} mağazadaki fiyatları karşılaştırın, ` +
      `kargo dahil en iyi toplam fiyatı görün.`,
    openGraph: { title: group.title, description: group.description ?? undefined },
    alternates: { canonical: `/urun/${group.slug}` },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const group = await getProductGroup(slug);

  if (!group) notFound();

  const related = await getRelatedGroups(slug, 4);

  // Teklifler zaten toplam maliyete göre sıralı gelir (veri katmanında).
  const bestOffer = group.offers[0];
  const savingsCents =
    group.offers.length > 1
      ? group.offers[group.offers.length - 1]!.totalCostCents - (bestOffer?.totalCostCents ?? 0)
      : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <nav aria-label="Sayfa yolu" className="mb-6 flex items-center gap-2 text-xs text-muted">
        <Link href="/" className="hover:text-fg">Ana sayfa</Link>
        <span aria-hidden="true">/</span>
        <Link href="/arama" className="hover:text-fg">Ürünler</Link>
        <span aria-hidden="true">/</span>
        <span className="truncate text-fg">{group.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Görsel ve özellikler */}
        <div className="space-y-5">
          <div className="group relative aspect-square overflow-hidden rounded-2xl border border-line bg-surface-2">
            <ProductThumb title={group.title} />
          </div>

          {Object.keys(group.attributes).length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold">Özellikler</h2>
              <dl className="mt-3 space-y-2">
                {Object.entries(group.attributes).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4 text-sm">
                    <dt className="text-muted">{key}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {/* Karşılaştırma */}
        <div>
          {group.brand && (
            <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
              {group.brand}
            </span>
          )}

          <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight sm:text-3xl">
            {group.title}
          </h1>

          {group.description && (
            <p className="mt-4 leading-relaxed text-muted">{group.description}</p>
          )}

          {/* Agregasyonun değerini tek cümlede özetleyen şerit. */}
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4">
            <div>
              <p className="text-xs text-muted">Bu ürün {group.offerCount} mağazada var</p>
              <p className="tabular mt-0.5 text-xl font-black">
                {group.minPriceCents !== null ? formatMoney(group.minPriceCents) : '—'}
                {group.maxPriceCents !== null && group.maxPriceCents !== group.minPriceCents && (
                  <span className="ml-2 text-sm font-normal text-muted">
                    – {formatMoney(group.maxPriceCents)}
                  </span>
                )}
              </p>
            </div>

            {savingsCents > 0 && (
              <div className="ml-auto rounded-xl bg-success/12 px-4 py-2.5 text-right">
                <p className="text-[11px] text-success/85">Doğru mağazayı seçerek</p>
                <p className="tabular text-lg font-black text-success">
                  {formatMoney(savingsCents)} kazanın
                </p>
              </div>
            )}
          </div>

          <div className="mt-8">
            <h2 className="text-lg font-bold">Mağaza fiyatları</h2>
            <p className="mt-1 text-xs text-muted">
              Kargo dahil toplam maliyete göre sıralanmıştır — gerçekte ödeyeceğiniz tutar.
            </p>

            <ul className="mt-5 space-y-3">
              {group.offers.map((offer, index) => (
                <OfferRow
                  key={offer.id}
                  offer={offer}
                  groupSlug={group.slug}
                  isBest={index === 0}
                />
              ))}
            </ul>

            {group.offers.length === 0 && (
              <p className="mt-4 rounded-xl border border-line bg-surface p-5 text-sm text-muted">
                Bu ürün şu anda hiçbir mağazada stokta değil.
              </p>
            )}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Guarantee
              icon={<ShieldIcon className="h-5 w-5 text-success" />}
              title="Alıcı koruması"
              description="Ürün elinize ulaşana kadar ödemeniz güvencede tutulur."
            />
            <Guarantee
              icon={<TruckIcon className="h-5 w-5 text-electric" />}
              title="Tek sepet, çoklu mağaza"
              description="Farklı mağazalardan aldıklarınızı tek ödemede birleştirin."
            />
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-20">
          <h2 className="text-xl font-black tracking-tight">Bunlara da bakın</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {related.map((result) => (
              <ProductCard key={result.groupId} result={result} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Guarantee({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-line bg-surface p-4">
      <span className="shrink-0">{icon}</span>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
      </div>
    </div>
  );
}
