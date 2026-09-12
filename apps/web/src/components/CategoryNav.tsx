import Link from 'next/link';
import { Fragment } from 'react';

import { getCategoryTree } from '@/data/catalog';

/**
 * Üst çubuktaki kategori şeridi.
 *
 * Sunucu bileşeni: kategoriler nadiren değişir ve istemciye bir tur
 * attırmanın anlamı yok. Veri alınamazsa şerit HİÇ ÇİZİLMEZ — üst çubukta
 * boş bir çizgi bırakmak, "kategori yok" gibi görünür.
 *
 * ŞERİT ARTIK AĞAÇTAN BESLENİYOR. İki şey değişti:
 *
 *   1) ALT KATEGORİLER GÖRÜNÜR. Kataloğun neredeyse tamamı alt
 *      kategorilerde (bilgisayar 32.894, telefon 814, kulaklık 541 grup --
 *      ölçüldü) ve hiçbiri menüde yoktu.
 *
 *   2) BOŞ KATEGORİLER DÜŞTÜ. Altı üst kategorinin dördü tamamen boştu;
 *      şeritte durmaları kullanıcıyı ürünsüz bir sayfaya göndermekti.
 */
export async function CategoryNav() {
  const tree = await getCategoryTree().catch(() => []);
  if (tree.length === 0) return null;

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
        {/*
          Fırsatlar şeridin BAŞINDA duruyor ve vurgulu: fiyatı düşen ürünler
          sitenin en çok aranan girişi ve kategori listesinin içinde kaybolursa
          hiç tıklanmaz. Bir kategori değil, bu yüzden rengiyle ayrılıyor.
        */}
        <li className="shrink-0">
          <Link
            href="/firsatlar"
            className="block rounded-lg px-3 py-1.5 text-sm font-semibold text-brand transition-colors hover:bg-surface-2"
          >
            Fırsatlar
          </Link>
        </li>
        {tree.map((node) => (
          <Fragment key={node.category.id}>
            <li className="shrink-0">
              <Link
                href={`/kategori/${node.category.slug}`}
                className="block rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {node.category.name}
              </Link>
            </li>
            {/*
              Alt kategoriler üstünün HEMEN ARDINDAN ve daha soluk geliyor:
              şerit tek satır olduğu için girinti verilemiyor, hiyerarşiyi
              renk taşıyor. Ayrı bir açılır menü kurmak şeridi tıklamayla
              çalışan bir bileşene çevirirdi; tek satırlık bir menü için
              fazla ağır.
            */}
            {node.children.map((child) => (
              <li key={child.category.id} className="shrink-0">
                <Link
                  href={`/kategori/${child.category.slug}`}
                  className="block rounded-lg px-2.5 py-1.5 text-sm text-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  {child.category.name}
                </Link>
              </li>
            ))}
          </Fragment>
        ))}
      </ul>
    </nav>
  );
}
