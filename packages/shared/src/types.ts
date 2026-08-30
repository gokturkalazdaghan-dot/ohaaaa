/**
 * Alan modeli (domain) tipleri — veritabanı şemasının TypeScript karşılığı.
 * Web, mobil köprüsü ve backend aynı tipleri kullanır; şema değişince
 * tek yerden yayılır.
 */

import type { Currency } from './money.js';

export type UserRole = 'customer' | 'vendor' | 'admin';
export type VendorStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type ProductStatus = 'draft' | 'active' | 'out_of_stock' | 'archived';
export type ProductCondition = 'new' | 'refurbished' | 'used';

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type VendorOrderStatus =
  | 'awaiting_vendor'
  | 'accepted'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

/**
 * Alt sipariş durumunun izin verilen geçişleri.
 *
 * GERİYE DÖNÜK GEÇİŞ YOK. "Kargolandı"dan "hazırlanıyor"a dönmek, alıcıya
 * gönderilmiş bir bildirimi geri almak demektir; bir yanlışlık olduğunda
 * doğru yol iptal ya da yeni bir kayıt açmaktır, geçmişi değiştirmek değil.
 *
 * Tablo burada, paylaşılan pakette: aynı kural hem Express API'sinde hem web
 * uygulamasının uç noktalarında uygulanır. İki kopya olsaydı biri diğerinin
 * yasakladığı geçişe izin verirdi ve hangisinin doğru olduğu belirsizleşirdi.
 */
export const VENDOR_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  awaiting_vendor: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** Bir durum geçişine izin verilip verilmediğini söyler. */
export function canTransitionVendorOrder(from: string, to: string): boolean {
  return (VENDOR_ORDER_TRANSITIONS[from] ?? []).includes(to);
}

/** Bir durumdan gidilebilecek durumlar (hata mesajında kullanıcıya söylenir). */
export function allowedVendorOrderTransitions(from: string): readonly string[] {
  return VENDOR_ORDER_TRANSITIONS[from] ?? [];
}

