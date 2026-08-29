/**
 * Yerleşik demo veri kümesi.
 *
 * supabase/seed.sql ile AYNI verileri taşır. Amaç, Supabase yapılandırılmadan
 * da uygulamanın dolu ve gerçekçi görünmesidir. Veriler seed ile eşleştiği
 * için demo modundan canlıya geçildiğinde arayüz değişmez.
 */

import type { Category, FlashDeal, Offer, ProductGroupWithOffers, Vendor } from '@ohaaaa/shared';

export const demoCategories: Category[] = [
  { id: 'cat-elektronik', parentId: null, slug: 'elektronik', name: 'Elektronik', icon: 'cpu' },
  { id: 'cat-moda', parentId: null, slug: 'moda', name: 'Moda', icon: 'shirt' },
  { id: 'cat-ev', parentId: null, slug: 'ev-yasam', name: 'Ev & Yaşam', icon: 'sofa' },
  { id: 'cat-spor', parentId: null, slug: 'spor-outdoor', name: 'Spor & Outdoor', icon: 'dumbbell' },
  { id: 'cat-kozmetik', parentId: null, slug: 'kozmetik', name: 'Kozmetik', icon: 'sparkles' },
  { id: 'cat-market', parentId: null, slug: 'supermarket', name: 'Süpermarket', icon: 'basket' },
];

export const demoVendors: Vendor[] = [
  {
    id: 'vendor-teknomarkt',
    slug: 'teknomarkt',
    displayName: 'Teknomarkt',
    description: 'Elektronik ve teknoloji ürünlerinde 18 yıllık tedarik gücü.',
    logoUrl: null,
    status: 'approved',
    commissionRate: 0.07,
    rating: 4.72,
    ratingCount: 18432,
    activeProductCount: 5,
  },
  {
    id: 'vendor-moda-vitrin',
    slug: 'moda-vitrin',
    displayName: 'Moda Vitrin',
    description: 'Sezonun öne çıkan markaları, hızlı kargo garantisiyle.',
    logoUrl: null,
    status: 'approved',
    commissionRate: 0.12,
    rating: 4.51,
    ratingCount: 9310,
    activeProductCount: 3,
  },
  {
    id: 'vendor-ev-bahce',
    slug: 'ev-bahce-dunyasi',
    displayName: 'Ev & Bahçe Dünyası',
    description: 'Ev, mutfak ve bahçe ürünlerinde geniş stok.',
    logoUrl: null,
    status: 'approved',
    commissionRate: 0.09,
    rating: 4.38,
    ratingCount: 4127,
    activeProductCount: 4,
  },
];

const vendorRef = (id: string) => {
  const vendor = demoVendors.find((v) => v.id === id)!;
  return {
    id: vendor.id,
    slug: vendor.slug,
    displayName: vendor.displayName,
    logoUrl: vendor.logoUrl,
    rating: vendor.rating,
  };
};

function offer(input: Omit<Offer, 'vendor' | 'totalCostCents' | 'currency' | 'condition' | 'status'> &
  Partial<Pick<Offer, 'condition' | 'status'>>): Offer {
  return {
    ...input,
    currency: 'TRY',
    condition: input.condition ?? 'new',
    status: input.status ?? 'active',
    vendor: vendorRef(input.vendorId),
    totalCostCents: input.priceCents + input.shippingFeeCents,
  };
}

