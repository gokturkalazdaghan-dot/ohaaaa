/// Demo veri kümesi.
///
/// `supabase/seed.sql` ve web'deki `apps/web/src/data/demo.ts` ile aynı
/// ürünleri taşır: üç yüzey de yapılandırma olmadan aynı pazar yerini gösterir.
library;

import 'models.dart';

const Vendor _teknomarkt = Vendor(
  id: 'vendor-teknomarkt',
  slug: 'teknomarkt',
  displayName: 'Teknomarkt',
  rating: 4.72,
);

const Vendor _modaVitrin = Vendor(
  id: 'vendor-moda-vitrin',
  slug: 'moda-vitrin',
  displayName: 'Moda Vitrin',
  rating: 4.51,
);

const Vendor _evBahce = Vendor(
  id: 'vendor-ev-bahce',
  slug: 'ev-bahce-dunyasi',
  displayName: 'Ev & Bahçe Dünyası',
  rating: 4.38,
);

final List<ProductGroup> demoGroups = <ProductGroup>[
  ProductGroup(
    id: 'group-iphone-15',
    slug: 'apple-iphone-15-128gb',
    title: 'Apple iPhone 15 128GB',
    brand: 'Apple',
    description:
        '6.1" Super Retina XDR ekran, A16 Bionic işlemci, 48MP ana kamera.',
    offerCount: 3,
    minPriceCents: 5389900,
    maxPriceCents: 5629900,
    attributes: const <String, String>{
      'Renk': 'Siyah',
      'Depolama': '128GB',
      'Ekran': '6.1 inç',
    },
    offers: const <Offer>[
      Offer(
        id: 'offer-ip15-mv',
        vendorId: 'vendor-moda-vitrin',
        vendor: _modaVitrin,
        title: 'iPhone 15 128 GB Siyah (Distribütör Garantili)',
        priceCents: 5389900,
        stock: 7,
        shippingFeeCents: 4999,
        estimatedDeliveryDays: 3,
      ),
      Offer(
        id: 'offer-ip15-tm',
        vendorId: 'vendor-teknomarkt',
        vendor: _teknomarkt,
        title: 'Apple iPhone 15 128GB Siyah',
        priceCents: 5499900,
        compareAtPriceCents: 6299900,
        stock: 42,
        shippingFeeCents: 0,
        freeShippingThresholdCents: 50000,
        estimatedDeliveryDays: 1,
      ),
      Offer(
        id: 'offer-ip15-ebd',
        vendorId: 'vendor-ev-bahce',
        vendor: _evBahce,
        title: 'Apple iPhone 15 128GB',
        priceCents: 5629900,
        stock: 3,
        shippingFeeCents: 0,
        freeShippingThresholdCents: 30000,
        estimatedDeliveryDays: 2,
      ),
    ],
  ),
  ProductGroup(
    id: 'group-sony-xm5',
    slug: 'sony-wh-1000xm5',
    title: 'Sony WH-1000XM5 Kablosuz Kulaklık',
    brand: 'Sony',
    description: 'Sektör lideri gürültü engelleme, 30 saat pil ömrü.',
    offerCount: 2,
    minPriceCents: 1189900,
    maxPriceCents: 1249000,
    attributes: const <String, String>{
      'Renk': 'Siyah',
      'Tip': 'Kulak üstü',
    },
    offers: const <Offer>[
      Offer(
        id: 'offer-xm5-tm',
        vendorId: 'vendor-teknomarkt',
        vendor: _teknomarkt,
        title: 'Sony WH-1000XM5 Kablosuz Kulaklık Siyah',
        priceCents: 1189900,
        compareAtPriceCents: 1449900,
        stock: 128,
        shippingFeeCents: 0,
        freeShippingThresholdCents: 50000,
        estimatedDeliveryDays: 1,
      ),
      Offer(
        id: 'offer-xm5-mv',
        vendorId: 'vendor-moda-vitrin',
        vendor: _modaVitrin,
        title: 'Sony WH-1000XM5 ANC Kulaklık',
        priceCents: 1249000,
        stock: 15,
        shippingFeeCents: 2999,
        estimatedDeliveryDays: 2,
      ),
    ],
  ),
  ProductGroup(
    id: 'group-ideapad',
    slug: 'lenovo-ideapad-slim-3-16gb',
    title: 'Lenovo IdeaPad Slim 3 16GB 512GB SSD',
    brand: 'Lenovo',
    description: 'Ryzen 7 işlemci, 16GB RAM, 512GB NVMe SSD, 15.6" FHD ekran.',
    offerCount: 2,
    minPriceCents: 2199900,
    maxPriceCents: 2249000,
    offers: const <Offer>[
      Offer(
        id: 'offer-lenovo-tm',
        vendorId: 'vendor-teknomarkt',
        vendor: _teknomarkt,
        title: 'Lenovo IdeaPad Slim 3 Ryzen 7 16GB 512GB',
        priceCents: 2199900,
        compareAtPriceCents: 2599900,
        stock: 23,
        shippingFeeCents: 0,
        freeShippingThresholdCents: 50000,
        estimatedDeliveryDays: 2,
      ),
      Offer(
        id: 'offer-lenovo-ebd',
        vendorId: 'vendor-ev-bahce',
        vendor: _evBahce,
        title: 'Lenovo IdeaPad Slim 3 16GB RAM',
        priceCents: 2249000,
        stock: 5,
        shippingFeeCents: 0,
        freeShippingThresholdCents: 30000,
        estimatedDeliveryDays: 4,
      ),
    ],
  ),
  ProductGroup(
    id: 'group-airfryer',
    slug: 'philips-airfryer-xxl',
    title: 'Philips Airfryer XXL 7.3L',
    brand: 'Philips',
    description: 'Rapid Air teknolojisi, 7.3L kapasite, %90 daha az yağ.',
    offerCount: 2,
    minPriceCents: 799900,
    maxPriceCents: 824900,
    offers: const <Offer>[
      Offer(
        id: 'offer-airfryer-ebd',
        vendorId: 'vendor-ev-bahce',
        vendor: _evBahce,
        title: 'Philips Airfryer XXL 7.3L Siyah',
        priceCents: 799900,
        compareAtPriceCents: 999900,
        stock: 37,
        shippingFeeCents: 0,
        freeShippingThresholdCents: 30000,
        estimatedDeliveryDays: 2,
      ),
      Offer(
        id: 'offer-airfryer-tm',
        vendorId: 'vendor-teknomarkt',
        vendor: _teknomarkt,
        title: 'Philips Airfryer XXL',
        priceCents: 824900,
        stock: 19,
        shippingFeeCents: 0,
        freeShippingThresholdCents: 50000,
        estimatedDeliveryDays: 1,
      ),
    ],
  ),
  ProductGroup(
    id: 'group-pegasus',
    slug: 'nike-air-zoom-pegasus-40',
    title: 'Nike Air Zoom Pegasus 40 Koşu Ayakkabısı',
    brand: 'Nike',
    description: 'React köpük orta taban, Zoom Air yastıklama.',
    offerCount: 1,
    minPriceCents: 449900,
    maxPriceCents: 449900,
    offers: const <Offer>[
      Offer(
        id: 'offer-pegasus-mv',
        vendorId: 'vendor-moda-vitrin',
        vendor: _modaVitrin,
        title: 'Nike Air Zoom Pegasus 40 Koşu Ayakkabısı',
        priceCents: 449900,
        compareAtPriceCents: 549900,
        stock: 64,
        shippingFeeCents: 2999,
        freeShippingThresholdCents: 100000,
        estimatedDeliveryDays: 2,
      ),
    ],
  ),
];

