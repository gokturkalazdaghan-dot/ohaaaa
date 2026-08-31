import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DataUnavailable } from '@/components/DataUnavailable';
import { JsonLd } from '@/components/JsonLd';
import { Pagination } from '@/components/Pagination';
import { ProductCard } from '@/components/ProductCard';
import { getVendorBySlug, getVendorProducts } from '@/data/catalog';
import { siteUrl } from '@/lib/env';

/**
 * Mağaza vitrini.
 *
 * NEDEN VAR
 * Satıcı başvuru formu adaya açıkça `ohaaaa.com/magaza/<slug>` adresini
 * gösteriyordu ve o sayfa YOKTU — satıcıya kayıt anında verilen bir söz
 * karşılıksızdı. Mağazalar `slug` alanını zaten taşıyordu; eksik olan tek
 * şey sayfanın kendisiydi.
 *
 * Sayfa aynı zamanda arama motoru tarafında değer üretir: "Teknomarkt
 * fiyatları" gibi marka+mağaza aramaları sınırlı sayıda, kararlı ve gerçek
 * bir niyeti karşılayan sayfalara denk gelir.
 */

/** Sayfa başına ürün. SQL tarafı 100'de sınırlar. */
const PAGE_SIZE = 24;

type StorePageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sayfa?: string }>;
};

/** URL'den sayfa numarası okur; geçersiz değer sessizce 1'e düşer. */
function readPage(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) return 1;
  return value;
}

export async function generateMetadata({
  params,
  searchParams,
}: StorePageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = readPage((await searchParams).sayfa);

  const vendor = await getVendorBySlug(slug).catch(() => null);
  if (!vendor) return { title: 'Mağaza bulunamadı' };

  // Sayfa 2+ KENDİNİ kanonik gösterir: hepsini birinci sayfaya kanoniklesek
  // sonraki sayfalardaki ürünler hiçbir kanonik sayfada geçmezdi.
  const canonical = page > 1 ? `/magaza/${vendor.slug}?sayfa=${page}` : `/magaza/${vendor.slug}`;

  return {
    title:
      page > 1
        ? `${vendor.displayName} — sayfa ${page}`
        : `${vendor.displayName} Ürünleri ve Fiyatları`,
    description:
      `${vendor.displayName} mağazasının Ohaaaa'daki ürünleri. Kargo dahil toplam ` +
      `fiyatı diğer mağazalarla karşılaştırın.`,
    alternates: { canonical },
    openGraph: {
      title: `${vendor.displayName} · Ohaaaa`,
      description: `${vendor.displayName} ürünlerini kargo dahil fiyatla karşılaştırın.`,
    },
  };
}

