'use client';

import { useState } from 'react';

import { discountPercent, formatMoney, type Offer } from '@ohaaaa/shared';

import { CartIcon, CheckIcon, StarIcon, TruckIcon } from './Icons';
import { useCart } from '@/store/cart';

/**
 * Karşılaştırma tablosunun tek satırı.
 *
 * Sıralama ölçütü ÜRÜN FİYATI DEĞİL, kargo dahil TOPLAM MALİYETTİR.
 * Kullanıcının gerçekte ödeyeceği tutar budur; "en ucuz" etiketini ürün
 * fiyatına göre vermek yanıltıcı olurdu (kargoyla birlikte sıra değişebilir).
 */
export function OfferRow({
  offer,
  groupSlug,
  isBest,
}: {
  offer: Offer;
  groupSlug: string;
  isBest: boolean;
}) {
  const add = useCart((state) => state.add);
  const [added, setAdded] = useState(false);

  const percent = discountPercent(offer.priceCents, offer.compareAtPriceCents);
  const lowStock = offer.stock > 0 && offer.stock <= 5;

  function handleAdd() {
    add({
      productId: offer.id,
      groupSlug,
      title: offer.title,
      imageUrl: offer.imageUrls[0] ?? null,
      priceCents: offer.priceCents,
      quantity: 1,
      vendorId: offer.vendorId,
      vendorName: offer.vendor?.displayName ?? 'Mağaza',
      vendorSlug: offer.vendor?.slug ?? '',
      shippingFeeCents: offer.shippingFeeCents,
      freeShippingThresholdCents: offer.freeShippingThresholdCents,
      estimatedDeliveryDays: offer.estimatedDeliveryDays,
      maxStock: offer.stock,
    });

    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <li
      className={`relative flex flex-col gap-4 rounded-2xl border p-4 transition-colors sm:flex-row sm:items-center ${
        isBest
          ? 'border-success/45 bg-success/[0.06]'
          : 'border-line bg-surface hover:border-brand/35'
      }`}
    >
      {isBest && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-success px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          En iyi toplam fiyat
        </span>
      )}

      {/* Mağaza */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-electric text-sm font-black text-white">
          {(offer.vendor?.displayName ?? '?').charAt(0)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{offer.vendor?.displayName}</p>
          <p className="flex items-center gap-1 text-[11px] text-muted">
            <StarIcon className="h-3 w-3 fill-warning text-warning" />
            <span className="tabular">{offer.vendor?.rating.toFixed(2) ?? '—'}</span>
            {offer.condition !== 'new' && (
              <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5">
                {offer.condition === 'refurbished' ? 'Yenilenmiş' : 'İkinci el'}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Kargo ve teslimat */}
      <div className="flex shrink-0 flex-col gap-0.5 text-[11px] text-muted sm:w-40">
        <span className="flex items-center gap-1.5">
          <TruckIcon className="h-3.5 w-3.5" />
          {offer.shippingFeeCents === 0 ? (
            <span className="text-success">Ücretsiz kargo</span>
          ) : (
            <span>Kargo {formatMoney(offer.shippingFeeCents)}</span>
          )}
        </span>
        <span>{offer.estimatedDeliveryDays} günde kargoda</span>
        {lowStock && <span className="text-warning">Son {offer.stock} adet!</span>}
      </div>

      {/* Fiyat */}
      <div className="shrink-0 sm:w-44 sm:text-right">
        <div className="flex items-baseline gap-2 sm:justify-end">
          <span className="tabular text-lg font-bold">{formatMoney(offer.priceCents)}</span>
          {percent !== null && (
            <span className="rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-bold text-success">
              %{percent}
            </span>
          )}
        </div>

        {offer.compareAtPriceCents && (
          <p className="tabular text-xs text-subtle line-through">
            {formatMoney(offer.compareAtPriceCents)}
          </p>
        )}

        <p className="tabular mt-0.5 text-[11px] text-muted">
          kargo dahil {formatMoney(offer.totalCostCents)}
        </p>
      </div>

      <button
        type="button"
        onClick={handleAdd}
        disabled={offer.stock === 0}
        className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
          added
            ? 'bg-success text-white'
            : isBest
              ? 'bg-gradient-to-r from-brand to-electric text-white hover:scale-[1.03]'
              : 'border border-line bg-surface-2 text-fg hover:border-brand/50'
        }`}
      >
        <span className="flex items-center gap-2">
          {added ? <CheckIcon className="h-4 w-4" /> : <CartIcon className="h-4 w-4" />}
          {offer.stock === 0 ? 'Tükendi' : added ? 'Eklendi' : 'Sepete ekle'}
        </span>
      </button>
    </li>
  );
}