export const demoProductGroups: ProductGroupWithOffers[] = [
  {
    id: 'group-iphone-15',
    slug: 'apple-iphone-15-128gb',
    title: 'Apple iPhone 15 128GB',
    brand: 'Apple',
    imageUrl: null,
    description:
      '6.1" Super Retina XDR ekran, A16 Bionic işlemci, 48MP ana kamera, USB-C bağlantı.',
    categoryId: 'cat-elektronik',
    attributes: { Renk: 'Siyah', Depolama: '128GB', Ekran: '6.1 inç' },
    offerCount: 3,
    minPriceCents: 5_389_900,
    maxPriceCents: 5_629_900,
    offers: [
      offer({
        id: 'offer-ip15-mv', vendorId: 'vendor-moda-vitrin',
        title: 'iPhone 15 128 GB Siyah (Distribütör Garantili)', sku: 'MVIP15',
        imageUrls: [], priceCents: 5_389_900, compareAtPriceCents: null, stock: 7,
        shippingFeeCents: 4_999, freeShippingThresholdCents: null, estimatedDeliveryDays: 3,
      }),
      offer({
        id: 'offer-ip15-tm', vendorId: 'vendor-teknomarkt',
        title: 'Apple iPhone 15 128GB Siyah', sku: 'IP15128BLK',
        imageUrls: [], priceCents: 5_499_900, compareAtPriceCents: 6_299_900, stock: 42,
        shippingFeeCents: 0, freeShippingThresholdCents: 50_000, estimatedDeliveryDays: 1,
      }),
      offer({
        id: 'offer-ip15-ebd', vendorId: 'vendor-ev-bahce',
        title: 'Apple iPhone 15 128GB', sku: 'EBDIP15',
        imageUrls: [], priceCents: 5_629_900, compareAtPriceCents: null, stock: 3,
        shippingFeeCents: 0, freeShippingThresholdCents: 30_000, estimatedDeliveryDays: 2,
      }),
    ],
  },
  {
    id: 'group-sony-xm5',
    slug: 'sony-wh-1000xm5',
    title: 'Sony WH-1000XM5 Kablosuz Kulaklık',
    brand: 'Sony',
    imageUrl: null,
    description: 'Sektör lideri gürültü engelleme, 30 saat pil ömrü, çok noktalı bağlantı.',
    categoryId: 'cat-elektronik',
    attributes: { Renk: 'Siyah', Tip: 'Kulak üstü', 'Gürültü engelleme': 'Var' },
    offerCount: 2,
    minPriceCents: 1_189_900,
    maxPriceCents: 1_249_000,
    offers: [
      offer({
        id: 'offer-xm5-tm', vendorId: 'vendor-teknomarkt',
        title: 'Sony WH-1000XM5 Kablosuz Kulaklık Siyah', sku: 'TMXM5',
        imageUrls: [], priceCents: 1_189_900, compareAtPriceCents: 1_449_900, stock: 128,
        shippingFeeCents: 0, freeShippingThresholdCents: 50_000, estimatedDeliveryDays: 1,
      }),
      offer({
        id: 'offer-xm5-mv', vendorId: 'vendor-moda-vitrin',
        title: 'Sony WH-1000XM5 ANC Kulaklık', sku: 'MVXM5',
        imageUrls: [], priceCents: 1_249_000, compareAtPriceCents: null, stock: 15,
        shippingFeeCents: 2_999, freeShippingThresholdCents: null, estimatedDeliveryDays: 2,
      }),
    ],
  },
  {
    id: 'group-ideapad',
    slug: 'lenovo-ideapad-slim-3-16gb',
    title: 'Lenovo IdeaPad Slim 3 16GB 512GB SSD',
    brand: 'Lenovo',
    imageUrl: null,
    description: 'Ryzen 7 işlemci, 16GB RAM, 512GB NVMe SSD, 15.6" FHD ekran.',
    categoryId: 'cat-elektronik',
    attributes: { RAM: '16GB', Depolama: '512GB SSD', Ekran: '15.6 inç' },
    offerCount: 2,
    minPriceCents: 2_199_900,
    maxPriceCents: 2_249_000,
    offers: [
      offer({
        id: 'offer-lenovo-tm', vendorId: 'vendor-teknomarkt',
        title: 'Lenovo IdeaPad Slim 3 Ryzen 7 16GB 512GB', sku: 'TMIPS3',
        imageUrls: [], priceCents: 2_199_900, compareAtPriceCents: 2_599_900, stock: 23,
        shippingFeeCents: 0, freeShippingThresholdCents: 50_000, estimatedDeliveryDays: 2,
      }),
      offer({
        id: 'offer-lenovo-ebd', vendorId: 'vendor-ev-bahce',
        title: 'Lenovo IdeaPad Slim 3 16GB RAM', sku: 'EBDLS3',
        imageUrls: [], priceCents: 2_249_000, compareAtPriceCents: null, stock: 5,
        shippingFeeCents: 0, freeShippingThresholdCents: 30_000, estimatedDeliveryDays: 4,
      }),
    ],
  },
  {
    id: 'group-dyson-v12',
    slug: 'dyson-v12-detect-slim',
    title: 'Dyson V12 Detect Slim Kablosuz Süpürge',
    brand: 'Dyson',
    imageUrl: null,
    description: 'Lazer toz algılama, 60 dakika çalışma süresi, HEPA filtrasyon.',
    categoryId: 'cat-ev',
    attributes: { Tip: 'Dikey', Pil: '60 dk' },
    offerCount: 2,
    minPriceCents: 2_899_900,
    maxPriceCents: 2_949_900,
    offers: [
      offer({
        id: 'offer-dyson-ebd', vendorId: 'vendor-ev-bahce',
        title: 'Dyson V12 Detect Slim Absolute', sku: 'EBDV12',
        imageUrls: [], priceCents: 2_899_900, compareAtPriceCents: 3_299_900, stock: 11,
        shippingFeeCents: 0, freeShippingThresholdCents: 30_000, estimatedDeliveryDays: 2,
      }),
      offer({
        id: 'offer-dyson-tm', vendorId: 'vendor-teknomarkt',
        title: 'Dyson V12 Detect Slim Kablosuz Süpürge', sku: 'TMV12',
        imageUrls: [], priceCents: 2_949_900, compareAtPriceCents: null, stock: 4,
        shippingFeeCents: 0, freeShippingThresholdCents: 50_000, estimatedDeliveryDays: 1,
      }),
    ],
  },
  {
    id: 'group-pegasus',
    slug: 'nike-air-zoom-pegasus-40',
    title: 'Nike Air Zoom Pegasus 40 Koşu Ayakkabısı',
    brand: 'Nike',
    imageUrl: null,
    description: 'React köpük orta taban, Zoom Air yastıklama, nefes alan mesh üst.',
    categoryId: 'cat-spor',
    attributes: { Cinsiyet: 'Unisex', Kullanım: 'Koşu' },
    offerCount: 1,
    minPriceCents: 449_900,
    maxPriceCents: 449_900,
    offers: [
      offer({
        id: 'offer-pegasus-mv', vendorId: 'vendor-moda-vitrin',
        title: 'Nike Air Zoom Pegasus 40 Koşu Ayakkabısı', sku: 'MVPEG40',
        imageUrls: [], priceCents: 449_900, compareAtPriceCents: 549_900, stock: 64,
        shippingFeeCents: 2_999, freeShippingThresholdCents: 100_000, estimatedDeliveryDays: 2,
      }),
    ],
  },
  {
    id: 'group-airfryer',
    slug: 'philips-airfryer-xxl',
    title: 'Philips Airfryer XXL 7.3L',
    brand: 'Philips',
    imageUrl: null,
    description: 'Rapid Air teknolojisi, 7.3L kapasite, %90 daha az yağ ile kızartma.',
    categoryId: 'cat-ev',
    attributes: { Kapasite: '7.3L', Güç: '2225W' },
    offerCount: 2,
    minPriceCents: 799_900,
    maxPriceCents: 824_900,
    offers: [
      offer({
        id: 'offer-airfryer-ebd', vendorId: 'vendor-ev-bahce',
        title: 'Philips Airfryer XXL 7.3L Siyah', sku: 'EBDAFXXL',
        imageUrls: [], priceCents: 799_900, compareAtPriceCents: 999_900, stock: 37,
        shippingFeeCents: 0, freeShippingThresholdCents: 30_000, estimatedDeliveryDays: 2,
      }),
      offer({
        id: 'offer-airfryer-tm', vendorId: 'vendor-teknomarkt',
        title: 'Philips Airfryer XXL', sku: 'TMAFXXL',
        imageUrls: [], priceCents: 824_900, compareAtPriceCents: null, stock: 19,
        shippingFeeCents: 0, freeShippingThresholdCents: 50_000, estimatedDeliveryDays: 1,
      }),
    ],
  },
];

