import Link from 'next/link';

import { formatMoney, type SearchResult } from '@ohaaaa/shared';

import { localPhotoFor } from '@/data/productPhotos';

/**
 * Gorsel adresi kullanilabilir mi?
 *
 * Demo katalogu images.ohaaaa.com'a isaret eder; o alan adi yok. Kirik
 * gorsel ikonu, yer tutucudan cok daha kotu gorunur - siteyi bozuk gosterir.
 */
function usableImage(url: string | null, slug?: string | null): string | null {
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

/**
 * Gorseli olmayan urun icin yer tutucu.
 *
 * Bos bej bir dikdortgen "eksik" gorunur. Bunun yerine urunun kendi
 * kimliginden (slug) tureyen sabit bir renk ve yumusak bir desen cizilir:
 * her kart farkli ama tumu ayni paletten, yani izgara kasitli durur.
 *
 * Uydurma bir urun gorseli CIZILMEZ. Yer tutucu, urunu temsil ettigini
 * iddia etmez; yalnizca bosluğu tasarlanmis bicimde doldurur.
 */
function Placeholder({ seed }: { seed: string }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;

  // Sicak paletin icinde kal: 18-42 derece (turuncu-amber) arasi.
  // Yer tutucu, gorsel alaninin ACIK zeminiyle uyumlu kalir: kart koyu diye
  // yer tutucuyu da koyu yapmak, fotografi olan ve olmayan kartlari
  // birbirinden kopuk gosterirdi.
  const hue = 18 + (hash % 24);
  const from = `hsl(${hue} 30% 93%)`;
  const to = `hsl(${hue + 10} 26% 86%)`;

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: `linear-gradient(140deg, ${from}, ${to})` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" className="h-1/3 w-1/3 opacity-25" fill="none" stroke="currentColor">
        <path
          d="M32 6 58 19v26L32 58 6 45V19L32 6Z M6 19l26 13 26-13 M32 32v26"
          strokeWidth="2.4"
          strokeLinejoin="round"
          className="text-[#7a4b2a]"
        />
      </svg>
    </div>
  );
}

export function ProductCard({ result }: { result: SearchResult }) {
  const vendor =
    result.bestVendorName &&
    !/^örnek\b/i.test(result.bestVendorName) &&
    result.bestVendorName !== 'Anlaşmalı satıcı'
      ? result.bestVendorName
      : null;

  const image = usableImage(result.imageUrl, result.slug);

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
            loading="lazy"
            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <Placeholder seed={result.slug} />
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        {result.brand && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
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

export function ProductImage({
  src,
  title,
  brand,
  slug,
}: {
  src: string | null;
  title: string;
  brand?: string | null;
  slug?: string | null;
  priority?: boolean;
}) {
  const image = usableImage(src, slug);
  if (!image) return <Placeholder seed={title} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image}
      alt={brand ? `${brand} ${title}` : title}
      className="h-full w-full object-contain"
    />
  );
}

export function ProductThumb({ title }: { title: string }) {
  return <Placeholder seed={title} />;
}
