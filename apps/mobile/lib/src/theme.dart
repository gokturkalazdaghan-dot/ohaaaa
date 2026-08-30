/// Ohaaaa tasarım sistemi (mobil).
///
/// Renkler web'deki CSS tokenlarıyla birebir aynıdır; iki platformun aynı
/// markayı temsil etmesi için tek kaynaktan türetilmiştir.
library;

import 'package:flutter/material.dart';

abstract final class OhaaaaColors {
  // Koyu tema — ürünün birincil karakteri.
  static const Color bg = Color(0xFF0A0A0C);
  static const Color surface = Color(0xFF141419);
  static const Color surface2 = Color(0xFF1B1B22);
  static const Color line = Color(0xFF2A2A35);
  static const Color text = Color(0xFFF4F4F7);
  static const Color muted = Color(0xFF9A9AAB);
  static const Color subtle = Color(0xFF6B6B7C);

  // Marka
  static const Color brand = Color(0xFFA855F7);
  static const Color brandSoft = Color(0xFFC084FC);
  static const Color electric = Color(0xFF3B82F6);
  static const Color cyan = Color(0xFF22D3EE);

  /// "Ohaaaa!" vurgusu — fırsat ve aciliyet rengi.
  static const Color oha = Color(0xFFFF2E93);

  static const Color success = Color(0xFF22C55E);
  static const Color warning = Color(0xFFF59E0B);
  static const Color danger = Color(0xFFEF4444);

  // Açık tema karşılıkları
  static const Color lightBg = Color(0xFFFBFBFD);
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightSurface2 = Color(0xFFF4F4F7);
  static const Color lightLine = Color(0xFFE3E3EA);
  static const Color lightText = Color(0xFF0A0A0C);
  static const Color lightMuted = Color(0xFF5C5C6B);

  /// Beyaz zeminde kontrast için marka tonu bir kademe koyulaşır.
  static const Color lightBrand = Color(0xFF8B2FE0);
}

/// Marka gradyanı — logo, birincil düğmeler ve vurgu yüzeyleri.
const LinearGradient brandGradient = LinearGradient(
  begin: Alignment.centerLeft,
  end: Alignment.centerRight,
  colors: <Color>[OhaaaaColors.brand, OhaaaaColors.electric],
);

ThemeData buildDarkTheme() => _buildTheme(
      brightness: Brightness.dark,
      background: OhaaaaColors.bg,
      surface: OhaaaaColors.surface,
      surfaceVariant: OhaaaaColors.surface2,
      outline: OhaaaaColors.line,
      onSurface: OhaaaaColors.text,
      muted: OhaaaaColors.muted,
      primary: OhaaaaColors.brand,
    );

ThemeData buildLightTheme() => _buildTheme(
      brightness: Brightness.light,
      background: OhaaaaColors.lightBg,
      surface: OhaaaaColors.lightSurface,
      surfaceVariant: OhaaaaColors.lightSurface2,
      outline: OhaaaaColors.lightLine,
      onSurface: OhaaaaColors.lightText,
      muted: OhaaaaColors.lightMuted,
      primary: OhaaaaColors.lightBrand,
    );

ThemeData _buildTheme({
  required Brightness brightness,
  required Color background,
  required Color surface,
  required Color surfaceVariant,
  required Color outline,
  required Color onSurface,
  required Color muted,
  required Color primary,
}) {
  final ColorScheme scheme = ColorScheme.fromSeed(
    seedColor: primary,
    brightness: brightness,
  ).copyWith(
    primary: primary,
    secondary: OhaaaaColors.electric,
    surface: surface,
    onSurface: onSurface,
    surfaceContainerHighest: surfaceVariant,
    outline: outline,
    error: OhaaaaColors.danger,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: background,
    dividerColor: outline,

    appBarTheme: AppBarTheme(
      backgroundColor: background,
      surfaceTintColor: Colors.transparent,
      foregroundColor: onSurface,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),

    cardTheme: CardThemeData(
      color: surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: outline),
      ),
    ),

    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: outline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: outline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: primary, width: 2),
      ),
      hintStyle: TextStyle(color: muted),
    ),

    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: primary,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
        ),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
      ),
    ),

    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: onSurface,
        side: BorderSide(color: outline),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
        ),
      ),
    ),

    textTheme: TextTheme(
      displaySmall: TextStyle(
        color: onSurface,
        fontWeight: FontWeight.w900,
        letterSpacing: -0.5,
      ),
      titleLarge: TextStyle(color: onSurface, fontWeight: FontWeight.w800),
      titleMedium: TextStyle(color: onSurface, fontWeight: FontWeight.w700),
      bodyLarge: TextStyle(color: onSurface),
      bodyMedium: TextStyle(color: onSurface),
      bodySmall: TextStyle(color: muted),
      labelSmall: TextStyle(color: muted),
    ),
  );
}
