import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { t } from '@ohaaaa/shared';

import { DataUnavailable } from '@/components/DataUnavailable';
import { getCategories, getPriceDrops } from '@/data/catalog';
import { getRequestLocale } from '@/lib/locale';

import { DealsView, MIN_DROP_RATIO, WINDOW_DAYS } from '../DealsView';

/**
 * Kategori bazlı fırsat sayfası: /firsatlar/elektronik gibi.
 *
 * Sayfa kümesi katalogdaki gerçek kategorilerle SINIRLI. Uydurma bir slug
 * (/firsatlar/en-ucuz-telefonlar-2026) 404 döner; otomatik üretilmiş ince
 * içerik sayfaları açmıyoruz.
 */

export const revalidate = 900;

const LIMIT = 24;

type Props = { params: Promise<{ kategori: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kategori } = await params;
  const { contentLocale } = await getRequestLocale();

  // Metadata üretimi katalog kesintisinde sayfayı düşürmemeli: başlık
  // olmadan da sayfanın kendisi anlamlı bir hata gösterebilir.
  const categories = await getCategories().catch(() => []);
  const category = categories.find((candidate) => candidate.slug === kategori);

  if (!category) return { title: t(contentLocale, 'firsat.kategoriBulunamadi') };

  return {
    title: t(contentLocale, 'firsat.kategoriSayfaBasligi', { ad: category.name }),
    description: t(contentLocale, 'firsat.kategoriMetaAciklama', {
      ad: category.name,
      gun: WINDOW_DAYS,
    }),
    alternates: { canonical: `/firsatlar/${category.slug}` },
    openGraph: {
      title: t(contentLocale, 'firsat.kategoriOgBaslik', { ad: category.name }),
      description: t(contentLocale, 'firsat.kategoriOgAciklama', { ad: category.name }),
    },
  };
}

/**
 * Kategoriler sayılı ve kararlı; hepsini derleme anında üretmek hem hızlı
 * hem de yayın öncesi her birinin gerçekten açıldığını garanti eder.
 */
export async function generateStaticParams(): Promise<Array<{ kategori: string }>> {
  const categories = await getCategories().catch(() => []);
  return categories.map((category) => ({ kategori: category.slug }));
}

export default async function CategoryDealsPage({ params }: Props) {
  const { kategori } = await params;
  const { contentLocale, contentTag } = await getRequestLocale();

  let drops: Awaited<ReturnType<typeof getPriceDrops>>;
  let categories: Awaited<ReturnType<typeof getCategories>>;
  let category: (typeof categories)[number] | undefined;

  try {
    categories = await getCategories();
    category = categories.find((candidate) => candidate.slug === kategori);

    // Kategori GERÇEKTEN yoksa 404. Kesintide 404 vermek yanlış olurdu —
    // aşağıdaki catch onu ayırt ediyor.
    if (!category) notFound();

    drops = await getPriceDrops({
      days: WINDOW_DAYS,
      minDropRatio: MIN_DROP_RATIO,
      categoryId: category.id,
      limit: LIMIT,
    });
  } catch (error) {
    if (isNotFoundError(error)) throw error;

    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Kategori fırsat sayfası veri kaynağına ulaşamadı',
        kategori,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return <DataUnavailable title={t(contentLocale, 'firsat.gosteremiyoruz')} />;
  }

  return (
    <DealsView
      locale={contentLocale}
      contentTag={contentTag}
      drops={drops}
      categories={categories}
      activeCategory={category}
      heading={t(contentLocale, 'firsat.kategoriBaslik', { ad: category.name })}
      intro={t(contentLocale, 'firsat.kategoriGiris', { ad: category.name, gun: WINDOW_DAYS })}
    />
  );
}

/**
 * `notFound()` hata fırlatarak çalışır; genel catch onu yutarsa gerçekten
 * silinmiş bir kategori kalıcı olarak 200 dönmeye başlar.
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
