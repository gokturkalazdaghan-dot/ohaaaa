import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatMoney } from '@ohaaaa/shared';

import { DataUnavailable } from '@/components/DataUnavailable';
import { JsonLd } from '@/components/JsonLd';
import { ProductCard } from '@/components/ProductCard';
import { getCategories, searchProducts, type SortOption } from '@/data/catalog';
import { siteUrl } from '@/lib/env';

/**
 * Kategori sayfası (madde 5 — "servis sayfaları"nın pazar yeri karşılığı).
 *
 * NEDEN /arama?kategori=X DEĞİL DE /kategori/X?
 *
 * Arama sonuç sayfaları indekslenmemelidir: sorgu varyantları sonsuzdur ve
 * tarama bütçesini tüketirler. Ama kategori sayfaları indekslenMELİdir:
 * sayıları sınırlı, içerikleri kararlı ve "elektronik fiyatları" gibi gerçek
 * aramalara karşılık geliyorlar.
 *
 * İkisi aynı URL kalıbını paylaşırsa robots.txt'de biri diğerini engeller.
 * Ayrı yol vermek bu çelişkiyi kökten çözer ve temiz URL bonusu getirir.
 */

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'offers', label: 'En çok mağaza' },
  { value: 'price_asc', label: 'Artan fiyat' },
  { value: 'price_desc', label: 'Azalan fiyat' },
];

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sirala?: string }>;
};

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const categories = await getCategories();
  const category = categories.find((candidate) => candidate.slug === slug);

  if (!category) return { title: 'Kategori bulunamadı' };

  return {
    title: `${category.name} Fiyatları`,
    description:
      `${category.name} kategorisindeki ürünleri onlarca mağazada karşılaştırın. ` +
      `Kargo dahil en iyi toplam fiyatı görün, en ucuz satıcıyı tek bakışta bulun.`,
    alternates: { canonical: `/kategori/${category.slug}` },
    openGraph: {
      title: `${category.name} Fiyatları · Ohaaaa`,
      description: `${category.name} kategorisinde mağaza fiyatlarını karşılaştırın.`,
    },
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const { sirala } = await searchParams;

  let categories: Awaited<ReturnType<typeof getCategories>>;
  let results: Awaited<ReturnType<typeof searchProducts>>;

  const sort = SORT_OPTIONS.some((option) => option.value === sirala)
    ? (sirala as SortOption)
    : 'offers';

  // Kesintide 404 vermek YANLIŞ olurdu: kategori duruyor, biz ulaşamıyoruz.
  // 404, arama motoruna sayfanın kalıcı olarak silindiğini bildirir.
  let category: (typeof categories)[number] | undefined;

  try {
    categories = await getCategories();
    category = categories.find((candidate) => candidate.slug === slug);

    if (!category) notFound();

    results = await searchProducts({ categoryId: category.id, sort, limit: 48 });
  } catch (error) {
    // notFound() bir hata fırlatarak çalışır; onu yutmamalıyız.
    if (isNotFoundError(error)) throw error;

    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Kategori sayfası veri kaynağına ulaşamadı',
        slug,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return <DataUnavailable />;
  }

  const cheapest = results
    .map((result) => result.minPriceCents)
    .filter((price): price is number => price !== null)
    .sort((a, b) => a - b)[0];

  const totalOffers = results.reduce((sum, result) => sum + result.offerCount, 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {/* Kırıntı yolu şeması — kategori hiyerarşisini arama motoruna bildirir. */}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Ana sayfa', item: siteUrl },
            {
              '@type': 'ListItem',
              position: 2,
              name: category.name,
              item: `${siteUrl}/kategori/${category.slug}`,
            },
          ],
        }}
      />

      <nav aria-label="Sayfa yolu" className="mb-6 flex items-center gap-2 text-xs text-muted">
        <Link href="/" className="transition-colors hover:text-fg">
          Ana sayfa
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-fg">{category.name}</span>
      </nav>

      <header>
        {/* Anlamlı H1 (madde 1): kategori adı + niyeti karşılayan sözcük. */}
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
          {category.name} Fiyatları
        </h1>

        <p className="mt-3 max-w-2xl leading-relaxed text-muted">
          {results.length > 0 ? (
            <>
              {category.name} kategorisinde <strong className="text-fg">{results.length} ürünü</strong>{' '}
              <strong className="text-fg">{totalOffers} mağaza teklifiyle</strong> karşılaştırıyoruz.
              {cheapest !== undefined && (
                <> Fiyatlar {formatMoney(cheapest)}’den başlıyor.</>
              )}{' '}
              Sıralama kargo dahil toplam maliyete göre yapılır.
            </>
          ) : (
            <>Bu kategoride henüz ürün yok. Yeni satıcılar eklendikçe burası dolacak.</>
          )}
        </p>
      </header>

      {results.length > 0 && (
        <>
          <nav aria-label="Sıralama" className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-xs text-subtle">Sırala:</span>
            {SORT_OPTIONS.map((option) => (
              <Link
                key={option.value}
                href={
                  option.value === 'offers'
                    ? `/kategori/${category.slug}`
                    : `/kategori/${category.slug}?sirala=${option.value}`
                }
                aria-current={sort === option.value ? 'true' : undefined}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  sort === option.value
                    ? 'border-brand bg-brand/15 text-brand-soft'
                    : 'border-line bg-surface text-muted hover:border-brand/40 hover:text-fg'
                }`}
              >
                {option.label}
              </Link>
            ))}
          </nav>

          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {results.map((result) => (
              <ProductCard key={result.groupId} result={result} />
            ))}
          </div>
        </>
      )}

      {/* İç linkleme (madde 12): kategoriler birbirine bağlanır. */}
      <nav aria-label="Diğer kategoriler" className="mt-16 border-t border-line pt-8">
        <h2 className="text-sm font-semibold">Diğer kategoriler</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {categories
            .filter((candidate) => candidate.id !== category.id)
            .map((candidate) => (
              <Link
                key={candidate.id}
                href={`/kategori/${candidate.slug}`}
                className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs text-muted transition-colors hover:border-brand/40 hover:text-fg"
              >
                {candidate.name}
              </Link>
            ))}
        </div>
      </nav>
    </div>
  );
}

/**
 * `notFound()` bir hata fırlatarak çalışır (NEXT_HTTP_ERROR_FALLBACK).
 * Genel bir catch bloğu onu yutarsa 404 yerine "veri yok" sayfası gösterilir
 * ve gerçekten silinmiş bir kategori kalıcı olarak 200 dönmeye başlar.
 */
function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_HTTP_ERROR_FALLBACK')
  );
}
