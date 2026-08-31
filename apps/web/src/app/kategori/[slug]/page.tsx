import type { Metadata } from 'next';
import { ProductCard } from '@/components/ProductCard';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatMoney } from '@ohaaaa/shared';

import { DataUnavailable } from '@/components/DataUnavailable';
import { JsonLd } from '@/components/JsonLd';
import { Pagination } from '@/components/Pagination';
import { getCategories, searchProducts, type SortOption } from '@/data/catalog';
import { siteUrl } from '@/lib/env';

/** Sayfa basina urun. SQL tarafi 100'de sinirlar. */
const PAGE_SIZE = 24;

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
  searchParams: Promise<{ sirala?: string; sayfa?: string }>;
};

/**
 * URL'den sayfa numarasi okur.
 *
 * URL'e herkes her seyi yazabilir. Gecersiz deger sessizce 1'e duser;
 * "?sayfa=abc" bir hata sayfasi degil, ilk sayfa gostermeli.
 */
function readPage(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) return 1;
  return value;
}

export async function generateMetadata({
  params,
  searchParams,
}: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = readPage((await searchParams).sayfa);
  const categories = await getCategories();
  const category = categories.find((candidate) => candidate.slug === slug);

  if (!category) return { title: 'Kategori bulunamadı' };

  // Sayfa 2+ KENDINI kanonik gosterir. Hepsini 1. sayfaya kanonikleseydik
  // 2. sayfadaki urunler hicbir kanonik sayfada gecmez, yani dizinde
  // gorunmez olurdu.
  const canonical =
    page > 1 ? `/kategori/${category.slug}?sayfa=${page}` : `/kategori/${category.slug}`;

  return {
    title: page > 1 ? `${category.name} Fiyatları — sayfa ${page}` : `${category.name} Fiyatları`,
    description:
      `${category.name} kategorisindeki ürünleri onlarca mağazada karşılaştırın. ` +
      `Kargo dahil en iyi toplam fiyatı görün, en ucuz satıcıyı tek bakışta bulun.`,
    alternates: { canonical },
    openGraph: {
      title: `${category.name} Fiyatları · Ohaaaa`,
      description: `${category.name} kategorisinde mağaza fiyatlarını karşılaştırın.`,
    },
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const { sirala, sayfa } = await searchParams;
  const page = readPage(sayfa);

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

    results = await searchProducts({
      categoryId: category.id,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
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

  const cheapest = results.results
    .map((result) => result.minPriceCents)
    .filter((price): price is number => price !== null)
    .sort((a, b) => a - b)[0];

  const totalOffers = results.results.reduce((sum, result) => sum + result.offerCount, 0);
  const totalPages = Math.max(1, Math.ceil(results.totalCount / PAGE_SIZE));

  /** Siralamayi koruyarak sayfa degistiren bag uretir. */
  function categoryHref(changes: { sirala?: string; sayfa?: string }): string {
    const merged = { sirala: sort, sayfa: String(page), ...changes };
    const urlParams = new URLSearchParams();
    if (merged.sirala && merged.sirala !== 'offers') urlParams.set('sirala', merged.sirala);
    if (merged.sayfa && merged.sayfa !== '1') urlParams.set('sayfa', merged.sayfa);
    const qs = urlParams.toString();
    return qs ? `/kategori/${slug}?${qs}` : `/kategori/${slug}`;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
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
        <h1 className="text-3xl font-bold tracking-tight text-fg">
          {category.name} Fiyatları
        </h1>

        <p className="mt-3 max-w-2xl leading-relaxed text-muted">
          {results.results.length > 0 ? (
            <>
              {category.name} kategorisinde{' '}
              <strong className="text-fg">{results.totalCount} ürünü</strong> karşılaştırıyoruz
              {totalPages > 1 && <> (sayfa {page}/{totalPages})</>}. Bu sayfada{' '}
              <strong className="text-fg">{totalOffers} mağaza teklifi</strong> var.
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

      {results.results.length > 0 && (
        <>
          <nav aria-label="Sıralama" className="mt-6 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm font-semibold text-muted">Sırala</span>
            {SORT_OPTIONS.map((option) => (
              <Link
                key={option.value}
                href={categoryHref({ sirala: option.value, sayfa: '1' })}
                aria-current={sort === option.value ? 'true' : undefined}
                className={`chip ${sort === option.value ? 'chip-active' : ''}`}
              >
                {option.label}
              </Link>
            ))}
          </nav>

          {/*
            Kart başlıkları <h3>. Araya bir <h2> girmezse başlık düzeyi
            h1'den h3'e atlar; ekran okuyucu kullanıcısı başlıklar arasında
            gezinirken bir seviyenin kaybolduğunu görür. Başlık görsel olarak
            gizli: sayfada zaten "<kategori> Fiyatları" yazıyor, ikinci bir
            görünür başlık tekrar olurdu.
          */}
          <h2 className="sr-only">Ürünler</h2>
          <ul className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {results.results.map((result) => (
              <li key={result.groupId}>
                <ProductCard result={result} />
              </li>
            ))}
          </ul>

          <Pagination
            page={page}
            totalPages={totalPages}
            buildHref={(changes) => categoryHref({ sayfa: changes.sayfa })}
          />
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
                className="text-sm text-brand underline-offset-2 hover:underline"
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
