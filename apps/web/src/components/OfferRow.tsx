'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  discountPercent,
  formatMoney,
  offerSellerName,
  offerSellerRating,
  type Offer,
  type OfferBadge,
} from '@ohaaaa/shared';

import { ArrowRightIcon, CartIcon, CheckIcon, StarIcon, TruckIcon } from './Icons';

/**
 * Rozet metinleri.
 *
 * Üçü ayrı ayrı gösteriliyor çünkü kullanıcının sorusu her zaman "en ucuz
 * hangisi" değil: bazen "en çabuk", bazen "makul sürede en ucuz". Üçünü tek
 * etikete indirmek, ikisini gizlemek demek.
 */
const BADGE_ETIKET: Record<OfferBadge, string> = {
  cheapest: 'En ucuz toplam',
  fastest: 'En hızlı teslimat',
  best_value: 'En iyi değer',
};
import { useCart } from '@/store/cart';

/**
 * Karşılaştırma tablosunun tek satırı.
 *
 * Sıralama ölçütü ÜRÜN FİYATI DEĞİL, kargo dahil TOPLAM MALİYETTİR.
 * Kullanıcının gerçekte ödeyeceği tutar budur; "en ucuz" etiketini ürün
 * fiyatına göre vermek yanıltıcı olurdu (kargoyla birlikte sıra değişebilir).
 *
 * PARA BİRİMİ HER TUTARDA AÇIKÇA VERİLİYOR. Verilmediğinde `formatMoney`
 * TRY varsayıyordu: 90 USD'lik bir teklif "₺90,00" olarak görünüyordu --
 * kullanıcıya yanlış fiyat göstermenin en doğrudan hâli.
 */
