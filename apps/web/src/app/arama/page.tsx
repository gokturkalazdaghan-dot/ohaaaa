import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { formatMoney } from '@ohaaaa/shared';

import { DataUnavailable } from '@/components/DataUnavailable';
import { Pagination } from '@/components/Pagination';
import { ProductCard } from '@/components/ProductCard';
import {
  findGroupByGtin,
  getSearchFacets,
  searchProducts,
  type SearchFacets,
  type SortOption,
} from '@/data/catalog';

export const revalidate = 120;

/** Sayfa basina sonuc. SQL tarafi 100'de sinirlar; bunun altinda kalinmali. */
const PAGE_SIZE = 24;

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'relevance', label: 'En uygun' },
  { value: 'price_asc', label: 'Artan fiyat' },
  { value: 'price_desc', label: 'Azalan fiyat' },
  { value: 'offers', label: 'En çok mağaza' },
];

type SearchPageProps = {
  searchParams: Promise<{
    q?: string;
    kategori?: string;
    sirala?: string;
    min?: string;
    max?: string;
    sayfa?: string;
    barkod?: string;
  }>;
};

/**
 * Barkod biçimi doğrulaması.
 *
 * EAN-8, UPC-E, UPC-A, EAN-13 ve ITF-14: hepsi yalnızca rakamdır ve 8-14
 * hane arasındadır. Biçim tutmuyorsa veritabanına hiç gidilmez — URL'e
 * herkes her şeyi yazabilir.
 */
function readGtin(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^[0-9]{8,14}$/.test(trimmed) ? trimmed : null;
}

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

/**
 * Kullanicidan gelen sayiyi guvenle okur.
 *
 * URL'deki her sey metindir ve herkes tarafindan yazilabilir. Negatif,
 * ondalikli, harf iceren ya da absurt buyuklukteki degerler sessizce
 * yok sayilir - filtreyi bozup bos sonuc uretmeleri yerine.
 */
