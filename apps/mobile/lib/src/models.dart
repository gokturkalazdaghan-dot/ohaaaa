/// Alan modeli — web'deki `@ohaaaa/shared/types` karşılığı.
///
/// JSON ayrıştırma modellerin içinde yaşar: API sözleşmesi değiştiğinde
/// derleyici, düzeltilmesi gereken tek yeri gösterir.
library;

class Vendor {
  const Vendor({
    required this.id,
    required this.slug,
    required this.displayName,
    required this.rating,
    this.logoUrl,
  });

  final String id;
  final String slug;
  final String displayName;
  final double rating;
  final String? logoUrl;

  factory Vendor.fromJson(Map<String, dynamic> json) {
    return Vendor(
      id: json['id'] as String,
      slug: json['slug'] as String,
      displayName: json['display_name'] as String,
      rating: (json['rating'] as num?)?.toDouble() ?? 0,
      logoUrl: json['logo_url'] as String?,
    );
  }
}

/// Bir taşeronun kanonik ürüne verdiği teklif.
class Offer {
  const Offer({
    required this.id,
    required this.vendorId,
    required this.title,
    required this.priceCents,
    required this.stock,
    required this.shippingFeeCents,
    required this.estimatedDeliveryDays,
    this.vendor,
    this.compareAtPriceCents,
    this.freeShippingThresholdCents,
    this.imageUrls = const <String>[],
  });

  final String id;
  final String vendorId;
  final Vendor? vendor;
  final String title;
  final int priceCents;
  final int? compareAtPriceCents;
  final int stock;
  final int shippingFeeCents;
  final int? freeShippingThresholdCents;
  final int estimatedDeliveryDays;
  final List<String> imageUrls;

  /// Ürün + kargo. Karşılaştırma sıralaması DAİMA bu değere göre yapılır:
  /// kullanıcının gerçekte ödeyeceği tutar budur.
  int get totalCostCents => priceCents + shippingFeeCents;

  bool get inStock => stock > 0;

  factory Offer.fromJson(Map<String, dynamic> json) {
    final dynamic rawVendor = json['vendor'];

    return Offer(
      id: json['id'] as String,
      vendorId: json['vendor_id'] as String,
      vendor: rawVendor is Map<String, dynamic>
          ? Vendor.fromJson(rawVendor)
          : null,
      title: json['title'] as String,
      priceCents: (json['price_cents'] as num).toInt(),
      compareAtPriceCents: (json['compare_at_price_cents'] as num?)?.toInt(),
      stock: (json['stock'] as num?)?.toInt() ?? 0,
      shippingFeeCents: (json['shipping_fee_cents'] as num?)?.toInt() ?? 0,
      freeShippingThresholdCents:
          (json['free_shipping_threshold_cents'] as num?)?.toInt(),
      estimatedDeliveryDays:
          (json['estimated_delivery_days'] as num?)?.toInt() ?? 3,
      imageUrls:
          (json['image_urls'] as List<dynamic>?)?.cast<String>() ??
              const <String>[],
    );
  }
}

/// Kanonik ürün — fiyat karşılaştırmasının birimi.
class ProductGroup {
  const ProductGroup({
    required this.id,
    required this.slug,
    required this.title,
    required this.offerCount,
    this.brand,
    this.imageUrl,
    this.description,
    this.minPriceCents,
    this.maxPriceCents,
    this.attributes = const <String, String>{},
    this.offers = const <Offer>[],
  });

  final String id;
  final String slug;
  final String title;
  final String? brand;
  final String? imageUrl;
  final String? description;
  final int offerCount;
  final int? minPriceCents;
  final int? maxPriceCents;
  final Map<String, String> attributes;
  final List<Offer> offers;

  /// Toplam maliyete göre sıralı teklifler; ilki en iyisidir.
  List<Offer> get sortedOffers {
    final List<Offer> sorted = List<Offer>.of(offers);
    sorted.sort((Offer a, Offer b) =>
        a.totalCostCents.compareTo(b.totalCostCents));
    return sorted;
  }

  /// En pahalı ile en ucuz teklif arasındaki fark — agregasyonun somut değeri.
  int get savingsCents {
    if (offers.length < 2) return 0;
    final List<Offer> sorted = sortedOffers;
    return sorted.last.totalCostCents - sorted.first.totalCostCents;
  }

