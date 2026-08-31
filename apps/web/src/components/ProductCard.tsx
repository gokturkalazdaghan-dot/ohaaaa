import { ProductPlaceholder } from './ProductPlaceholder';
import Link from 'next/link';

import { formatMoney, type SearchResult } from '@ohaaaa/shared';

import { localPhotoFor } from '@/data/productPhotos';

/**
 * Gorsel adresi kullanilabilir mi?
 *
 * Demo katalogu images.ohaaaa.com'a isaret eder; o alan adi yok. Kirik
 * gorsel ikonu, yer tutucudan cok daha kotu gorunur - siteyi bozuk gosterir.
 */
/**
 * Bir görselin gerçekten gösterilebilir olup olmadığını çözer.
 *
 * `node:fs` kullandığı için YALNIZCA SUNUCUDA çalışır. İstemci bileşenleri
 * bunu çağıramaz; onlara çözülmüş adres geçilir.
 */
export function resolveProductImage(url: string | null, slug?: string | null): string | null {
  // Uzak adres kullanilabilir mi? Demo katalogu images.ohaaaa.com'a isaret
  // eder ve o alan adi yok; kirik gorsel ikonu yer tutucudan cok daha kotu.
  if (url && /^https?:\/\//i.test(url) && !url.includes('images.ohaaaa.com')) {
    return url;
  }
  // Depoda o urunun fotografi VARSA onu kullan. Dosyanin varligi kontrol
  // edilir; "her zaman dene" yaklasimi fotografsiz her uruende kirik gorsel
  // birakirdi.
  return localPhotoFor(slug);
}

export function ProductCard({
  result,
  priority = false,
}: {
  result: SearchResult;
  /** Izgaranın ilk satırındaki kartlar için true. */
  priority?: boolean;
}) {
  const vendor =
    result.bestVendorName &&
    !/^örnek\b/i.test(result.bestVendorName) &&
    result.bestVendorName !== 'Anlaşmalı satıcı'
      ? result.bestVendorName
      : null;

  const image = resolveProductImage(result.imageUrl, result.slug);

  return (
    <Link href={`/urun/${result.slug}`} className="card-link group flex h-full flex-col overflow-hidden">
      {/*
        Görsel alanının zemini AÇIK, kartın geri kalanı koyu.
        Ürün fotoğrafları beyaz fonda çekilir; koyu bir kutunun içinde beyaz
        fonlu fotoğraf ada gibi durur. Açık zemin fotoğrafın kendi fonuyla
        birleşir ve kesik görünmez.
      */}
      <div className="aspect-4/3 overflow-hidden bg-surface-photo">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            className="h-full w-full object-contain transition-transform duration-200 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <ProductPlaceholder seed={result.slug} />
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        {result.brand && (
          <p className="text-2xs font-semibold uppercase tracking-wide text-subtle">
            {result.brand}
          </p>
        )}
        <h3 className="clamp-2 mt-1 text-sm font-semibold leading-snug text-fg">{result.title}</h3>

        <div className="mt-auto pt-3">
          {result.minPriceCents !== null && (
            <p className="tabular text-lg font-extrabold leading-none text-fg">
              {formatMoney(result.minPriceCents)}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {result.offerCount > 1 && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-fg">
                {result.offerCount} mağaza
              </span>
            )}
            {vendor && <span className="truncate">{vendor}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}

/*
 * NOT — GÖRSEL ÇİZİMİNİN TEK YERİ YUKARIDAKİ KARTTIR.
 *
 * Burada `ProductImage` ve `ProductThumb` adında iki dışa aktarım daha
 * duruyordu. İkisi de hiçbir yerden çağrılmıyor ama kartın kendi içinde
 * yaptığı işin ikinci bir kopyasıydı — ve kopyalar çoktan AYRIŞMIŞTI:
 * biri `alt`'ı başlıktan kuruyor, kart ise boş `alt` veriyor (başlık zaten
 * hemen yanında yazdığı için ekran okuyucuya iki kez söylenmesin diye).
 *
 * İki çizim yolu bir süre sonra üçüncü bir davranış üretir; kullanılmayanı
 * saklamak da "belki lazım olur" dışında bir gerekçe taşımıyordu.
 * `resolveProductImage` kalıyor: ürün sayfası galeriyi onunla kuruyor.
 */
