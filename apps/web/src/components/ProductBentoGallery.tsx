/**
 * Bento galerisini GERÇEK katalog ürünleriyle besler.
 *
 * Galeri bileşeni (`ui/interactive-bento-gallery`) genel amaçlıdır ve
 * `BentoMediaItem` bekler. Bu sarmalayıcı tek işi yapar: `GalleryProduct`
 * kayıtlarını o biçime çevirmek. Çeviriyi bileşenin İÇİNE koymak onu
 * katalog şemasına bağlardı; ayrı tutmak bileşeni yeniden kullanılabilir
 * bırakıyor.
 *
 * AD NEDEN `ProductBentoGallery`: depoda ZATEN bir `ProductGallery` var ve
 * o ürün sayfasının fotoğraf şeridi (tek ürünün birden çok görseli). Bu
 * bileşen farklı bir şey yapıyor -- birden çok ÜRÜNÜ vitrinde gösteriyor.
 * Aynı adı kullanmak ikisini karıştırırdı.
 */

import type { GalleryProduct } from '@/data/catalog';
import {
  InteractiveBentoGallery,
  type BentoMediaItem,
} from '@/components/ui/interactive-bento-gallery';

/**
 * Bento ızgara yerleşimi — SABİT DESEN, rastgele değil.
 *
 * Rastgele span üretmek cazip görünüyor ama iki sorun çıkarır: her render'da
 * yerleşim değişir (sunucu ve istemci farklı üretirse hydration uyuşmazlığı)
 * ve düzen bazen çirkin çıkar. Sabit desen ölçülebilir ve tekrarlanabilir.
 *
 * Desen yedi kalem için tasarlandı; daha fazlası gelirse başa dönüyor
 * (`% uzunluk`), yani liste boyutu değişse de ızgara bozulmaz.
 */
const YERLESIM = [
  'md:col-span-2 md:row-span-4 sm:col-span-2 sm:row-span-3',
  'md:col-span-1 md:row-span-2 sm:col-span-1 sm:row-span-2',
  'md:col-span-1 md:row-span-2 sm:col-span-1 sm:row-span-2',
  'md:col-span-1 md:row-span-3 sm:col-span-1 sm:row-span-2',
  'md:col-span-1 md:row-span-3 sm:col-span-1 sm:row-span-2',
  'md:col-span-2 md:row-span-2 sm:col-span-2 sm:row-span-2',
  'md:col-span-2 md:row-span-2 sm:col-span-2 sm:row-span-2',
];

export function ProductBentoGallery({ products }: { products: GalleryProduct[] }) {
  const kalemler: BentoMediaItem[] = products.map((urun, sira) => ({
    id: urun.slug,
    // Katalogda video YOK; tip alanı bileşenin sözleşmesi gereği duruyor.
    type: 'image',
    title: urun.title,
    /*
     * AÇIKLAMA GERÇEK VERİDEN.
     *
     * Uydurma pazarlama metni yazılmıyor: marka ve kaç mağazada bulunduğu
     * ölçülmüş değerler. "En iyi", "en ucuz" gibi doğrulanmamış iddialar
     * KULLANILMIYOR -- onlar ölçmediğimiz şeyleri söylemek olurdu.
     */
    desc: [urun.brand, `${urun.offerCount} mağazada`].filter(Boolean).join(' · '),
    url: urun.imageUrl,
    span: YERLESIM[sira % YERLESIM.length] ?? YERLESIM[0] ?? '',
    href: `/urun/${urun.slug}`,
    priceCents: urun.minPriceCents,
    currency: urun.currency,
  }));

  return (
    <InteractiveBentoGallery
      mediaItems={kalemler}
      title="Vitrin"
      description="Sürükleyerek düzenleyin, büyütmek için dokunun — fiyatlar en düşük tekliftir."
    />
  );
}
