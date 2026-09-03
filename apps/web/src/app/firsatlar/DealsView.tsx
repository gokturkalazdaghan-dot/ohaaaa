import Link from 'next/link';

import { formatMoney, type Category, type PriceDrop } from '@ohaaaa/shared';

import { JsonLd } from '@/components/JsonLd';
import { PriceDropCard } from '@/components/PriceDropCard';
import { ShareButton } from '@/components/ShareButton';
import { siteUrl } from '@/lib/env';

/**
 * `/firsatlar` ve `/firsatlar/[kategori]` sayfalarının ortak gövdesi.
 *
 * İki sayfa aynı listeyi aynı kurallarla çiziyor; tek fark başlık ve
 * kategori süzgeci. Ayrı ayrı yazılsalardı biri düzeltilip diğeri
 * unutulurdu — özellikle "düşüş nereden geliyor" açıklaması gibi doğruluk
 * taşıyan metinlerde bu tehlikeli olur.
 */

/** Gözlem penceresi: kaç günlük fiyat ölçümüne bakıyoruz. */
export const WINDOW_DAYS = 30;

/** Bu orandan küçük düşüş listelenmez. %5 altı, fiyat oynamasıdır. */
export const MIN_DROP_RATIO = 0.05;

export function DealsView({
  drops,
  categories,
  activeCategory,
  heading,
  intro,
}: {
  drops: PriceDrop[];
  categories: Category[];
  activeCategory: Category | null;
  heading: string;
  intro: string;
}) {
  const enBuyuk = drops.reduce((max, drop) => Math.max(max, drop.dropRatio), 0);
  const yol = activeCategory ? `/firsatlar/${activeCategory.slug}` : '/firsatlar';

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Ana sayfa', item: siteUrl },
            { '@type': 'ListItem', position: 2, name: 'Fırsatlar', item: `${siteUrl}/firsatlar` },
            ...(activeCategory
              ? [
                  {
                    '@type': 'ListItem',
                    position: 3,
                    name: activeCategory.name,
                    item: `${siteUrl}${yol}`,
                  },
                ]
              : []),
          ],
        }}
      />

      {/*
        ItemList şeması YALNIZCA gerçekten listelenen ürünler için yazılır.
        Boş sayfada şema basmak, arama motoruna olmayan bir liste bildirmek
        olurdu. Fiyat alanı da yalnızca ölçtüğümüz güncel fiyattır;
        "indirimden önceki fiyat" gibi bir alan Google'ın yapılandırılmış veri
        politikasında doğrulanabilir olmalı, biz onu iddia etmiyoruz.
      */}
      {drops.length > 0 && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: heading,
            numberOfItems: drops.length,
            itemListElement: drops.map((drop, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              url: `${siteUrl}/urun/${drop.slug}`,
              item: {
                '@type': 'Product',
                name: drop.title,
                url: `${siteUrl}/urun/${drop.slug}`,
                offers: {
                  '@type': 'AggregateOffer',
                  priceCurrency: 'TRY',
                  lowPrice: (drop.currentPriceCents / 100).toFixed(2),
                  offerCount: drop.offerCount,
                },
              },
            })),
          }}
        />
      )}

      <nav aria-label="Sayfa yolu" className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted">
        <Link href="/" className="transition-colors hover:text-fg">
          Ana sayfa
        </Link>
        <span aria-hidden="true">/</span>
        {activeCategory ? (
          <>
            <Link href="/firsatlar" className="transition-colors hover:text-fg">
              Fırsatlar
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-fg">{activeCategory.name}</span>
          </>
        ) : (
          <span className="text-fg">Fırsatlar</span>
        )}
      </nav>

      <header>
        <h1 className="text-3xl font-bold tracking-tight text-fg">{heading}</h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted">{intro}</p>

        {/*
          Yöntemin kendisi sayfada yazıyor. Bir fırsat sayfasının en kolay
          yalanı "indirim" sözcüğüdür; okuyucunun neyi neyle karşılaştırdığımızı
          görmesi, oranın kendisinden daha değerli.
        */}
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-subtle">
          Buradaki oranlar mağazanın üstü çizili fiyatından değil, son{' '}
          {WINDOW_DAYS} günde <strong className="text-muted">bizim kendi ölçtüğümüz</strong>{' '}
          fiyatlardan çıkar. Bir ürünün listeye girmesi için en az iki ayrı
          fiyat ölçümü ve %{Math.round(MIN_DROP_RATIO * 100)} üzerinde düşüş
          gerekir.
        </p>
      </header>

      <nav aria-label="Fırsat kategorileri" className="mt-7 flex flex-wrap items-center gap-2">
        <Link
          href="/firsatlar"
          aria-current={activeCategory ? undefined : 'true'}
          className={`chip ${activeCategory ? '' : 'chip-active'}`}
        >
          Tümü
        </Link>
        {categories.map((category) => (
          <Link
            key={category.id}
            href={`/firsatlar/${category.slug}`}
            aria-current={activeCategory?.id === category.id ? 'true' : undefined}
            className={`chip ${activeCategory?.id === category.id ? 'chip-active' : ''}`}
          >
            {category.name}
          </Link>
        ))}
      </nav>

      {drops.length > 0 ? (
        <>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              <strong className="text-fg">{drops.length} üründe</strong> düşüş ölçtük
              {enBuyuk > 0 && <> — en büyüğü %{Math.round(enBuyuk * 100)}.</>}
            </p>

            {/*
              Paylaşım metni sayfadaki ÖLÇÜLMÜŞ sayılardan kurulur. Liste
              boşken düğme hiç çizilmiyor: paylaşacak bir bulgu yok.
            */}
            <ShareButton
              path={yol}
              title={heading}
              text={`${heading}: ${drops.length} üründe düşüş ölçtük${
                enBuyuk > 0 ? `, en büyüğü %${Math.round(enBuyuk * 100)}` : ''
              }`}
            />
          </div>

          <h2 className="sr-only">Fiyatı düşen ürünler</h2>
          <ul className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {drops.map((drop, index) => (
              <li key={drop.groupId}>
                <PriceDropCard drop={drop} priority={index < 4} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        /*
          BOŞ DURUM DÜRÜST OLMALI.
          Burada "şu an fırsat yok" demek yetmez; kullanıcı sayfanın bozuk
          olduğunu düşünür. Sebebi yazıyoruz: düşüş ölçmek için geçmiş fiyat
          gerekiyor ve o geçmiş henüz birikmemiş olabilir.
        */
        <section className="mt-10 rounded-2xl border border-line bg-surface-2 p-8 text-center">
          <h2 className="text-lg font-bold text-fg">
            {activeCategory
              ? `${activeCategory.name} kategorisinde şu an ölçülmüş bir düşüş yok`
              : 'Şu an ölçülmüş bir fiyat düşüşü yok'}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
            Fiyat düşüşünü ancak aynı ürünü birden fazla kez ölçtüğümüzde
            söyleyebiliriz. Yeterli ölçüm birikmeden buraya ürün koymak,
            olmayan bir indirimi varmış gibi göstermek olurdu.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/arama"
              className="rounded-xl press bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white"
            >
              Ürünleri karşılaştır
            </Link>
            <Link
              href="/fiyat-takip"
              className="rounded-xl border border-line px-5 py-2.5 text-sm font-semibold text-fg transition-colors hover:border-brand"
            >
              Fiyat takibi nasıl işliyor?
            </Link>
          </div>
        </section>
      )}

      {drops.length > 0 && (
        <p className="mt-10 text-xs leading-relaxed text-subtle">
          Fiyatlar son ölçüm anına aittir ve mağazalar tarafından her an
          değiştirilebilir. Ürün sayfasında o üründe gördüğümüz bütün fiyat
          geçmişini ve her mağazanın kargo dahil toplam maliyetini
          bulabilirsiniz. En düşük fiyat şu an{' '}
          {formatMoney(Math.min(...drops.map((drop) => drop.currentPriceCents)))}.
        </p>
      )}
    </div>
  );
}
