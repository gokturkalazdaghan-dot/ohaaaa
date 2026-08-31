import type { Metadata } from 'next';

import { FavoritesList } from '@/components/FavoritesList';

export const metadata: Metadata = {
  title: 'Favorilerim',
  description: 'İşaretlediğiniz ürünlerin güncel fiyatlarını ve fiyat değişimini görün.',
  // Kişiye özel bir liste; taranacak bir içeriği yok.
  robots: { index: false, follow: false },
};

/**
 * Favoriler sayfası.
 *
 * İçerik tamamen istemcide (favori listesi tarayıcıda tutulur), bu yüzden
 * sunucu bileşeni yalnızca çerçeveyi çizer.
 */
export default function FavoritesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-fg">Favorilerim</h1>
        <p className="mt-1.5 text-sm text-muted">
          Liste bu tarayıcıda saklanır; hesabınıza bağlı değildir.
        </p>
      </header>

      <FavoritesList />
    </div>
  );
}
