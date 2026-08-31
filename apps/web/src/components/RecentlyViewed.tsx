'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { formatMoney } from '@ohaaaa/shared';

import { ProductPlaceholder } from './ProductPlaceholder';
import { clearViewed, recordView, useRecentlyViewed } from '@/lib/recentlyViewed';

/**
 * Ürün sayfasında çalışan kayıt bileşeni.
 *
 * Hiçbir şey ÇİZMEZ; tek işi ziyareti kaydetmek. Ayrı bir bileşen olmasının
 * sebebi ürün sayfasının sunucu bileşeni olması: localStorage'a yalnızca
 * tarayıcı yazabilir.
 */
export function RecordProductView({
  slug,
  title,
  imageUrl,
  priceCents,
}: {
  slug: string;
  title: string;
  imageUrl: string | null;
  priceCents: number | null;
}) {
  useEffect(() => {
    recordView({ slug, title, imageUrl, priceCents });
  }, [slug, title, imageUrl, priceCents]);

  return null;
}

/**
 * "Son gezdikleriniz" şeridi.
 *
 * Liste boşsa HİÇ ÇİZİLMEZ — boş bir başlık, ziyaretçiye sitenin eksik
 * olduğunu düşündürür.
 *
 * Sunucuda ve ilk boyamada liste boştur (veri yalnızca tarayıcıda), bu yüzden
 * şerit hidrasyondan sonra belirir. Sunucuda farklı bir şey çizmek hidrasyon
 * uyuşmazlığı üretirdi.
 */
export function RecentlyViewed({ excludeSlug }: { excludeSlug?: string }) {
  const items = useRecentlyViewed().filter((item) => item.slug !== excludeSlug);

  if (items.length === 0) return null;

  return (
    <section className="mt-16" aria-labelledby="son-gezilen">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h2 id="son-gezilen" className="text-xl font-bold tracking-tight text-fg">
          Son gezdikleriniz
        </h2>
        <button
          type="button"
          onClick={clearViewed}
          className="text-sm text-muted transition-colors hover:text-fg"
        >
          Temizle
        </button>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {items.slice(0, 6).map((item) => (
          <li key={item.slug}>
            <Link
              href={`/urun/${item.slug}`}
              className="card-link group flex h-full flex-col overflow-hidden"
            >
              <div className="aspect-square overflow-hidden bg-surface-photo">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ProductPlaceholder seed={item.slug} />
                )}
              </div>

              <div className="flex flex-1 flex-col justify-between gap-1 p-3">
                <p className="clamp-2 text-xs leading-snug text-fg">{item.title}</p>
                {item.priceCents !== null && (
                  <p className="tabular text-sm font-bold text-brand">
                    {formatMoney(item.priceCents)}
                  </p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
