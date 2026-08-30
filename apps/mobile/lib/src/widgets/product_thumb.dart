import 'package:flutter/material.dart';

/// Ürün görseli yer tutucusu.
///
/// Renk, başlıktan türetilen kararlı bir tondur — rastgele DEĞİLDİR: aynı
/// ürün her açılışta aynı görünmelidir, aksi halde liste titrek algılanır.
class ProductThumb extends StatelessWidget {
  const ProductThumb({required this.title, this.size, super.key});

  final String title;
  final double? size;

  @override
  Widget build(BuildContext context) {
    int hash = 0;
    for (final int unit in title.codeUnits) {
      hash = (hash * 31 + unit) % 360;
    }

    final HSLColor base = HSLColor.fromAHSL(1, hash.toDouble(), 0.65, 0.22);
    final HSLColor accent =
        HSLColor.fromAHSL(1, ((hash + 45) % 360).toDouble(), 0.6, 0.12);

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[base.toColor(), accent.toColor()],
        ),
      ),
      alignment: Alignment.center,
      child: Text(
        title.isEmpty ? '?' : title.substring(0, 1).toUpperCase(),
        style: TextStyle(
          fontSize: (size ?? 96) * 0.32,
          fontWeight: FontWeight.w900,
          color: Colors.white.withValues(alpha: 0.85),
        ),
      ),
    );
  }
}
