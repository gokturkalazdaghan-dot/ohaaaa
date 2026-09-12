import type { Metadata } from 'next';
import { ProductCard } from '@/components/ProductCard';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatMoney } from '@ohaaaa/shared';

import { DataUnavailable } from '@/components/DataUnavailable';
import { JsonLd } from '@/components/JsonLd';
import { Pagination } from '@/components/Pagination';
import { siblingsOf } from '@ohaaaa/shared';

import {
  categoryHasProducts,
  getCategories,
  searchProducts,
  type SortOption,
} from '@/data/catalog';
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

  /*
   * BOŞ KATEGORİ DİZİNE GİRMEZ.
   *
   * Kategori taksonomisi ürün gelmeden önce de var; sayfayı 404 yapmak
   * yanlış olurdu (kategori silinmedi, henüz dolmadı). Ama içinde tek ürün
   * olmayan bir sayfayı dizine vermek ince (thin) içerik üretmektir.
   * `noindex, follow`: arama motoru sayfayı dizine almaz ama içindeki
   * bağlantıları izlemeye devam eder.
   *
   * Sayım ürün aramasıyla AYNI kapsamı kullanır (kendi + alt kategoriler),
   * yoksa sayfada ürün görünürken meta "boş" diyebilirdi.
   */
  const doluMu = await categoryHasProducts(category.id).catch(() => true);

  return {
    title: page > 1 ? `${category.name} Fiyatları — sayfa ${page}` : `${category.name} Fiyatları`,
    ...(doluMu ? {} : { robots: { index: false, follow: true } }),
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

  /*
   * Hiyerarşi bağlamı. `categories` artık alt kategorileri de içeriyor
   * (eskiden yalnızca üst seviye geliyordu ve bu yüzden alt kategori
   * sayfaları 404 dönüyordu), dolayısıyla üst ve kardeşler buradan
   * çıkarılabiliyor -- ek bir sorgu gerekmeden.
   */
  const parent = category.parentId
    ? categories.find((candidate) => candidate.id === category.parentId)
    : undefined;
  const siblings = siblingsOf(categories, category);
  const children = categories.filter((candidate) => candidate.parentId === category.id);

  const cheapest = results.results
    .map((result) => result.minPriceCents)
    .filter((price): price is number => price !== null)
    .sort((a, b) => a - b)[0];

  /*
   * "Fiyatlar X'den basliyor" cumlesinin para birimi.
   *
   * Liste TEK para biriminde ise onu kullan; karisiksa hicbirini secmek
   * dogru olmaz -- en dusuk sayiyi yanlis simgeyle basmak kullaniciyi
   * yanlis yonlendirir. Karisikta `formatMoney` ham kodu yazar.
   */
  const paraBirimleri = new Set(results.results.map((result) => result.currency));
  const listeParaBirimi = paraBirimleri.size === 1 ? [...paraBirimleri][0] : undefined;

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
          /*
            ÜST KATEGORİ ARAYA GİRİYOR. Önceden yol "Ana sayfa / Bilgisayar"
            idi; oysa Bilgisayar, Elektronik'in altında. Kırıntı yolu
            hiyerarşiyi bildirmek içindir, düzleştirilince bildirdiği şey
            yanlış olur.
          */
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Ana sayfa', item: siteUrl },
            ...(parent
              ? [{
                  '@type': 'ListItem',
                  position: 2,
                  name: parent.name,
                  item: `${siteUrl}/kategori/${parent.slug}`,
                }]
              : []),
            {
              '@type': 'ListItem',
              position: parent ? 3 : 2,
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
        {parent && (
          <>
            <Link href={`/kategori/${parent.slug}`} className="transition-colors hover:text-fg">
              {parent.name}
            </Link>
            <span aria-hidden="true">/</span>
          </>
        )}
        <span className="text-fg">{category.name}</span>
      </nav>

      <header>
        {/* Anlamlı H1 (madde 1): kategori adı + niyeti karşılayan sözcük. */}
        <h1 className="text-3xl font-bold tracking-tight text-fg">
          {category.name} Fiyatları
        </h1>

        {/*
          ALT KATEGORİ ŞERİDİ.
          Üst kategori sayfası alt kategorilerinin ürünlerini de listeliyor
          (arama işlevi `parent_id` ile kapsıyor), ama kullanıcıya daralt-
          ma yolu göstermiyordu. Elektronik'te 34.249 grup var; oradan
          Bilgisayar'a inebilmek sayfanın en çok işe yarayan bağlantısı.
        */}
        {children.length > 0 && (
          <nav aria-label="Alt kategoriler" className="mt-4 flex flex-wrap gap-2">
            {children.map((child) => (
              <Link key={child.id} href={`/kategori/${child.slug}`} className="chip">
                {child.name}
              </Link>
            ))}
          </nav>
        )}

        <p className="mt-3 max-w-2xl leading-relaxed text-muted">
          {results.results.length > 0 ? (
            <>
              {category.name} kategorisinde{' '}
              <strong className="text-fg">{results.totalCount} ürünü</strong> karşılaştırıyoruz
              {totalPages > 1 && <> (sayfa {page}/{totalPages})</>}. Bu sayfada{' '}
              <strong className="text-fg">{totalOffers} mağaza teklifi</strong> var.
              {cheapest !== undefined && (
                <> Fiyatlar {formatMoney(cheapest, listeParaBirimi)}’den başlıyor.</>
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
            {results.results.map((result, index) => (
              <li key={result.groupId}>
                <ProductCard result={result} priority={index < 4} />
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

      {/*
        İÇ LİNKLEME ARTIK KARDEŞLERE.
        Önceden bütün kategoriler düz bir liste olarak basılıyordu:
        bilgisayar sayfasından kozmetiğe bağlanmak kullanıcı için de arama
        motoru için de anlamsız bir komşuluk kuruyordu. Kardeşler (aynı üst
        kategoriyi paylaşanlar) gerçek alternatiflerdir.
      */}
      {siblings.length > 0 && (
        <nav aria-label="Diğer kategoriler" className="mt-16 border-t border-line pt-8">
          <h2 className="text-sm font-semibold">
            {parent ? `${parent.name} altındaki diğer kategoriler` : 'Diğer kategoriler'}
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {siblings.map((candidate) => (
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
      )}
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
