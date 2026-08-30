import 'package:flutter/material.dart';

import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'product_thumb.dart';

/// Arama sonucu kartı.
///
/// Karşılaştırma vaadi kartın üzerinde görünür: kaç mağazada bulunduğu ve
/// en ucuzu kimin verdiği, ürüne girmeden okunabilir.
class ProductCard extends StatelessWidget {
  const ProductCard({required this.result, required this.onTap, super.key});

  final SearchResult result;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    final bool hasSpread = result.minPriceCents != null &&
        result.maxPriceCents != null &&
        result.maxPriceCents! > result.minPriceCents!;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Stack(
              children: <Widget>[
                AspectRatio(
                  aspectRatio: 4 / 3,
                  child: ProductThumb(title: result.title),
                ),
                if (result.offerCount > 1)
                  Positioned(
                    left: 10,
                    top: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: theme.scaffoldBackgroundColor
                            .withValues(alpha: 0.85),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: theme.colorScheme.outline),
                      ),
                      child: Text(
                        '${result.offerCount} mağaza',
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  if (result.brand != null)
                    Text(
                      result.brand!.toUpperCase(),
                      style: TextStyle(
                        fontSize: 10,
                        letterSpacing: 0.8,
                        fontWeight: FontWeight.w700,
                        color: theme.textTheme.bodySmall?.color,
                      ),
                    ),
                  const SizedBox(height: 2),
                  Text(
                    result.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      height: 1.3,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: <Widget>[
                      Text(
                        'en ucuz ',
                        style: TextStyle(
                          fontSize: 11,
                          color: theme.textTheme.bodySmall?.color,
                        ),
                      ),
                      Flexible(
                        child: Text(
                          result.minPriceCents != null
                              ? formatMoney(result.minPriceCents!)
                              : '—',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (hasSpread)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        '${formatMoney(result.maxPriceCents! - result.minPriceCents!)} tasarruf',
                        style: const TextStyle(
                          fontSize: 11,
                          color: OhaaaaColors.success,
                        ),
                      ),
                    ),
                  if (result.bestVendorName != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(
                        children: <Widget>[
                          Icon(
                            Icons.storefront_outlined,
                            size: 13,
                            color: theme.textTheme.bodySmall?.color,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              result.bestVendorName!,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11,
                                color: theme.textTheme.bodySmall?.color,
                              ),
                            ),
                          ),
                        ],
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
