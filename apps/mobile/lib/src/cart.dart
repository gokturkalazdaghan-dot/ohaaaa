/// Sepet durumu.
///
/// Split-cart hesaplaması web'deki `@ohaaaa/shared/cart` ve veritabanındaki
/// `create_order()` ile BİREBİR aynı kuralları uygular:
///   1. Kargo taşeron başına bir kez alınır (aynı koliden gönderim).
///   2. Taban ücret = kalemler içindeki EN YÜKSEK kargo ücreti.
///   3. Ücretsiz kargo eşiği = kalemler içindeki EN DÜŞÜK eşik (müşteri lehine).
///   4. Ara toplam eşiğe ulaşırsa kargo sıfırlanır.
///   5. Teslimat süresi = kalemler içindeki EN UZUN süre.
///
/// Üç platformdan biri bu kurallardan saparsa, sepette gösterilen tutar ile
/// tahsil edilen tutar ayrışır.
library;

import 'package:flutter/foundation.dart';

import 'models.dart';

class CartModel extends ChangeNotifier {
  final List<CartItem> _items = <CartItem>[];

  List<CartItem> get items => List<CartItem>.unmodifiable(_items);

  int get itemCount =>
      _items.fold<int>(0, (int sum, CartItem item) => sum + item.quantity);

  bool get isEmpty => _items.isEmpty;

  /// Sepete ekler; ürün zaten varsa adetleri birleştirir ve stoğu aşmaz.
  void add(CartItem incoming) {
    final int index = _items.indexWhere(
      (CartItem item) => item.productId == incoming.productId,
    );

    if (index == -1) {
      final int quantity = _clamp(incoming.quantity, incoming.maxStock);
      if (quantity > 0) _items.add(incoming.copyWith(quantity: quantity));
    } else {
      final int merged = _items[index].quantity + incoming.quantity;
      _items[index] = incoming.copyWith(
        quantity: _clamp(merged, incoming.maxStock),
      );
    }

    notifyListeners();
  }

  void setQuantity(String productId, int quantity) {
    if (quantity <= 0) {
      remove(productId);
      return;
    }

    final int index =
        _items.indexWhere((CartItem item) => item.productId == productId);
    if (index == -1) return;

    _items[index] = _items[index].copyWith(
      quantity: _clamp(quantity, _items[index].maxStock),
    );
    notifyListeners();
  }

  void remove(String productId) {
    _items.removeWhere((CartItem item) => item.productId == productId);
    notifyListeners();
  }

  void clear() {
    _items.clear();
    notifyListeners();
  }

  /// Sepeti taşeron bazında böler.
  List<CartVendorGroup> get groups {
    final Map<String, List<CartItem>> byVendor = <String, List<CartItem>>{};

    for (final CartItem item in _items) {
      byVendor.putIfAbsent(item.vendorId, () => <CartItem>[]).add(item);
    }

    final List<CartVendorGroup> result = <CartVendorGroup>[];

    byVendor.forEach((String vendorId, List<CartItem> vendorItems) {
      final int subtotal = vendorItems.fold<int>(
        0,
        (int sum, CartItem item) => sum + item.lineTotalCents,
      );

      // Kural 2.
      final int shippingBase = vendorItems.fold<int>(
        0,
        (int max, CartItem item) =>
            item.shippingFeeCents > max ? item.shippingFeeCents : max,
      );

      // Kural 3: eşiği tanımlı kalemler arasından en düşüğü.
      final List<int> thresholds = vendorItems
          .map((CartItem item) => item.freeShippingThresholdCents)
          .whereType<int>()
          .where((int threshold) => threshold > 0)
          .toList();

      final int? freeThreshold = thresholds.isEmpty
          ? null
          : thresholds.reduce((int a, int b) => a < b ? a : b);

      // Kural 4.
      final bool qualifies =
          freeThreshold != null && subtotal >= freeThreshold;
      final int shipping = qualifies ? 0 : shippingBase;

      // Kural 5.
      final int deliveryDays = vendorItems.fold<int>(
        0,
        (int max, CartItem item) =>
            item.estimatedDeliveryDays > max ? item.estimatedDeliveryDays : max,
      );

      result.add(
        CartVendorGroup(
          vendorId: vendorId,
          vendorName: vendorItems.first.vendorName,
          items: vendorItems,
          itemsSubtotalCents: subtotal,
          shippingCents: shipping,
          freeShippingRemainingCents:
              freeThreshold != null && !qualifies && shippingBase > 0
                  ? freeThreshold - subtotal
                  : null,
          estimatedDeliveryDays: deliveryDays,
        ),
      );
    });

    // Kararlı sıralama: en yüksek tutarlı taşeron üstte.
    result.sort((CartVendorGroup a, CartVendorGroup b) {
      final int byAmount =
          b.itemsSubtotalCents.compareTo(a.itemsSubtotalCents);
      return byAmount != 0 ? byAmount : a.vendorName.compareTo(b.vendorName);
    });

    return result;
  }

  int get itemsSubtotalCents => groups.fold<int>(
        0,
        (int sum, CartVendorGroup group) => sum + group.itemsSubtotalCents,
      );

  int get shippingTotalCents => groups.fold<int>(
        0,
        (int sum, CartVendorGroup group) => sum + group.shippingCents,
      );

  int get grandTotalCents => itemsSubtotalCents + shippingTotalCents;

  /// create_order() RPC'sinin beklediği yük.
  List<Map<String, dynamic>> toOrderPayload() {
    return _items
        .map<Map<String, dynamic>>((CartItem item) => <String, dynamic>{
              'product_id': item.productId,
              'quantity': item.quantity,
            })
        .toList();
  }

  static int _clamp(int quantity, int maxStock) {
    final int upperBound = maxStock < 999 ? maxStock : 999;
    if (quantity < 0) return 0;
    return quantity > upperBound ? upperBound : quantity;
  }
}

/// Uygulama genelinde tek sepet örneği.
///
/// Bu ölçekte bir bağımlılık enjeksiyon (DI) katmanı fazladan karmaşıklık
/// olurdu; ekranlar `ListenableBuilder` ile doğrudan bu örneği dinler.
final CartModel cart = CartModel();
