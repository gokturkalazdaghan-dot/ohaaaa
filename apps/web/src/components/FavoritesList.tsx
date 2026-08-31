'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { formatMoney } from '@ohaaaa/shared';

import { ProductPlaceholder } from './ProductPlaceholder';
import { removeFavorite, useFavorites } from '@/lib/favorites';

interface CurrentPrice {
  slug: string;
  title: string;
  imageUrl: string | null;
  minPriceCents: number | null;
  offerCount: number;
}

/**
 * Favori listesi ve fiyat değişimi.
 *
 * Kaydedildiği andaki fiyat tarayıcıda duruyor; güncel fiyat sunucudan
 * geliyor. İkisinin farkı, bu sayfanın var olma sebebi: "işaretlediğimden
 * beri ne oldu".
 *
 * FİYAT DEĞİŞİMİ UYDURULMAZ. Kaydedilen fiyat bilinmiyorsa (eski bir kayıt,
 * fiyatsız bir ürün) karşılaştırma hiç gösterilmez — "%0 değişim" yazmak,
 * ölçmediğimiz bir şeyi ölçmüş gibi göstermek olurdu.
 */
export function FavoritesList() {
  const favorites = useFavorites();
  const [prices, setPrices] = useState<Map<string, CurrentPrice>>(new Map());
  // Hangi liste için fiyat çekildiğini tutar. "Yükleniyor" durumu bundan
  // TÜRETİLİR; efekt içinde ayrı bir bayrak set etmek fazladan bir render
  // turu üretir ve React'in "efekt içinde setState" uyarısını tetikler.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const slugKey = favorites.map((item) => item.slug).join(',');
  const loading = slugKey.length > 0 && loadedKey !== slugKey;

  useEffect(() => {
    if (!slugKey) return;

    const controller = new AbortController();

    fetch(`/api/urunler?slugler=${encodeURIComponent(slugKey)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { data: [] }))
      .then((payload: { data?: CurrentPrice[] }) => {
        setPrices(new Map((payload.data ?? []).map((item) => [item.slug, item])));
        setLoadedKey(slugKey);
      })
      .catch(() => {
        // İptal edilen istek hata değildir; yeni bir liste zaten yolda.
        if (!controller.signal.aborted) setLoadedKey(slugKey);
      });

    return () => controller.abort();
  }, [slugKey]);

  if (favorites.length === 0) {
    return (
      <div className="mt-10">
        <p className="font-semibold text-fg">Henüz favoriniz yok</p>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Ürün sayfalarındaki kalp düğmesiyle ekleyin. Eklediğiniz andaki fiyatı saklarız;
          sonra ne olduğunu burada görürsünüz.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/arama" className="text-brand underline-offset-2 hover:underline">
            Ürünlere göz atın
          </Link>
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-8 space-y-3">
      {favorites.map((item) => {
        const current = prices.get(item.slug);
        const currentPrice = current?.minPriceCents ?? null;

        // Karşılaştırma yalnızca İKİ değer de biliniyorsa yapılır.
        const change =
          item.savedPriceCents !== null && currentPrice !== null
            ? currentPrice - item.savedPriceCents
            : null;

        return (
          <li
            key={item.slug}
            className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-3"
          >
            <Link
              href={`/urun/${item.slug}`}
              className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-photo"
            >
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt="" className="h-full w-full object-contain" />
              ) : (
                <ProductPlaceholder seed={item.slug} />
              )}
            </Link>

            <div className="min-w-0 flex-1">
              <Link
                href={`/urun/${item.slug}`}
                className="clamp-2 text-sm font-semibold text-fg underline-offset-2 hover:underline"
              >
                {item.title}
              </Link>

              <p className="mt-1 text-xs text-muted">
                {item.savedPriceCents !== null && (
                  <>Eklediğinizde {formatMoney(item.savedPriceCents)}</>
                )}
                {current && current.offerCount > 0 && (
                  <> · {current.offerCount} mağaza</>
                )}
              </p>
            </div>

            <div className="shrink-0 text-right">
              {currentPrice !== null ? (
                <p className="tabular text-base font-bold text-fg">{formatMoney(currentPrice)}</p>
              ) : (
                <p className="text-xs text-subtle">{loading ? 'Yükleniyor…' : 'Fiyat yok'}</p>
              )}

              {change !== null && change !== 0 && (
                <p
                  className={`tabular text-xs font-semibold ${
                    change < 0 ? 'text-success' : 'text-danger'
                  }`}
                >
                  {change < 0 ? '↓' : '↑'} {formatMoney(Math.abs(change))}
                </p>
              )}
              {change === 0 && <p className="text-xs text-subtle">değişmedi</p>}
            </div>

            <button
              type="button"
              onClick={() => removeFavorite(item.slug)}
              aria-label={`${item.title} ürününü favorilerden çıkar`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
