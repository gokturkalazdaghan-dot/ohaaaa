import Link from 'next/link';

import { formatMoney, type SearchResult } from '@ohaaaa/shared';

export function ProductCard({ result }: { result: SearchResult }) {
  const vendor =
    result.bestVendorName && !/^örnek\b/i.test(result.bestVendorName) && result.bestVendorName !== 'Anlaşmalı satıcı'
      ? result.bestVendorName
      : null;

  return (
    <Link href={`/urun/${result.slug}`} className="block border border-line bg-surface text-left">
      <div className="aspect-4/3 bg-[#e2d6c9]">
        {result.imageUrl && !result.imageUrl.includes('images.ohaaaa.com') ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={result.imageUrl} alt="" className="h-full w-full object-contain bg-surface" />
        ) : (
          <div className="h-full w-full bg-[#e2d6c9]" aria-hidden="true" />
        )}
      </div>
      <div className="p-3">
        {result.brand && <p className="text-xs text-muted">{result.brand}</p>}
        <h3 className="mt-1 text-sm font-medium text-fg">{result.title}</h3>
        <p className="mt-2 tabular font-semibold text-fg">
          {result.minPriceCents !== null ? formatMoney(result.minPriceCents) : ''}
        </p>
        {result.offerCount > 1 && (
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
}: {
  src: string | null;
  title: string;
  brand?: string | null;
  priority?: boolean;
}) {
  if (!src) return <div className="h-full w-full bg-[#e2d6c9]" aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={brand ? `${brand} ${title}` : title} className="h-full w-full object-contain" />
  );
}

export function ProductThumb({ title: _title }: { title: string }) {
  return <div className="h-full w-full bg-[#e2d6c9]" aria-hidden="true" />;
}
