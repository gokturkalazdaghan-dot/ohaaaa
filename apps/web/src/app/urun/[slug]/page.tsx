import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatMoney } from '@ohaaaa/shared';

import { DataUnavailable } from '@/components/DataUnavailable';
import { ShieldIcon, TruckIcon } from '@/components/Icons';
import { JsonLd } from '@/components/JsonLd';
import { OfferRow } from '@/components/OfferRow';
import { PriceHistory } from '@/components/PriceHistory';
import { ProductCard, ProductImage } from '@/components/ProductCard';
import { getPriceHistory, getProductGroup, getRelatedGroups } from '@/data/catalog';
import { siteUrl } from '@/lib/env';

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

  /*
   * "Ürün yok" ile "veriye ulaşamıyoruz" AYRI durumlardır ve ayrı
   * yanıtlanmalıdır: birincisi 404, ikincisi geçici bir kesinti. İkisini
   * karıştırmak, kesinti sırasında Google'a tüm kataloğun silindiğini
   * bildirmek demektir.
   */
  let group: Awaited<ReturnType<typeof getProductGroup>>;

  try {
    group = await getProductGroup(slug);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Ürün sayfası veri kaynağına ulaşamadı',
        slug,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return <DataUnavailable />;
  }

  if (!group) notFound();

  // İlgili ürünler ikincil içeriktir: alınamazsa sayfa yine de gösterilir.
  const related = await getRelatedGroups(slug, 4).catch(() => []);

  /*
   * Fiyat geçmişi ikincil bilgidir: alınamazsa ürün sayfası yine açılmalı.
   * Bu yüzden ayrı bir çağrı ve kendi catch'i var — geçmiş yüzünden ürün
   * sayfasının 500 vermesi, kullanıcıya hiçbir şey göstermemek olurdu.
   */
  const priceHistory = await getPriceHistory(group.id, 90).catch(() => []);

  // Teklifler zaten toplam maliyete göre sıralı gelir (veri katmanında).
  const bestOffer = group.offers[0];
  const savingsCents =
    group.offers.length > 1
      ? group.offers[group.offers.length - 1]!.totalCostCents - (bestOffer?.totalCostCents ?? 0)
      : 0;

  const productUrl = `${siteUrl}/urun/${group.slug}`;

  /*
   * Ürün yapılandırılmış verisi.
   *
   * Fiyat karşılaştırma siteleri için EN YÜKSEK GETİRİLİ SEO işidir:
   * `AggregateOffer` sayesinde arama sonucunda "5 satıcı · 53.499 – 56.299 TL"
   * biçiminde zengin sonuç çıkar. Rakip listelerin çoğunda bu yoktur.
   *
   * Kurallar:
   *   • Fiyatlar sayfada GÖRÜNEN fiyatlarla birebir aynı olmalı; farklı veri
   *     göstermek yapılandırılmış veri ihlalidir ve zengin sonuç kaybettirir.
   *   • Stoksuz teklifler dışarıda bırakılır; `offerCount` satılabilir olanı sayar.
   *   • priceValidUntil zorunlu değil ama önerilir: fiyatın ne zamana kadar
   *     güvenilir sayılacağını bildirir.
   */
  const sellableOffers = group.offers.filter((offer) => offer.stock > 0);

  const priceValidUntil = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${productUrl}#product`,
    name: group.title,
    description: group.description ?? undefined,
    ...(group.brand ? { brand: { '@type': 'Brand', name: group.brand } } : {}),
    ...(group.imageUrl ? { image: [group.imageUrl] } : {}),
    url: productUrl,
    ...(sellableOffers.length > 0
      ? {
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'TRY',
            lowPrice: (Math.min(...sellableOffers.map((o) => o.priceCents)) / 100).toFixed(2),
            highPrice: (Math.max(...sellableOffers.map((o) => o.priceCents)) / 100).toFixed(2),
            offerCount: sellableOffers.length,
            priceValidUntil,
            availability: 'https://schema.org/InStock',
            offers: sellableOffers.map((offer) => ({
              '@type': 'Offer',
              price: (offer.priceCents / 100).toFixed(2),
              priceCurrency: offer.currency,
              availability: 'https://schema.org/InStock',
              itemCondition:
                offer.condition === 'new'
                  ? 'https://schema.org/NewCondition'
                  : offer.condition === 'refurbished'
                    ? 'https://schema.org/RefurbishedCondition'
                    : 'https://schema.org/UsedCondition',
              seller: {
                '@type': 'Organization',
                name: offer.vendor?.displayName ?? offer.merchant?.displayName ?? 'Mağaza',
              },
              // Kargo, karşılaştırmanın merkezinde: şemada da bildirilir.
              shippingDetails: {
                '@type': 'OfferShippingDetails',
                shippingRate: {
                  '@type': 'MonetaryAmount',
                  value: (offer.shippingFeeCents / 100).toFixed(2),
                  currency: 'TRY',
                },
                deliveryTime: {
                  '@type': 'ShippingDeliveryTime',
                  transitTime: {
                    '@type': 'QuantitativeValue',
                    minValue: Math.max(1, offer.estimatedDeliveryDays - 1),
                    maxValue: offer.estimatedDeliveryDays,
                    unitCode: 'DAY',
                  },
                },
              },
            })),
          },
        }
      : {}),
  };

  /** Sayfa yolu şeması — arama sonucunda kırıntı yolu gösterir. */
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Ana sayfa', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Ürünler', item: `${siteUrl}/arama` },
      { '@type': 'ListItem', position: 3, name: group.title, item: productUrl },
    ],
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <JsonLd data={[productJsonLd, breadcrumbJsonLd]} />
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
          {/*
            Görsel zemini AÇIK: ürün fotoğrafları beyaz fonda çekilir, koyu bir
            kutunun içinde ada gibi durur. Kart ızgarasındaki çözümün aynısı.
          */}
          <div className="group relative aspect-square overflow-hidden rounded-2xl border border-line bg-surface-photo">
            <ProductImage
              src={group.imageUrl}
              slug={group.slug}
              title={group.title}
              brand={group.brand}
            />
          </div>

          {bestOffer && (
            <PriceHistory
              points={priceHistory}
              currentCents={bestOffer.priceCents}
              compareAtCents={bestOffer.compareAtPriceCents}
            />
          )}

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