/** Kampanya bitişi: her gün gece yarısı. */
function endOfToday(): string {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

export const demoFlashDeals: FlashDeal[] = [
  {
    id: 'deal-xm5', productId: 'offer-xm5-tm', groupSlug: 'sony-wh-1000xm5',
    headline: 'Günün En Oha Fiyatı', title: 'Sony WH-1000XM5 Kablosuz Kulaklık',
    imageUrl: null, originalPriceCents: 1_189_900, dealPriceCents: 999_900,
    stockLimit: 200, soldCount: 137, vendorName: 'Teknomarkt', endsAt: endOfToday(),
  },
  {
    id: 'deal-airfryer', productId: 'offer-airfryer-ebd', groupSlug: 'philips-airfryer-xxl',
    headline: 'Oha Fırsatı', title: 'Philips Airfryer XXL 7.3L',
    imageUrl: null, originalPriceCents: 799_900, dealPriceCents: 699_900,
    stockLimit: 120, soldCount: 64, vendorName: 'Ev & Bahçe Dünyası', endsAt: endOfToday(),
  },
  {
    id: 'deal-pegasus', productId: 'offer-pegasus-mv', groupSlug: 'nike-air-zoom-pegasus-40',
    headline: 'Oha Fırsatı', title: 'Nike Air Zoom Pegasus 40',
    imageUrl: null, originalPriceCents: 449_900, dealPriceCents: 379_900,
    stockLimit: 80, soldCount: 51, vendorName: 'Moda Vitrin', endsAt: endOfToday(),
  },
];
