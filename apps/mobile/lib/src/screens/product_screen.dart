import 'package:flutter/material.dart';

import '../api.dart';
import '../cart.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/product_thumb.dart';
import 'cart_screen.dart';

/// Ürün detayı ve mağaza karşılaştırma listesi.
///
/// Teklifler DAİMA kargo dahil toplam maliyete göre sıralanır. Etiket
/// fiyatına göre sıralamak yanıltıcı olurdu: kargo eklendiğinde sıra değişir.
class ProductScreen extends StatefulWidget {
  const ProductScreen({required this.api, required this.slug, super.key});

  final OhaaaaApi api;
  final String slug;

  @override
  State<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends State<ProductScreen> {
  late Future<ProductGroup?> _group;

  @override
  void initState() {
    super.initState();
    _group = widget.api.productGroup(widget.slug);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        actions: <Widget>[
          ListenableBuilder(
            listenable: cart,
            builder: (BuildContext context, Widget? child) => Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Badge(
                isLabelVisible: cart.itemCount > 0,
                backgroundColor: OhaaaaColors.oha,
                label: Text('${cart.itemCount}'),
                child: IconButton(
                  icon: const Icon(Icons.shopping_cart_outlined),
                  tooltip: 'Sepetim',
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => CartScreen(api: widget.api),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      body: FutureBuilder<ProductGroup?>(
        future: _group,
        builder: (
          BuildContext context,
          AsyncSnapshot<ProductGroup?> snapshot,
        ) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }

          final ProductGroup? group = snapshot.data;
          if (snapshot.hasError || group == null) {
            return const Center(child: Text('Ürün bulunamadı.'));
          }

          return _ProductBody(group: group);
        },
      ),
    );
  }
}

class _ProductBody extends StatelessWidget {
  const _ProductBody({required this.group});

  final ProductGroup group;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final List<Offer> offers = group.sortedOffers;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: <Widget>[
        ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: AspectRatio(
            aspectRatio: 1,
            child: ProductThumb(title: group.title),
          ),
        ),
        const SizedBox(height: 20),

        if (group.brand != null)
          Text(
            group.brand!.toUpperCase(),
            style: TextStyle(
              fontSize: 11,
              letterSpacing: 1,
              fontWeight: FontWeight.w700,
              color: theme.textTheme.bodySmall?.color,
            ),
          ),
        const SizedBox(height: 4),
        Text(
          group.title,
          style: theme.textTheme.displaySmall?.copyWith(fontSize: 24),
        ),

        if (group.description != null) ...<Widget>[
          const SizedBox(height: 12),
          Text(
            group.description!,
            style: theme.textTheme.bodySmall?.copyWith(height: 1.5),
          ),
        ],

        const SizedBox(height: 20),
        _ComparisonSummary(group: group),

        const SizedBox(height: 24),
        Text(
          'Mağaza fiyatları',
          style: theme.textTheme.titleLarge?.copyWith(fontSize: 18),
        ),
        const SizedBox(height: 4),
        Text(
          'Kargo dahil toplam maliyete göre sıralanmıştır.',
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 12),

        for (int i = 0; i < offers.length; i++) ...<Widget>[
          _OfferTile(offer: offers[i], isBest: i == 0),
          const SizedBox(height: 10),
        ],

        if (group.attributes.isNotEmpty) ...<Widget>[
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Özellikler', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 10),
                  ...group.attributes.entries.map(
                    (MapEntry<String, String> entry) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: <Widget>[
                          Text(entry.key, style: theme.textTheme.bodySmall),
                          Text(
                            entry.value,
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// Agregasyonun değerini tek bakışta özetleyen şerit.
class _ComparisonSummary extends StatelessWidget {
  const _ComparisonSummary({required this.group});

  final ProductGroup group;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final int savings = group.savingsCents;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    'Bu ürün ${group.offerCount} mağazada var',
                    style: theme.textTheme.bodySmall,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    group.minPriceCents != null
                        ? formatMoney(group.minPriceCents!)
                        : '—',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
            if (savings > 0)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: OhaaaaColors.success.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    Text(
                      'Doğru mağazayla',
                      style: TextStyle(
                        fontSize: 10,
                        color: OhaaaaColors.success.withValues(alpha: 0.85),
                      ),
                    ),
                    Text(
                      '${formatMoney(savings)} kazan',
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                        color: OhaaaaColors.success,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _OfferTile extends StatelessWidget {
  const _OfferTile({required this.offer, required this.isBest});

  final Offer offer;
  final bool isBest;

  void _addToCart(BuildContext context) {
    cart.add(
      CartItem(
        productId: offer.id,
        title: offer.title,
        priceCents: offer.priceCents,
        quantity: 1,
        vendorId: offer.vendorId,
        vendorName: offer.vendor?.displayName ?? 'Mağaza',
        shippingFeeCents: offer.shippingFeeCents,
        freeShippingThresholdCents: offer.freeShippingThresholdCents,
        estimatedDeliveryDays: offer.estimatedDeliveryDays,
        maxStock: offer.stock,
      ),
    );

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('${offer.title} sepete eklendi'),
        duration: const Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final int? percent =
        discountPercent(offer.priceCents, offer.compareAtPriceCents);

    return Container(
      decoration: BoxDecoration(
        color: isBest
            ? OhaaaaColors.success.withValues(alpha: 0.06)
            : theme.colorScheme.surface,
        border: Border.all(
          color: isBest
              ? OhaaaaColors.success.withValues(alpha: 0.45)
              : theme.colorScheme.outline,
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (isBest)
            Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: OhaaaaColors.success,
                borderRadius: BorderRadius.circular(999),
              ),
              child: const Text(
                'EN İYİ TOPLAM FİYAT',
                style: TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.5,
                  color: Colors.white,
                ),
              ),
            ),

          Row(
            children: <Widget>[
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  gradient: brandGradient,
                  borderRadius: BorderRadius.circular(10),
                ),
                alignment: Alignment.center,
                child: Text(
                  (offer.vendor?.displayName ?? '?').substring(0, 1),
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      offer.vendor?.displayName ?? 'Mağaza',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                    ),
                    Row(
                      children: <Widget>[
                        const Icon(
                          Icons.star,
                          size: 12,
                          color: OhaaaaColors.warning,
                        ),
                        const SizedBox(width: 3),
                        Text(
                          (offer.vendor?.rating ?? 0).toStringAsFixed(2),
                          style: theme.textTheme.labelSmall,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      if (percent != null) ...<Widget>[
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color:
                                OhaaaaColors.success.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(5),
                          ),
                          child: Text(
                            '%$percent',
                            style: const TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                              color: OhaaaaColors.success,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                      ],
                      Text(
                        formatMoney(offer.priceCents),
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                  Text(
                    'kargo dahil ${formatMoney(offer.totalCostCents)}',
                    style: theme.textTheme.labelSmall,
                  ),
                ],
              ),
            ],
          ),

          const SizedBox(height: 10),
          Row(
            children: <Widget>[
              Icon(
                Icons.local_shipping_outlined,
                size: 14,
                color: theme.textTheme.bodySmall?.color,
              ),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  offer.shippingFeeCents == 0
                      ? 'Ücretsiz kargo · ${offer.estimatedDeliveryDays} günde kargoda'
                      : 'Kargo ${formatMoney(offer.shippingFeeCents)} · '
                          '${offer.estimatedDeliveryDays} günde kargoda',
                  style: theme.textTheme.labelSmall,
                ),
              ),
              if (offer.stock > 0 && offer.stock <= 5)
                Text(
                  'Son ${offer.stock} adet!',
                  style: const TextStyle(
                    fontSize: 11,
                    color: OhaaaaColors.warning,
                    fontWeight: FontWeight.w600,
                  ),
                ),
            ],
          ),

          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: offer.inStock
                ? FilledButton.icon(
                    onPressed: () => _addToCart(context),
                    icon: const Icon(Icons.add_shopping_cart, size: 18),
                    label: const Text('Sepete ekle'),
                  )
                : const OutlinedButton(
                    onPressed: null,
                    child: Text('Tükendi'),
                  ),
          ),
        ],
      ),
    );
  }
}