/// Türkçe karakterleri ASCII'ye indirger — SQL'deki `normalize_search` ile
/// aynı davranış, böylece demo ve canlı arama sonuçları tutarlı kalır.
String normalizeSearch(String value) {
  const Map<String, String> map = <String, String>{
    'Ğ': 'g', 'Ü': 'u', 'Ş': 's', 'İ': 'i', 'Ö': 'o', 'Ç': 'c', 'I': 'i',
    'ğ': 'g', 'ü': 'u', 'ş': 's', 'ı': 'i', 'ö': 'o', 'ç': 'c',
  };

  final StringBuffer buffer = StringBuffer();
  for (final String char in value.split('')) {
    buffer.write(map[char] ?? char);
  }
  return buffer.toString().toLowerCase();
}

List<SearchResult> demoSearch({
  String? query,
  String sort = 'relevance',
  int limit = 24,
}) {
  final List<String> tokens = (query == null || query.trim().isEmpty)
      ? <String>[]
      : normalizeSearch(query.trim())
          .split(RegExp(r'\s+'))
          .where((String token) => token.isNotEmpty)
          .toList();

  final List<ProductGroup> matched = demoGroups.where((ProductGroup group) {
    final String haystack =
        normalizeSearch('${group.title} ${group.brand ?? ''}');
    // Her kelime eşleşmeli (AND semantiği) — SQL tarafıyla aynı kural.
    return tokens.every(haystack.contains);
  }).toList();

  matched.sort((ProductGroup a, ProductGroup b) {
    switch (sort) {
      case 'price_asc':
        return (a.minPriceCents ?? 0).compareTo(b.minPriceCents ?? 0);
      case 'price_desc':
        return (b.minPriceCents ?? 0).compareTo(a.minPriceCents ?? 0);
      case 'offers':
        return b.offerCount.compareTo(a.offerCount);
      default:
        return a.title.compareTo(b.title);
    }
  });

  return matched.take(limit).map((ProductGroup group) {
    final List<Offer> sorted = group.sortedOffers;
    return SearchResult(
      groupId: group.id,
      slug: group.slug,
      title: group.title,
      brand: group.brand,
      imageUrl: group.imageUrl,
      offerCount: group.offerCount,
      minPriceCents: group.minPriceCents,
      maxPriceCents: group.maxPriceCents,
      bestVendorName:
          sorted.isEmpty ? null : sorted.first.vendor?.displayName,
    );
  }).toList();
}

ProductGroup? demoProductGroup(String slug) {
  for (final ProductGroup group in demoGroups) {
    if (group.slug == slug) return group;
  }
  return null;
}

/// Demo sipariş — gerçek bir tahsilat yapılmaz.
Map<String, dynamic> demoCreateOrder(List<Map<String, dynamic>> items) {
  return <String, dynamic>{
    'order_number':
        'OHA-DEMO-${DateTime.now().millisecondsSinceEpoch.toRadixString(36).toUpperCase()}',
    'status': 'paid',
    'demo': true,
    'item_count': items.length,
  };
}
