import type { Metadata } from 'next';

import { DataUnavailable } from '@/components/DataUnavailable';
import { getCategories, getPriceDrops } from '@/data/catalog';

import { DealsView, MIN_DROP_RATIO, WINDOW_DAYS } from './DealsView';

/**
 * Fırsatlar — fiyatı düşen ürünler (madde 13, indekslenebilir fırsat sayfası).
 *
 * NEDEN AYRI BİR YOL, /arama?sirala=... DEĞİL?
 * Arama sonuç sayfaları robots.txt'de kapalı ve haritada yok: sorgu
 * varyantları sonsuzdur. Fırsat sayfaları ise sayılıdır (bir kök + kategori
 * sayısı kadar), içerikleri kararlıdır ve "fiyatı düşen telefonlar" gibi
 * gerçek aramalara karşılık gelir. Kategori sayfalarıyla aynı gerekçe.
 *
 * SAYFA SAYISI KASITLI OLARAK SINIRLI.
 * Master promptun kendi sınırı: "Google'ın spam politikalarını ihlal edecek
 * sahte/otomatik düşük kaliteli sayfalar üretme." Bu yüzden her ürün ya da
 * her marka için ayrı bir fırsat sayfası ÜRETİLMİYOR; yalnızca kök sayfa ve
 * gerçekten var olan kategoriler.
 */

/** Fiyat ölçümleri saat başı işlenir; sayfayı her istekte hesaplamaya gerek yok. */
export const revalidate = 900;

const LIMIT = 24;

export const metadata: Metadata = {
  title: 'Fiyatı Düşen Ürünler',
  description:
    'Son 30 günde kendi ölçtüğümüz fiyatlara göre gerçekten ucuzlayan ürünler. ' +
    'Mağazanın üstü çizili fiyatı kullanılmaz; düşüş bizim ölçümümüzden çıkar.',
  alternates: { canonical: '/firsatlar' },
  openGraph: {
    title: 'Fiyatı Düşen Ürünler · Ohaaaa',
    description: 'Düşüşü mağaza değil, biz ölçüyoruz. Son 30 günün gerçek fiyat düşüşleri.',
  },
};

export default async function DealsPage() {
  let drops: Awaited<ReturnType<typeof getPriceDrops>>;
  let categories: Awaited<ReturnType<typeof getCategories>>;

  try {
    [drops, categories] = await Promise.all([
      getPriceDrops({ days: WINDOW_DAYS, minDropRatio: MIN_DROP_RATIO, limit: LIMIT }),
      getCategories(),
    ]);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Fırsat sayfası veri kaynağına ulaşamadı',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return <DataUnavailable title="Fırsatları şu an gösteremiyoruz" />;
  }

  return (
    <DealsView
      drops={drops}
      categories={categories}
      activeCategory={null}
      heading="Fiyatı Düşen Ürünler"
      intro={
        'Aynı ürünü günlerce ölçüyoruz. Bu sayfada, son ' +
        WINDOW_DAYS +
        ' günde kendi ölçümlerimizde fiyatı gerçekten düşen ürünler var.'
      }
    />
  );
}
