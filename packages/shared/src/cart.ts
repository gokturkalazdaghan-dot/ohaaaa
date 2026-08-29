/**
 * Split-cart hesaplaması.
 *
 * ÖNEMLİ: Buradaki kurallar veritabanındaki create_order() fonksiyonuyla
 * BİREBİR aynı olmak zorundadır. Sepette gösterilen tutar ile siparişte
 * tahsil edilen tutar ayrışırsa kullanıcı güveni kaybedilir.
 *
 * Ortak kurallar:
 *   1. Kargo taşeron başına bir kez alınır (aynı koliden gönderim varsayımı).
 *   2. Taban kargo ücreti = o taşeronun kalemleri içindeki EN YÜKSEK ücret.
 *   3. Ücretsiz kargo eşiği = kalemler içindeki EN DÜŞÜK eşik (müşteri lehine);
 *      eşiği olmayan kalemler eşiği bozmaz.
 *   4. Ara toplam eşiğe ulaşırsa kargo sıfırlanır.
 *   5. Teslimat süresi = kalemler içindeki EN UZUN süre (koli birlikte çıkar).
 *
 * Bu dosya saf fonksiyonlardan oluşur ve birim testlerle korunur.
 */

import type { CartItem, CartSummary, CartVendorGroup } from './types.js';

/** Sepeti taşeron bazında bölerek her parçanın toplamını hesaplar. */
export function summarizeCart(items: CartItem[]): CartSummary {
  const byVendor = new Map<string, CartItem[]>();

  for (const item of items) {
    const bucket = byVendor.get(item.vendorId);
    if (bucket) bucket.push(item);
    else byVendor.set(item.vendorId, [item]);
  }

  const groups: CartVendorGroup[] = [];

  for (const [vendorId, vendorItems] of byVendor) {
    const first = vendorItems[0]!;

    const itemsSubtotalCents = vendorItems.reduce(
      (sum, item) => sum + item.priceCents * item.quantity,
      0,
    );

    // Kural 2: taban ücret, kalemlerin en yükseği.
    const shippingBaseCents = vendorItems.reduce(
      (max, item) => Math.max(max, item.shippingFeeCents),
      0,
    );

    // Kural 3: eşiği tanımlı kalemler arasından en düşüğü.
    const thresholds = vendorItems
      .map((item) => item.freeShippingThresholdCents)
      .filter((t): t is number => typeof t === 'number' && t > 0);
    const freeThresholdCents = thresholds.length > 0 ? Math.min(...thresholds) : null;

    // Kural 4.
    const qualifiesForFreeShipping =
      freeThresholdCents !== null && itemsSubtotalCents >= freeThresholdCents;
    const shippingCents = qualifiesForFreeShipping ? 0 : shippingBaseCents;

    // Ücretsiz kargoya ne kadar kaldı? (Sepette teşvik mesajı için.)
    const freeShippingRemainingCents =
      freeThresholdCents !== null && !qualifiesForFreeShipping && shippingBaseCents > 0
        ? freeThresholdCents - itemsSubtotalCents
        : null;

    // Kural 5.
    const estimatedDeliveryDays = vendorItems.reduce(
      (max, item) => Math.max(max, item.estimatedDeliveryDays),
      0,
    );

    groups.push({
      vendorId,
      vendorName: first.vendorName,
      vendorSlug: first.vendorSlug,
      items: vendorItems,
      itemsSubtotalCents,
      shippingCents,
      freeShippingRemainingCents,
      estimatedDeliveryDays,
      totalCents: itemsSubtotalCents + shippingCents,
    });
  }

  // Kararlı sıralama: en yüksek tutarlı taşeron üstte, eşitlikte isme göre.
  groups.sort(
    (a, b) => b.itemsSubtotalCents - a.itemsSubtotalCents || a.vendorName.localeCompare(b.vendorName, 'tr'),
  );

  const itemsSubtotalCents = groups.reduce((s, g) => s + g.itemsSubtotalCents, 0);
  const shippingTotalCents = groups.reduce((s, g) => s + g.shippingCents, 0);

  return {
    groups,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    itemsSubtotalCents,
    shippingTotalCents,
    grandTotalCents: itemsSubtotalCents + shippingTotalCents,
    vendorCount: groups.length,
  };
}

/**
 * Sepete ekleme / adet güncelleme. Saf fonksiyondur: yeni dizi döndürür.
 * Aynı ürün tekrar eklenirse adetler birleşir, stok üst sınırı aşılmaz.
 */
export function addToCart(items: CartItem[], incoming: CartItem): CartItem[] {
  const index = items.findIndex((item) => item.productId === incoming.productId);

  if (index === -1) {
    const quantity = clampQuantity(incoming.quantity, incoming.maxStock);
    return quantity > 0 ? [...items, { ...incoming, quantity }] : items;
  }

  const existing = items[index]!;
  const quantity = clampQuantity(existing.quantity + incoming.quantity, incoming.maxStock);

  const next = [...items];
  // Fiyat ve stok bilgisi tazelenir: sepette bekleyen kalem eskimiş olabilir.
  next[index] = { ...existing, ...incoming, quantity };
  return next;
}

export function updateQuantity(
  items: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  if (quantity <= 0) return removeFromCart(items, productId);

  return items.map((item) =>
    item.productId === productId
      ? { ...item, quantity: clampQuantity(quantity, item.maxStock) }
      : item,
  );
}

export function removeFromCart(items: CartItem[], productId: string): CartItem[] {
  return items.filter((item) => item.productId !== productId);
}

/** Sepeti create_order() RPC'sinin beklediği biçime çevirir. */
export function toOrderPayload(items: CartItem[]): Array<{ product_id: string; quantity: number }> {
  return items.map((item) => ({ product_id: item.productId, quantity: item.quantity }));
}

function clampQuantity(quantity: number, maxStock: number): number {
  const upperBound = Math.min(Number.isFinite(maxStock) ? maxStock : 999, 999);
  return Math.max(0, Math.min(Math.floor(quantity), upperBound));
}