export function OfferRow({
  offer,
  groupSlug,
  badges = [],
}: {
  offer: Offer;
  groupSlug: string;
  /** cheapest / fastest / best_value. Boş dizi = rozetsiz. */
  badges?: OfferBadge[];
}) {
  const add = useCart((state) => state.add);
  const [added, setAdded] = useState(false);

  const percent = discountPercent(offer.priceCents, offer.compareAtPriceCents);
  /*
   * Vurgu YALNIZCA "en ucuz"a. En hızlı ve en iyi değer de rozet alıyor ama
   * satırı yeşile boyamıyor: üç satırı birden vurgulamak, hiçbirini
   * vurgulamamakla aynı şey.
   */
  const isCheapest = badges.includes('cheapest');
  const lowStock = offer.stock > 0 && offer.stock <= 5;

  const isAffiliate = offer.fulfillment === 'affiliate';
  const sellerName = offerSellerName(offer);
  const sellerRating = offerSellerRating(offer);

  function handleAdd() {
    // Ortak mağaza teklifleri sepete eklenemez; bu düğme onlarda çıkmaz.
    if (isAffiliate || !offer.vendorId) return;

    add({
      productId: offer.id,
      groupSlug,
      title: offer.title,
      imageUrl: offer.imageUrls[0] ?? null,
      priceCents: offer.priceCents,
      quantity: 1,
      vendorId: offer.vendorId,
      vendorName: sellerName,
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
        isCheapest
          ? 'border-success/45 bg-success/[0.06]'
          : 'border-line bg-surface hover:border-brand/35'
      }`}
    >
      {badges.length > 0 && (
        <span className="absolute -top-2.5 left-4 flex flex-wrap gap-1.5">
          {badges.map((badge) => (
            <span
              key={badge}
              className={`rounded-full px-2.5 py-0.5 text-3xs font-bold uppercase tracking-wide ${
                badge === 'cheapest'
                  ? 'bg-success text-on-success'
                  : 'bg-surface-2 text-fg ring-1 ring-line'
              }`}
            >
              {BADGE_ETIKET[badge]}
            </span>
          ))}
        </span>
      )}

      {/* Mağaza */}
      {/* min-w: düğme metni uzadığında (“Mağazaya git”) satıcı adının
          birkaç karaktere kırpılmasını önler. */}
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:min-w-[10rem]">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl press bg-brand-cta text-sm font-black text-white">
          {sellerName.charAt(0)}
        </span>
        <div className="min-w-0">
          {/*
            Taşeron mağazasının adı kendi vitrinine bağlanır. Ortak mağaza
            (affiliate) tekliflerinde böyle bir sayfa YOKTUR — o satış bizde
            değil, karşı tarafta tamamlanır — ve olmayan bir sayfaya bağ
            vermek 404 üretirdi. Bu yüzden bağ yalnızca `vendor.slug` varsa.
          */}
          {offer.vendor?.slug ? (
            <Link
              href={`/magaza/${offer.vendor.slug}`}
              className="block truncate text-sm font-semibold underline-offset-2 hover:underline"
            >
              {sellerName}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold">{sellerName}</p>
          )}
          <p className="flex items-center gap-1 text-2xs text-muted">
            <StarIcon className="h-3 w-3 fill-warning text-warning" />
            <span className="tabular">{sellerRating?.toFixed(2) ?? '—'}</span>
            {offer.condition !== 'new' && (
              <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5">
                {offer.condition === 'refurbished' ? 'Yenilenmiş' : 'İkinci el'}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Kargo ve teslimat */}
      <div className="flex shrink-0 flex-col gap-0.5 text-2xs text-muted sm:w-40">
        <span className="flex items-center gap-1.5">
          <TruckIcon className="h-3.5 w-3.5" />
          {offer.shippingFeeCents === 0 ? (
            <span className="text-success">Ücretsiz kargo</span>
          ) : (
            <span>Kargo {formatMoney(offer.shippingFeeCents, offer.currency)}</span>
          )}
        </span>
        <span>{offer.estimatedDeliveryDays} günde kargoda</span>
        {lowStock && <span className="text-warning">Son {offer.stock} adet!</span>}
      </div>

      {/* Fiyat */}
      <div className="shrink-0 sm:w-44 sm:text-right">
        <div className="flex items-baseline gap-2 sm:justify-end">
          <span className="tabular text-lg font-bold">
            {formatMoney(offer.priceCents, offer.currency)}
          </span>
          {percent !== null && (
            <span className="rounded bg-success/15 px-1.5 py-0.5 text-2xs font-bold text-success">
              %{percent}
            </span>
          )}
        </div>

        {offer.compareAtPriceCents && (
          <p className="tabular text-xs text-subtle line-through">
            {formatMoney(offer.compareAtPriceCents, offer.currency)}
          </p>
        )}

        <p className="tabular mt-0.5 text-2xs text-muted">
          kargo dahil {formatMoney(offer.totalCostCents, offer.currency)}
        </p>
        {isAffiliate && (
          <p className="mt-0.5 text-3xs text-subtle">satış {sellerName}’de tamamlanır</p>
        )}
      </div>

      {/*
        İki teklif türü, iki farklı eylem:
          • Taşeron  → sepete eklenir, sipariş bizde oluşur
          • Ortak    → /git/<id> üzerinden mağazaya yönlendirilir

        Yönlendirme normal bir bağlantıdır (JavaScript değil): kullanıcı
        yeni sekmede açabilsin, tarayıcı ön yükleme yapabilsin diye.
        rel="sponsored nofollow" ise reklam kurulunun ve arama motorlarının
        beklediği açıklamadır — ticari bağlantı olduğunu bildirir.
      */}
      {isAffiliate ? (
        <a
          href={offer.stock === 0 ? undefined : `/git/${offer.id}`}
          rel="sponsored nofollow noopener"
          target="_blank"
          aria-disabled={offer.stock === 0}
          className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors duration-150 ease-out ${
            offer.stock === 0
              ? 'pointer-events-none border border-line bg-surface-2 opacity-40'
              : isCheapest
                ? 'press bg-brand-cta text-white'
                : 'border border-line bg-surface-2 text-fg hover:border-brand/50'
          }`}
        >
          <span className="flex items-center gap-2">
            {offer.stock === 0 ? 'Tükendi' : 'Mağazaya git'}
            {offer.stock > 0 && <ArrowRightIcon className="h-4 w-4" />}
          </span>
        </a>
      ) : (
        <button
          type="button"
          onClick={handleAdd}
          disabled={offer.stock === 0}
          className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40 ${
            added
              ? 'bg-success text-on-success'
              : isCheapest
                ? 'press bg-brand-cta text-white'
                : 'border border-line bg-surface-2 text-fg hover:border-brand/50'
          }`}
        >
          <span className="flex items-center gap-2">
            {added ? <CheckIcon className="h-4 w-4" /> : <CartIcon className="h-4 w-4" />}
            {offer.stock === 0 ? 'Tükendi' : added ? 'Eklendi' : 'Sepete ekle'}
          </span>
        </button>
      )}
    </li>
  );
}