export default async function StorePage({ params, searchParams }: StorePageProps) {
  const { slug } = await params;
  const page = readPage((await searchParams).sayfa);

  let vendor: Awaited<ReturnType<typeof getVendorBySlug>>;
  let products: Awaited<ReturnType<typeof getVendorProducts>>;

  try {
    vendor = await getVendorBySlug(slug);

    // Kesintide 404 vermek YANLIŞ olurdu: mağaza duruyor, biz ulaşamıyoruz.
    // 404, arama motoruna sayfanın kalıcı olarak silindiğini bildirir.
    if (!vendor) notFound();

    products = await getVendorProducts(vendor.id, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
  } catch (error) {
    if (isNotFoundError(error)) throw error;

    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Mağaza sayfası veri kaynağına ulaşamadı',
        slug,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return <DataUnavailable />;
  }

  const totalPages = Math.max(1, Math.ceil(products.totalCount / PAGE_SIZE));

  function storeHref(changes: { sayfa?: string }): string {
    const target = changes.sayfa ?? String(page);
    return target === '1' ? `/magaza/${slug}` : `/magaza/${slug}?sayfa=${target}`;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Ana sayfa', item: siteUrl },
              {
                '@type': 'ListItem',
                position: 2,
                name: vendor.displayName,
                item: `${siteUrl}/magaza/${vendor.slug}`,
              },
            ],
          },
          /*
           * Organization, LocalBusiness DEĞİL: mağazanın fiziksel bir adresi
           * olduğunu bilmiyoruz ve uydurmuyoruz. Puan da yalnızca gerçekten
           * oy varsa yazılır — sıfır oyla "5 üzerinden 0" yazmak hem yanlış
           * hem de yapılandırılmış veri ihlalidir.
           */
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            '@id': `${siteUrl}/magaza/${vendor.slug}#magaza`,
            name: vendor.displayName,
            url: `${siteUrl}/magaza/${vendor.slug}`,
            ...(vendor.description ? { description: vendor.description } : {}),
            ...(vendor.logoUrl ? { logo: vendor.logoUrl } : {}),
            ...(vendor.ratingCount > 0
              ? {
                  aggregateRating: {
                    '@type': 'AggregateRating',
                    ratingValue: vendor.rating,
                    ratingCount: vendor.ratingCount,
                  },
                }
              : {}),
          },
        ]}
      />

      <nav aria-label="Sayfa yolu" className="mb-6 flex items-center gap-2 text-xs text-muted">
        <Link href="/" className="transition-colors hover:text-fg">
          Ana sayfa
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-fg">{vendor.displayName}</span>
      </nav>

      <header className="flex flex-wrap items-start gap-5">
        <span
          aria-hidden="true"
          className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand text-2xl font-black text-[#fffaf5]"
        >
          {vendor.displayName.slice(0, 1).toLocaleUpperCase('tr')}
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
            {vendor.displayName}
          </h1>

          <p className="mt-2 text-sm text-muted">
            <strong className="text-fg">{products.totalCount}</strong> ürün
            {/* Puan yalnızca gerçekten oy varsa gösterilir. Sıfır oyla "0,0"
                yazmak, mağazayı hiç oy almamış değil KÖTÜ göstermek olurdu. */}
            {vendor.ratingCount > 0 && (
              <>
                {' · '}
                <span className="tabular">{vendor.rating.toFixed(2)}</span> puan (
                {vendor.ratingCount} değerlendirme)
              </>
            )}
          </p>

          {vendor.description && (
            <p className="mt-3 max-w-2xl leading-relaxed text-muted">{vendor.description}</p>
          )}
        </div>
      </header>

      {products.results.length === 0 ? (
        <p className="mt-10 text-muted">
          Bu mağazanın yayında ürünü yok.{' '}
          <Link href="/arama" className="text-brand underline-offset-2 hover:underline">
            Tüm ürünlere bakın
          </Link>
          .
        </p>
      ) : (
        <>
          <ul className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {products.results.map((result) => (
              <li key={result.groupId}>
                <ProductCard result={result} />
              </li>
            ))}
          </ul>

          <Pagination
            page={page}
            totalPages={totalPages}
            buildHref={(changes) => storeHref({ sayfa: changes.sayfa })}
          />
        </>
      )}

      {/* Karşılaştırma sitesinin en önemli hatırlatması: bu mağazanın fiyatı
          her zaman en iyisi değildir ve ziyaretçi bunu bilerek gezmelidir. */}
      <p className="mt-16 border-t border-line pt-6 text-sm text-muted">
        Ohaaaa satışın tarafı değildir. Ürünlerin kargo dahil toplam fiyatını diğer
        mağazalarla karşılaştırmak için ürün sayfalarına bakın.
      </p>
    </div>
  );
}

/**
 * `notFound()` bir hata fırlatarak çalışır (NEXT_HTTP_ERROR_FALLBACK).
 * Genel bir catch bloğu onu yutarsa 404 yerine "veri yok" sayfası gösterilir
 * ve gerçekten silinmiş bir mağaza kalıcı olarak 200 dönmeye başlar.
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
