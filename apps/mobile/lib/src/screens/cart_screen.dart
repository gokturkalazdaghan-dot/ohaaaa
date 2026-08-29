import 'package:flutter/material.dart';

import '../api.dart';
import '../cart.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';

/// Sepet ve ödeme (simülasyon) ekranı.
///
/// Sepet taşeron bazında GRUPLANMIŞ gösterilir: "3 ürün aldım ama 2 ayrı
/// kargo geliyor" bilgisi ödeme adımında sürpriz olmamalıdır.
class CartScreen extends StatefulWidget {
  const CartScreen({required this.api, super.key});

  final OhaaaaApi api;

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  bool _submitting = false;
  String? _orderNumber;

  Future<void> _checkout() async {
    setState(() => _submitting = true);

    try {
      // Yalnızca (ürün, adet) gönderilir; tutarlar sunucuda hesaplanır.
      final Map<String, dynamic> order = await widget.api.createOrder(
        items: cart.toOrderPayload(),
        email: 'musteri@ornek.com',
        shippingAddress: const <String, dynamic>{
          'full_name': 'Zeynep Yılmaz',
          'city': 'İstanbul',
          'district': 'Kadıköy',
          'address_line': 'Örnek Mah. Test Sk. No:1',
        },
      );

      if (!mounted) return;
      setState(() {
        _orderNumber = order['order_number']?.toString();
        _submitting = false;
      });
      cart.clear();
    } on OhaaaaApiException catch (error) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.message),
          backgroundColor: OhaaaaColors.danger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sepetim')),
      body: _orderNumber != null
          ? _OrderSuccess(orderNumber: _orderNumber!)
          : ListenableBuilder(
              listenable: cart,
              builder: (BuildContext context, Widget? child) {
                if (cart.isEmpty) return const _EmptyCart();
                return _CartBody(
                  submitting: _submitting,
                  onCheckout: _checkout,
                );
              },
            ),
    );
  }
}

class _CartBody extends StatelessWidget {
  const _CartBody({required this.submitting, required this.onCheckout});

  final bool submitting;
  final VoidCallback onCheckout;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final List<CartVendorGroup> groups = cart.groups;

    return Column(
      children: <Widget>[
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: <Widget>[
              if (groups.length > 1)
                Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: OhaaaaColors.electric.withValues(alpha: 0.1),
                    border: Border.all(
                      color: OhaaaaColors.electric.withValues(alpha: 0.25),
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    'Siparişiniz ${groups.length} mağazaya bölünecek ve '
                    '${groups.length} ayrı kargo ile gelecek.',
                    style: const TextStyle(
                      fontSize: 12,
                      color: OhaaaaColors.electric,
                    ),
                  ),
                ),
              for (final CartVendorGroup group in groups) ...<Widget>[
                _VendorGroupCard(group: group),
                const SizedBox(height: 12),
              ],
            ],
          ),
        ),

        // Özet çubuğu — her zaman görünür.
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            border: Border(top: BorderSide(color: theme.colorScheme.outline)),
          ),
          child: SafeArea(
            top: false,
            child: Column(
              children: <Widget>[
                _SummaryRow(
                  label: 'Ara toplam',
                  value: formatMoney(cart.itemsSubtotalCents),
                ),
                _SummaryRow(
                  label: 'Kargo (${groups.length} gönderi)',
                  value: cart.shippingTotalCents == 0
                      ? 'Ücretsiz'
                      : formatMoney(cart.shippingTotalCents),
                ),
                const Divider(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    const Text(
                      'Toplam',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      formatMoney(cart.grandTotalCents),
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: submitting ? null : onCheckout,
                    child: Text(
                      submitting
                          ? 'İşleniyor…'
                          : '${formatMoney(cart.grandTotalCents)} öde',
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Ödeme simülasyonudur; gerçek tahsilat yapılmaz.',
                  style: theme.textTheme.labelSmall,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _VendorGroupCard extends StatelessWidget {
  const _VendorGroupCard({required this.group});

  final CartVendorGroup group;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                const Icon(
                  Icons.storefront_outlined,
                  size: 16,
                  color: OhaaaaColors.brandSoft,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    group.vendorName,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                  ),
                ),
                Text(
                  '${group.estimatedDeliveryDays} günde kargoda',
                  style: theme.textTheme.labelSmall,
                ),
              ],
            ),
            const Divider(height: 20),

            for (final CartItem item in group.items)
              _CartItemRow(item: item),

            const Divider(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                Text(
                  group.shippingCents == 0
                      ? 'Ücretsiz kargo'
                      : 'Kargo ${formatMoney(group.shippingCents)}',
                  style: TextStyle(
                    fontSize: 12,
                    color: group.shippingCents == 0
                        ? OhaaaaColors.success
                        : theme.textTheme.bodySmall?.color,
                  ),
                ),
                Text(
                  formatMoney(group.totalCents),
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
              ],
            ),

            if (group.freeShippingRemainingCents != null)
              Container(
                margin: const EdgeInsets.only(top: 10),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: OhaaaaColors.brand.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${formatMoney(group.freeShippingRemainingCents!)} daha '
                  'ekleyin, kargo bedava olsun.',
                  style: const TextStyle(
                    fontSize: 11,
                    color: OhaaaaColors.brandSoft,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _CartItemRow extends StatelessWidget {
  const _CartItemRow({required this.item});

  final CartItem item;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  item.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
                const SizedBox(height: 6),
                Row(
                  children: <Widget>[
                    _QuantityButton(
                      icon: Icons.remove,
                      onTap: () => cart.setQuantity(
                        item.productId,
                        item.quantity - 1,
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Text(
                        '${item.quantity}',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    _QuantityButton(
                      icon: Icons.add,
                      onTap: item.quantity >= item.maxStock
                          ? null
                          : () => cart.setQuantity(
                                item.productId,
                                item.quantity + 1,
                              ),
                    ),
                    const SizedBox(width: 8),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      iconSize: 18,
                      icon: const Icon(Icons.delete_outline),
                      tooltip: 'Sepetten çıkar',
                      onPressed: () => cart.remove(item.productId),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Text(
            formatMoney(item.lineTotalCents),
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

class _QuantityButton extends StatelessWidget {
  const _QuantityButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        width: 28,
        height: 28,
        decoration: BoxDecoration(
          border: Border.all(color: Theme.of(context).colorScheme.outline),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(
          icon,
          size: 15,
          color: onTap == null
              ? Theme.of(context).disabledColor
              : Theme.of(context).colorScheme.onSurface,
        ),
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          Text(value, style: const TextStyle(fontSize: 13)),
        ],
      ),
    );
  }
}

class _EmptyCart extends StatelessWidget {
  const _EmptyCart();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.shopping_cart_outlined, size: 40),
            const SizedBox(height: 14),
            const Text(
              'Sepetiniz boş',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
            ),
            const SizedBox(height: 6),
            Text(
              'Aradığınız ürünü onlarca mağazada karşılaştırın, '
              'en ucuzunu sepete ekleyin.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _OrderSuccess extends StatelessWidget {
  const _OrderSuccess({required this.orderNumber});

  final String orderNumber;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: OhaaaaColors.success.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(18),
              ),
              child: const Icon(
                Icons.check,
                size: 34,
                color: OhaaaaColors.success,
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'Siparişiniz alındı!',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 8),
            Text(
              'Sipariş numaranız: $orderNumber',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 24),
            OutlinedButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Alışverişe devam et'),
            ),
          ],
        ),
      ),
    );
  }
}