/** Taşeron API anahtarının verebileceği yetkiler. */
export const API_SCOPES = [
  'products:read',
  'products:write',
  'orders:read',
  'orders:write',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface Vendor {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  status: VendorStatus;
  commissionRate: number;
  rating: number;
  ratingCount: number;
  activeProductCount: number;
}

export interface Category {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  icon: string | null;
}

/**
 * Teklifi karşılayan taraf.
 *
 *   marketplace : Taşeron satar, sipariş bizde oluşur, komisyon keseriz.
 *   affiliate   : Ortak mağaza satar, kullanıcıyı yönlendiririz, komisyon alırız.
 *
 * Bu ayrım arayüzde tek bir yerde görünür: birincide "Sepete ekle",
 * ikincide "Mağazaya git" düğmesi çıkar. Karşılaştırma, sıralama ve fiyat
 * mantığı ikisinde de aynıdır.
 */
export type Fulfillment = 'marketplace' | 'affiliate';

/** Komisyon karşılığı trafik gönderdiğimiz dış mağaza. */
export interface Merchant {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  homepageUrl: string;
  rating: number | null;
}

/** Bir satıcının kanonik ürüne verdiği teklif (taşeron ya da ortak mağaza). */
export interface Offer {
  id: string;
  fulfillment: Fulfillment;

  /** fulfillment === 'marketplace' ise dolu. */
  vendorId: string | null;
  vendor: Pick<Vendor, 'id' | 'slug' | 'displayName' | 'logoUrl' | 'rating'> | null;

  /** fulfillment === 'affiliate' ise dolu. */
  merchantId: string | null;
  merchant: Merchant | null;
  /** Ortak mağazadaki ürün sayfası. Yönlendirme linki bundan türetilir. */
  productUrl: string | null;
  title: string;
  sku: string | null;
  imageUrls: string[];
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: Currency;
  stock: number;
  condition: ProductCondition;
  shippingFeeCents: number;
  freeShippingThresholdCents: number | null;
  estimatedDeliveryDays: number;
  status: ProductStatus;
  /** Ürün + kargo. Karşılaştırma sıralaması bu değere göre yapılır. */
  totalCostCents: number;
}

/** Fiyat karşılaştırmasının birimi: kanonik ürün. */
export interface ProductGroup {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  description: string | null;
  categoryId: string | null;
  attributes: Record<string, string>;
  offerCount: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
}

export interface ProductGroupWithOffers extends ProductGroup {
  offers: Offer[];
}

/** Arama sonuç kartı — liste sayfaları tek sorguda beslenir. */
export interface SearchResult {
  groupId: string;
  slug: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  offerCount: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  bestOfferId: string | null;
  bestVendorId: string | null;
  bestVendorName: string | null;
}

export interface FlashDeal {
  id: string;
  productId: string;
  groupSlug: string | null;
  headline: string;
  title: string;
  imageUrl: string | null;
  originalPriceCents: number;
  dealPriceCents: number;
  stockLimit: number | null;
  soldCount: number;
  vendorName: string | null;
  endsAt: string;
}

/** Sepet kalemi — istemcide tutulur, fiyatlar sunucuda yeniden doğrulanır. */
export interface CartItem {
  productId: string;
  groupSlug: string;
  title: string;
  imageUrl: string | null;
  priceCents: number;
  quantity: number;
  vendorId: string;
  vendorName: string;
  vendorSlug: string;
  shippingFeeCents: number;
  freeShippingThresholdCents: number | null;
  estimatedDeliveryDays: number;
  maxStock: number;
}

/** Sepetin tek bir taşerona düşen parçası (split-cart görünümü). */
export interface CartVendorGroup {
  vendorId: string;
  vendorName: string;
  vendorSlug: string;
  items: CartItem[];
  itemsSubtotalCents: number;
  shippingCents: number;
  /** Ücretsiz kargoya kalan tutar; eşik yoksa veya aşıldıysa null. */
  freeShippingRemainingCents: number | null;
  estimatedDeliveryDays: number;
  totalCents: number;
}

export interface CartSummary {
  groups: CartVendorGroup[];
  itemCount: number;
  itemsSubtotalCents: number;
  shippingTotalCents: number;
  grandTotalCents: number;
  vendorCount: number;
}

export interface OrderItem {
  id: string;
  productId: string | null;
  titleSnapshot: string;
  imageUrlSnapshot: string | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface VendorOrder {
  id: string;
  orderId: string;
  vendorId: string;
  vendorName: string | null;
  status: VendorOrderStatus;
  itemsSubtotalCents: number;
  shippingCents: number;
  commissionCents: number;
  payoutCents: number;
  carrier: string | null;
  trackingNumber: string | null;
  items: OrderItem[];
  createdAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  email: string;
  currency: Currency;
  itemsSubtotalCents: number;
  shippingTotalCents: number;
  grandTotalCents: number;
  vendorOrders: VendorOrder[];
  createdAt: string;
}

/** Taşeron panelindeki analitik kartları. */
export interface VendorDashboardStats {
  vendorId: string;
  windowDays: number;
  revenueCents: number;
  payoutCents: number;
  commissionCents: number;
  orderCount: number;
  awaitingCount: number;
  shippedCount: number;
  deliveredCount: number;
  avgOrderCents: number;
  activeProducts: number;
  outOfStockProducts: number;
  dailyRevenue: Array<{ day: string; revenueCents: number; orderCount: number }>;
}

/**
 * Teklifi veren tarafın görünen adı ve puanı — arayüz hangi türde olduğunu
 * bilmek zorunda kalmasın diye tek yerden çözülür.
 */
export function offerSellerName(offer: Offer): string {
  return offer.vendor?.displayName ?? offer.merchant?.displayName ?? 'Mağaza';
}

export function offerSellerRating(offer: Offer): number | null {
  return offer.vendor?.rating ?? offer.merchant?.rating ?? null;
}
