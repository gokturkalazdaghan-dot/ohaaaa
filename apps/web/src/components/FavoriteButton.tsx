'use client';

import { HeartIcon } from './Icons';
import { isFavorite, toggleFavorite, useFavorites } from '@/lib/favorites';

/**
 * Favoriye ekleme düğmesi.
 *
 * Kaydedildiği andaki fiyat da saklanır: favori listesinin bir fiyat
 * karşılaştırma sitesindeki asıl değeri, kullanıcının "işaretlediğimden beri
 * ne oldu" sorusunun cevabını görmesidir.
 *
 * Sunucuda ve hidrasyondan önce liste boştur, yani düğme "eklenmemiş"
 * durumunda çizilir ve hidrasyondan sonra gerçek duruma geçer. Sunucuda
 * farklı bir şey çizmek hidrasyon uyuşmazlığı üretirdi.
 */
export function FavoriteButton({
  slug,
  title,
  imageUrl,
  priceCents,
  className = '',
}: {
  slug: string;
  title: string;
  imageUrl: string | null;
  priceCents: number | null;
  className?: string;
}) {
  const favorites = useFavorites();
  const active = isFavorite(favorites, slug);

  return (
    <button
      type="button"
      onClick={() => toggleFavorite({ slug, title, imageUrl, savedPriceCents: priceCents })}
      aria-pressed={active}
      aria-label={active ? 'Favorilerden çıkar' : 'Favorilere ekle'}
      title={active ? 'Favorilerden çıkar' : 'Favorilere ekle'}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors ${
        active
          ? 'border-brand/50 bg-brand/10 text-brand'
          : 'border-line bg-surface text-fg hover:border-brand/40'
      } ${className}`}
    >
      <HeartIcon className="h-4 w-4" filled={active} />
      {active ? 'Favorilerde' : 'Favorilere ekle'}
    </button>
  );
}
