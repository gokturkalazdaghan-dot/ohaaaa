/// Biçimlendirme yardımcıları.
///
/// Web tarafındaki `@ohaaaa/shared/money` ile AYNI kuralları uygular:
/// tutarlar her katmanda kuruş cinsinden tam sayıdır, yalnızca gösterim
/// anında biçimlendirilir.
library;

/// Kuruşu Türkçe para biçimine çevirir.
///
/// `intl` paketine bağımlı olmamak için binlik ayırıcı elle uygulanır;
/// tek para birimi (TRY) desteklendiği sürece bu yeterlidir.
///
/// ```dart
/// formatMoney(5499900); // "54.999,00 ₺"
/// ```
String formatMoney(int cents) {
  final bool isNegative = cents < 0;
  final int absolute = cents.abs();

  final String lira = _groupThousands(absolute ~/ 100);
  final String kurus = (absolute % 100).toString().padLeft(2, '0');

  return '${isNegative ? '-' : ''}$lira,$kurus ₺';
}

/// Kısaltılmış gösterim — grafik eksenleri ve dar kartlar için.
String formatMoneyCompact(int cents) {
  final double lira = cents / 100;

  if (lira >= 1000000) {
    return '${(lira / 1000000).toStringAsFixed(1).replaceAll('.', ',')} Mn ₺';
  }
  if (lira >= 1000) {
    return '${(lira / 1000).toStringAsFixed(1).replaceAll('.', ',')} B ₺';
  }
  return formatMoney(cents);
}

/// İndirim yüzdesi; indirim yoksa null.
int? discountPercent(int priceCents, int? compareAtPriceCents) {
  if (compareAtPriceCents == null || compareAtPriceCents <= priceCents) {
    return null;
  }
  return (((compareAtPriceCents - priceCents) / compareAtPriceCents) * 100)
      .round();
}

String _groupThousands(int value) {
  final String digits = value.toString();
  final StringBuffer buffer = StringBuffer();

  for (int i = 0; i < digits.length; i++) {
    // Soldan sayarak her üç hanede bir ayırıcı koy.
    if (i > 0 && (digits.length - i) % 3 == 0) {
      buffer.write('.');
    }
    buffer.write(digits[i]);
  }

  return buffer.toString();
}
