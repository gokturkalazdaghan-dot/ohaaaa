import Link from 'next/link';

import { getCategories } from '@/data/catalog';

/**
 * Üst çubuktaki kategori şeridi.
 *
 * Sunucu bileşeni: kategoriler nadiren değişir ve istemciye bir tur
 * attırmanın anlamı yok. Veri alınamazsa şerit HİÇ ÇİZİLMEZ — üst çubukta
 * boş bir çizgi bırakmak, "kategori yok" gibi görünür.
 */
export async function CategoryNav() {
  const categories = await getCategories().catch(() => []);
  if (categories.length === 0) return null;

  return (
    /*
      Etiket ana sayfadaki kategori listesinden FARKLI olmak zorunda: iki
      landmark aynı adı taşıyınca ekran okuyucu ikisini ayırt edemiyor ve
      axe bunu ihlal olarak bildiriyor ("landmark must have a unique
      aria-label"). İkisi aynı veriyi gösteriyor ama biri her sayfada duran
      menü, diğeri ana sayfanın kendi listesi.
    */
    <nav
      aria-label="Kategori menüsü"
      className="hidden border-t border-line md:block"
    >
      {/*
        Dar ekranda yatay kaydırılır, sarmalanmaz: sarmalanan bir şerit üst
        çubuğu iki üç sıra büyütür ve ilk ekranın yarısını yer.
      */}
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-1.5 sm:px-6">
        {categories.map((category) => (
          <li key={category.id} className="shrink-0">
            <Link
              href={`/kategori/${category.slug}`}
              className="block rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              {category.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
