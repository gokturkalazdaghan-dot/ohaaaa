import type { Metadata } from 'next';

import { t } from '@ohaaaa/shared';

import { DataUnavailable } from '@/components/DataUnavailable';
import { getCategories, getPriceDrops } from '@/data/catalog';
import { getRequestLocale } from '@/lib/locale';

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

/*
 * SABİT `metadata` YERİNE `generateMetadata`.
 *
 * Sabit nesne istek başlıklarını göremez, dolayısıyla dili de göremez --
 * sayfa gövdesi İngilizceye dönerken başlık ve açıklama Türkçe kalırdı.
 * Ayrıca "son 30 gün" metne ELLE yazılmıştı: `WINDOW_DAYS` değiştiğinde
 * sayfa 15 gün ölçüp meta etiketinde 30 gün iddia edebilirdi.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { contentLocale } = await getRequestLocale();

  return {
    title: t(contentLocale, 'firsat.baslik'),
    description: t(contentLocale, 'firsat.metaAciklama', { gun: WINDOW_DAYS }),
    alternates: { canonical: '/firsatlar' },
    openGraph: {
      title: t(contentLocale, 'firsat.ogBaslik'),
      description: t(contentLocale, 'firsat.ogAciklama', { gun: WINDOW_DAYS }),
    },
  };
}

export default async function DealsPage() {
  const { contentLocale, contentTag } = await getRequestLocale();

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
    return <DataUnavailable title={t(contentLocale, 'firsat.gosteremiyoruz')} />;
  }

  return (
    <DealsView
      locale={contentLocale}
      contentTag={contentTag}
      drops={drops}
      categories={categories}
      activeCategory={null}
      heading={t(contentLocale, 'firsat.baslik')}
      intro={t(contentLocale, 'firsat.giris', { gun: WINDOW_DAYS })}
    />
  );
}