  factory ProductGroup.fromJson(Map<String, dynamic> json) {
    return ProductGroup(
      id: json['id'] as String,
      slug: json['slug'] as String,
      title: json['title'] as String,
      brand: json['brand'] as String?,
      imageUrl: json['image_url'] as String?,
      description: json['description'] as String?,
      offerCount: (json['offer_count'] as num?)?.toInt() ?? 0,
      minPriceCents: (json['min_price_cents'] as num?)?.toInt(),
      maxPriceCents: (json['max_price_cents'] as num?)?.toInt(),
      attributes:
          (json['attributes'] as Map<String, dynamic>?)?.map<String, String>(
                (String key, dynamic value) =>
                    MapEntry<String, String>(key, value.toString()),
              ) ??
              const <String, String>{},
      offers: (json['offers'] as List<dynamic>?)
              ?.map((dynamic item) =>
                  Offer.fromJson(item as Map<String, dynamic>))
              .toList() ??
          const <Offer>[],
    );
  }
}

/// Arama sonucu kartı.
class SearchResult {
  const SearchResult({
    required this.groupId,
    required this.slug,
    required this.title,
    required this.offerCount,
    this.brand,
    this.imageUrl,
    this.minPriceCents,
    this.maxPriceCents,
    this.bestVendorName,
  });

  final String groupId;
  final String slug;
  final String title;
  final String? brand;
  final String? imageUrl;
  final int offerCount;
  final int? minPriceCents;
  final int? maxPriceCents;
  final String? bestVendorName;

  factory SearchResult.fromJson(Map<String, dynamic> json) {
    return SearchResult(
      groupId: json['group_id'] as String,
      slug: json['slug'] as String,
      title: json['title'] as String,
      brand: json['brand'] as String?,
      imageUrl: json['image_url'] as String?,
      offerCount: (json['offer_count'] as num?)?.toInt() ?? 0,
      minPriceCents: (json['min_price_cents'] as num?)?.toInt(),
      maxPriceCents: (json['max_price_cents'] as num?)?.toInt(),
      bestVendorName: json['best_vendor_name'] as String?,
    );
  }
}

/// Sepet kalemi. Fiyat yalnızca gösterim içindir; sipariş anında sunucu
/// tutarları veritabanından yeniden okur.
class CartItem {
  const CartItem({
    required this.productId,
    required this.title,
    required this.priceCents,
    required this.quantity,
    required this.vendorId,
    required this.vendorName,
    required this.shippingFeeCents,
    required this.estimatedDeliveryDays,
    required this.maxStock,
    this.freeShippingThresholdCents,
  });

  final String productId;
  final String title;
  final int priceCents;
  final int quantity;
  final String vendorId;
  final String vendorName;
  final int shippingFeeCents;
  final int? freeShippingThresholdCents;
  final int estimatedDeliveryDays;
  final int maxStock;

  int get lineTotalCents => priceCents * quantity;

  CartItem copyWith({int? quantity}) {
    return CartItem(
      productId: productId,
      title: title,
      priceCents: priceCents,
      quantity: quantity ?? this.quantity,
      vendorId: vendorId,
      vendorName: vendorName,
      shippingFeeCents: shippingFeeCents,
      freeShippingThresholdCents: freeShippingThresholdCents,
      estimatedDeliveryDays: estimatedDeliveryDays,
      maxStock: maxStock,
    );
  }
}

/// Sepetin tek bir taşerona düşen parçası (split-cart görünümü).
class CartVendorGroup {
  const CartVendorGroup({
    required this.vendorId,
    required this.vendorName,
    required this.items,
    required this.itemsSubtotalCents,
    required this.shippingCents,
    required this.estimatedDeliveryDays,
    this.freeShippingRemainingCents,
  });

  final String vendorId;
  final String vendorName;
  final List<CartItem> items;
  final int itemsSubtotalCents;
  final int shippingCents;
  final int? freeShippingRemainingCents;
  final int estimatedDeliveryDays;

  int get totalCents => itemsSubtotalCents + shippingCents;
}