function readPositiveInt(raw: string | undefined, max: number): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > max) {
    return undefined;
  }
  return value;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const { q, kategori, sirala } = params;

  /*
   * Barkod yolu.
   *
   * Kameradan okunan barkod metin aramasına ÇEVRİLMEZ: barkod kesin bir
   * kimliktir, bulanık eşleşmeye sokmak yanlış ürünü öne çıkarabilir.
   * Tam eşleşme bulunursa doğrudan ürün sayfasına gidilir — kullanıcı
   * telefonu kutuya tutup tek sonucu gördüğünde bir adım daha atmamalı.
   */
  const gtin = readGtin(params.barkod);
  let barcodeMiss: string | null = null;

  if (gtin) {
    // Barkod araması başarısız olursa sayfa DÜŞMEZ: metin aramasına devam
    // edilir ve kullanıcıya barkodun bulunamadığı söylenir.
    const match = await findGroupByGtin(gtin).catch(() => null);
    if (match) redirect(`/urun/${match.slug}`);
    barcodeMiss = gtin;
  }

  const sort = SORT_OPTIONS.some((option) => option.value === sirala)
    ? (sirala as SortOption)
    : 'relevance';

  // Fiyatlar arayuzde TL, veritabaninda kurustur. Donusum tek yerde yapilir.
  const minTl = readPositiveInt(params.min, 100_000_000);
  const maxTl = readPositiveInt(params.max, 100_000_000);

  // Ters cevrilmis aralik ("en az 500, en fazla 100") kullanicinin hatasidir,
  // hata sayfasi degil: duzeltip devam ediyoruz.
  const [lowTl, highTl] =
    minTl !== undefined && maxTl !== undefined && minTl > maxTl ? [maxTl, minTl] : [minTl, maxTl];

  const page = Math.max(1, readPositiveInt(params.sayfa, 10_000) ?? 1);

  // Filtre seridi ikincildir: alinamazsa arama yine calismali. Bu yuzden
  // aramadan ayri ve hata firlatmayan bir cagri.
  const facets: SearchFacets = await getSearchFacets({ query: q, categoryId: undefined }).catch(
    () => ({ minPriceCents: null, maxPriceCents: null, categories: [] }),
  );

  const activeCategory = kategori ? facets.categories.find((c) => c.slug === kategori) : undefined;

  let results: Awaited<ReturnType<typeof searchProducts>>;

  try {
    results = await searchProducts({
      query: q,
      categoryId: activeCategory?.id,
      minPriceCents: lowTl === undefined ? undefined : lowTl * 100,
      maxPriceCents: highTl === undefined ? undefined : highTl * 100,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
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

  const totalPages = Math.max(1, Math.ceil(results.totalCount / PAGE_SIZE));

  /** Mevcut filtreleri koruyarak tek parametreyi değiştiren bağlantı üretir. */
  function buildHref(changes: Record<string, string | undefined>): string {
    const urlParams = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q,
      kategori,
      sirala: sort,
      min: lowTl === undefined ? undefined : String(lowTl),
      max: highTl === undefined ? undefined : String(highTl),
      // Filtre degisince ilk sayfaya donulur: 7. sayfada duran biri filtreyi
      // daraltinca bos ekranla karsilasmamali.
      sayfa: undefined,
      ...changes,
    };

    for (const [key, value] of Object.entries(merged)) {
      if (value && !(key === 'sirala' && value === 'relevance') && !(key === 'sayfa' && value === '1')) {
        urlParams.set(key, value);
      }
    }

    const queryString = urlParams.toString();
    return queryString ? `/arama?${queryString}` : '/arama';
  }

  const hasPriceFilter = lowTl !== undefined || highTl !== undefined;

  // Kapalı panelin üstünde kaç filtre uygulandığı yazar: kullanıcı paneli
  // açmadan da sonuçların daraltılmış olduğunu bilmeli.
  const activeFilterCount = (activeCategory ? 1 : 0) + (hasPriceFilter ? 1 : 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {/* Barkod okundu ama katalogda yok: sessizce boş sonuç göstermek
          kullanıcıya aramanın bozuk olduğunu düşündürürdü. */}
      {barcodeMiss && (
        <p
          role="status"
          className="mb-6 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted"
        >
          <strong className="text-fg">{barcodeMiss}</strong> barkodlu ürün henüz katalogda
          yok. Ürün adını yazarak arayabilirsiniz.
        </p>
      )}

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
          {results.totalCount} kanonik ürün
          {results.results.length > 0 && (
            <> · {results.results.reduce((sum, r) => sum + r.offerCount, 0)} mağaza teklifi bu sayfada</>
          )}
          {totalPages > 1 && (
            <>
              {' '}
              · sayfa {page}/{totalPages}
            </>
          )}
        </p>
      </header>

      <div className="mt-8 gap-8 lg:grid lg:grid-cols-[220px_1fr]">
        {/* --- Filtre rayi -------------------------------------------------
            Filtreler bağlantı ve <form method="get"> olarak render edilir:
            JavaScript olmadan da çalışır, paylaşılabilir ve tarayıcı
            geçmişiyle uyumludur. */}
        <aside>
          {/*
            MOBİLDE FİLTRELER KAPALI BAŞLAR.
            Açık bıraktığımızda kategori listesi ve fiyat kutuları ilk ekranın
            tamamını kaplıyordu; kullanıcı tek bir ürün görmeden önce
            kaydırmak zorunda kalıyordu. Oysa arama sonucuna gelen kişinin
            ilk isteği ürünleri görmek, filtrelemek değil.

            `<details>` seçildi, JavaScript'li bir açılır panel değil: filtreler
            zaten bağlantı ve GET formu olarak çalışıyor, açma/kapama da
            JavaScript'siz çalışsın. Masaüstünde ayrı bir panel çizilir
            (aşağıda) ve orada açma/kapama diye bir şey yoktur.
          */}
          <details className="lg:hidden">
            <summary className="flex cursor-pointer items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-fg marker:content-none [&::-webkit-details-marker]:hidden">
              <span>Filtrele{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
              <span aria-hidden="true" className="text-muted">
                ▾
              </span>
            </summary>

            <div className="mt-4 space-y-8">
              <FilterPanel
                idPrefix="mobil"
                facets={facets}
                activeCategoryId={activeCategory?.id}
                kategori={kategori}
                q={q}
                sort={sort}
                minTl={lowTl}
                maxTl={highTl}
                buildHref={buildHref}
                hasPriceFilter={hasPriceFilter}
              />
            </div>
          </details>

          <div className="hidden space-y-8 lg:block">
            <FilterPanel
              idPrefix="masaustu"
              facets={facets}
              activeCategoryId={activeCategory?.id}
              kategori={kategori}
              q={q}
              sort={sort}
              minTl={lowTl}
              maxTl={highTl}
              buildHref={buildHref}
              hasPriceFilter={hasPriceFilter}
            />
          </div>
        </aside>

        <div>
          {/*
            Sıralama seçenekleri dar ekranda SARMAK yerine yatay kayar.
            Sarınca son seçenek tek başına ikinci satıra düşüyor ve şerit
            dağınık görünüyordu; kaydırılabilir tek satır, pazar yerlerinin
            kullandığı ve parmakla en rahat kullanılan biçim.

            `-mx-4 px-4` şeridin kenarlara kadar kaymasını sağlar: kesilen
            bir seçenek, kaydırılabileceğinin en iyi işaretidir.
          */}
          <nav
            aria-label="Sıralama"
            className="-mx-4 flex items-center gap-3 overflow-x-auto whitespace-nowrap border-b border-line px-4 pb-3 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            <span className="shrink-0 text-xs text-subtle">Sırala:</span>
            {SORT_OPTIONS.map((option) => (
              <Link
                key={option.value}
                href={buildHref({ sirala: option.value })}
                aria-current={sort === option.value ? 'true' : undefined}
                className={`shrink-0 text-sm ${
                  sort === option.value ? 'font-semibold text-fg' : 'text-muted hover:underline'
                }`}
              >
                {option.label}
              </Link>
            ))}
          </nav>

          {results.results.length === 0 ? (
            <EmptyState query={q} filtered={hasPriceFilter || Boolean(activeCategory)} />
          ) : (
            <>
              <ul className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
                {results.results.map((result) => (
                  <li key={result.groupId}>
                    <ProductCard result={result} />
                  </li>
                ))}
              </ul>

              <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Filtre gövdesi.
 *
 * Aynı içerik iki kez çizilir: mobilde açılır panelin içinde, masaüstünde
 * sabit rayda. Alan kimlikleri `idPrefix` ile ayrılır — aynı `id` iki kez
 * geçerse `<label for>` bağlantısı bozulur ve ekran okuyucu yanlış alanı
 * okur.
 */
function FilterPanel({
  idPrefix,
  facets,
  activeCategoryId,
  kategori,
  q,
  sort,
  minTl,
  maxTl,
  buildHref,
  hasPriceFilter,
}: {
  idPrefix: string;
  facets: SearchFacets;
  activeCategoryId?: string;
  kategori?: string;
  q?: string;
  sort: SortOption;
  minTl?: number;
  maxTl?: number;
  buildHref: (changes: Record<string, string | undefined>) => string;
  hasPriceFilter: boolean;
}) {
  return (
    <>
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Kategori</h2>
        <nav aria-label="Kategori filtresi" className="mt-3 space-y-1.5">
          <FilterRow href={buildHref({ kategori: undefined })} active={!activeCategoryId}>
            Tümü
          </FilterRow>
          {facets.categories
            .filter((category) => category.count > 0 || category.slug === kategori)
            .map((category) => (
              <FilterRow
                key={category.id}
                href={buildHref({ kategori: category.slug })}
                active={activeCategoryId === category.id}
                count={category.count}
              >
                {category.name}
              </FilterRow>
            ))}
        </nav>
      </section>

      <PriceFilter
        idPrefix={idPrefix}
        facets={facets}
        q={q}
        kategori={kategori}
        sort={sort}
        minTl={minTl}
        maxTl={maxTl}
        clearHref={buildHref({ min: undefined, max: undefined })}
        active={hasPriceFilter}
      />
    </>
  );
}

function FilterRow({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
        active ? 'bg-surface-2 font-semibold text-fg' : 'text-muted hover:bg-surface hover:text-fg'
      }`}
    >
      <span>{children}</span>
      {count !== undefined && <span className="tabular text-xs text-subtle">{count}</span>}
    </Link>
  );
}

/**
 * Fiyat araligi.
 *
 * Sinirlar katalogdan gelir, uydurulmaz: "0 - 100.000 TL" gibi temsili bir
 * aralik kullaniciyi hicbir sonuc olmayan bolgeye goturur. Sinir yoksa
 * (katalog bos) filtre hic gosterilmez - calismayan bir kontrol, olmayan
 * kontrolden kotudur.
 */
function PriceFilter({
  idPrefix,
  facets,
  q,
  kategori,
  sort,
  minTl,
  maxTl,
  clearHref,
  active,
}: {
  idPrefix: string;
  facets: SearchFacets;
  q?: string;
  kategori?: string;
  sort: SortOption;
  minTl?: number;
  maxTl?: number;
  clearHref: string;
  active: boolean;
}) {
  if (facets.minPriceCents === null || facets.maxPriceCents === null) return null;

  const floorTl = Math.floor(facets.minPriceCents / 100);
  const ceilTl = Math.ceil(facets.maxPriceCents / 100);

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Fiyat</h2>
      <p className="mt-2 text-xs text-subtle">
        {formatMoney(facets.minPriceCents)} – {formatMoney(facets.maxPriceCents)}
      </p>

      {/* GET formu: JavaScript gerektirmez, sonuc paylasilabilir bir URL olur. */}
      <form action="/arama" method="get" className="mt-3 space-y-2">
        {q && <input type="hidden" name="q" value={q} />}
        {kategori && <input type="hidden" name="kategori" value={kategori} />}
        {sort !== 'relevance' && <input type="hidden" name="sirala" value={sort} />}

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`${idPrefix}-fiyat-min`}>
            En az fiyat (TL)
          </label>
          <input
            id={`${idPrefix}-fiyat-min`}
            name="min"
            type="number"
            inputMode="numeric"
            min={0}
            max={ceilTl}
            step={1}
            placeholder={String(floorTl)}
            defaultValue={minTl ?? ''}
            className="w-full min-w-0 rounded-lg border border-line bg-bg-elevated px-2.5 py-2 text-sm text-fg outline-none placeholder:text-subtle focus:border-brand/50"
          />
          <span aria-hidden="true" className="text-subtle">
            –
          </span>
          <label className="sr-only" htmlFor={`${idPrefix}-fiyat-max`}>
            En fazla fiyat (TL)
          </label>
          <input
            id={`${idPrefix}-fiyat-max`}
            name="max"
            type="number"
            inputMode="numeric"
            min={0}
            max={ceilTl}
            step={1}
            placeholder={String(ceilTl)}
            defaultValue={maxTl ?? ''}
            className="w-full min-w-0 rounded-lg border border-line bg-bg-elevated px-2.5 py-2 text-sm text-fg outline-none placeholder:text-subtle focus:border-brand/50"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-[#fffaf5] transition-colors hover:bg-brand-strong"
          >
            Uygula
          </button>
          {active && (
            <Link href={clearHref} className="text-sm text-muted hover:text-fg">
              Temizle
            </Link>
          )}
        </div>
      </form>
    </section>
  );
}

function EmptyState({ query, filtered }: { query?: string; filtered: boolean }) {
  return (
    <div className="mt-10 text-left">
      <p className="font-semibold text-fg">
        {query ? `"${query}" için sonuç yok` : filtered ? 'Bu filtrelerle sonuç yok' : 'Henüz ürün yok'}
      </p>
      <p className="mt-2 max-w-xl text-sm text-muted">
        {filtered
          ? 'Fiyat aralığını genişletin ya da kategori seçimini kaldırın.'
          : 'Yazımı kontrol edin veya daha genel bir terim deneyin. Türkçe karakter şart değil — “kulaklik” de “kulaklık” sonuçlarını getirir.'}
      </p>
      <p className="mt-4 text-sm">
        <Link href="/arama" className="text-brand underline-offset-2 hover:underline">
          Tüm ürünler
        </Link>
      </p>
    </div>
  );
}
