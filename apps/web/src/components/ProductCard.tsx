import Link from 'next/link';

import { formatMoney, type SearchResult } from '@ohaaaa/shared';

function isUsableRemote(url: string | null | undefined): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (url.includes('images.ohaaaa.com')) return false;
  return true;
}

function resolvePhoto(src: string | null | undefined, slug?: string | null): string | null {
  if (isUsableRemote(src)) return src as string;
  if (slug) return `/products/${slug}.jpg`;
  return null;
}

export function ProductCard({ result }: { result: SearchResult }) {
  const vendor =
    result.bestVendorName &&
    !/^örnek\b/i.test(result.bestVendorName) &&
    result.bestVendorName !== 'Anlaşmalı satıcı'
      ? result.bestVendorName
      : null;

  const photo = resolvePhoto(result.imageUrl, result.slug);

  return (
    <Link
      href={`/urun/${result.slug}`}
      className="block border border-line bg-surface text-left"
    >
      <div className="aspect-square bg-surface">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="h-full w-full object-contain bg-surface" />
        ) : (
          <div className="h-full w-full bg-surface" aria-hidden="true" />
        )}
      </div>
      <div className="p-3">
        {result.brand && <p className="text-xs text-muted">{result.brand}</p>}
        <h3 className="mt-1 line-clamp-2 text-sm font-medium text-fg">{result.title}</h3>
        <p className="mt-2 tabular font-semibold text-brand">
          {result.minPriceCents !== null ? formatMoney(result.minPriceCents) : ''}
        </p>
        {result.offerCount > 0 && (
          <p className="mt-1 text-xs text-muted">{result.offerCount} mağaza</p>
        )}
        {vendor && <p className="mt-1 text-xs text-muted">{vendor}</p>}
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
  const photo = resolvePhoto(src, slug);
  if (!photo) return <div className="h-full w-full bg-surface" aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo}
      alt={brand ? `${brand} ${title}` : title}
      className="h-full w-full object-contain bg-surface"
    />
  );
}

export function ProductThumb({ title: _title }: { title: string }) {
  return <div className="h-full w-full bg-surface" aria-hidden="true" />;
}
