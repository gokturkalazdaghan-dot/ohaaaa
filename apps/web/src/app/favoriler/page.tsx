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
 * Listeyi hangi deponun beslediğine sağlayıcı karar verir: giriş yapılmışsa
 * hesap, değilse tarayıcı. Sunucu bileşeni yalnızca çerçeveyi çizer.
 */
export default function FavoritesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-fg">Favorilerim</h1>
        <p className="mt-1.5 text-sm text-muted">
          Giriş yaptığınızda liste hesabınıza kaydedilir ve diğer
          cihazlarınızda da görünür. Girmeden işaretlediğiniz ürünler,
          giriş yaptığınızda hesabınıza taşınır.
        </p>
      </header>

      <FavoritesList />
    </div>
  );
}
