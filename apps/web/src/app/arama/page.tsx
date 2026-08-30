import Link from 'next/link';
import type { Metadata } from 'next';

import { DataUnavailable } from '@/components/DataUnavailable';
import { ProductCard } from '@/components/ProductCard';
import { getCategories, searchProducts, type SortOption } from '@/data/catalog';

export const revalidate = 120;

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'relevance', label: 'En uygun' },
  { value: 'price_asc', label: 'Artan fiyat' },
  { value: 'price_desc', label: 'Azalan fiyat' },
  { value: 'offers', label: 'En çok mağaza' },
];

type SearchPageProps = {
  searchParams: Promise<{ q?: string; kategori?: string; sirala?: string }>;
};

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const { q } = await searchParams;

  return {
    title: q ? `"${q}" arama sonuçları` : 'Tüm ürünler',
    description: q
      ? `${q} için tüm mağazalardaki fiyatları karşılaştırın.`
      : 'Ohaaaa’daki tüm ürünleri keşfedin ve mağazalar arası fiyatları karşılaştırın.',
    // Arama sonuç sayfaları taranmamalı: sonsuz sayıda varyantı olabilir
    // ve tarama bütçesini tüketir.
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, kategori, sirala } = await searchParams;

  // Kategoriler filtre şeridi içindir; alınamazsa arama yine de çalışmalı.
  // Bu çağrı da veri kaynağına gider ve aramadan ÖNCE patlarsa sayfayı
  // bütünüyle düşürürdü.
  const categories = await getCategories().catch(() => []);
  const activeCategory = kategori ? categories.find((c) => c.slug === kategori) : undefined;

  const sort = SORT_OPTIONS.some((option) => option.value === sirala)
    ? (sirala as SortOption)
    : 'relevance';

  let results: Awaited<ReturnType<typeof searchProducts>>;

  try {
    results = await searchProducts({
      query: q,
      categoryId: activeCategory?.id,
      sort,
      limit: 48,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Arama veri kaynağına ulaşamadı',
        query: q,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return <DataUnavailable title="Arama şu an çalışmıyor" />;
  }

  /** Mevcut filtreleri koruyarak tek parametreyi değiştiren bağlantı üretir. */
  function buildHref(changes: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    const merged = { q, kategori, sirala: sort, ...changes };

    for (const [key, value] of Object.entries(merged)) {
      if (value && !(key === 'sirala' && value === 'relevance')) {
        params.set(key, value);
      }
    }

    const queryString = params.toString();
    return queryString ? `/arama?${queryString}` : '/arama';
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-fg">
          {q ? (
            <>
              <span className="text-muted">Arama:</span> {q}
            </>
          ) : activeCategory ? (
            activeCategory.name
          ) : (
            'Tüm ürünler'
          )}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {results.length} kanonik ürün
          {results.length > 0 && (
            <> · {results.reduce((sum, r) => sum + r.offerCount, 0)} mağaza teklifi</>
          )}
        </p>
      </header>

      {/* Filtreler bağlantı olarak render edilir: JavaScript olmadan da
          çalışır, paylaşılabilir ve tarayıcı geçmişiyle uyumludur. */}
      <div className="mt-6 space-y-3">
        <nav aria-label="Kategori filtresi" className="flex flex-wrap gap-2">
          <FilterChip href={buildHref({ kategori: undefined })} active={!activeCategory}>
            Tümü
          </FilterChip>
          {categories.map((category) => (
            <FilterChip
              key={category.id}
              href={buildHref({ kategori: category.slug })}
              active={activeCategory?.id === category.id}
            >
              {category.name}
            </FilterChip>
          ))}
        </nav>

        <nav aria-label="Sıralama" className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">Sırala:</span>
          {SORT_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              href={buildHref({ sirala: option.value })}
              active={sort === option.value}
            >
              {option.label}
            </FilterChip>
          ))}
        </nav>
      </div>

      {results.length === 0 ? (
        <EmptyState query={q} />
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {results.map((result) => (
            <ProductCard key={result.groupId} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`text-sm ${
        active ? 'font-semibold text-fg' : 'text-muted hover:underline'
      }`}
    >
      {children}
    </Link>
  );
}

function EmptyState({ query }: { query?: string }) {
  return (
    <div className="mt-10 text-left">
      <p className="font-semibold text-fg">
        {query ? `"${query}" için sonuç yok` : 'Henüz ürün yok'}
      </p>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Yazımı kontrol edin veya daha genel bir terim deneyin. Türkçe karakter şart değil —
        “kulaklik” de “kulaklık” sonuçlarını getirir.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/arama" className="text-brand underline-offset-2 hover:underline">
          Tüm ürünler
        </Link>
      </p>
    </div>
  );
}
