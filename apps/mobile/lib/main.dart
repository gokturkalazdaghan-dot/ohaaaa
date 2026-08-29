/// Ohaaaa mobil uygulaması.
///
/// Çalıştırma:
/// ```sh
/// cd apps/mobile
/// flutter pub get
/// flutter run
/// ```
///
/// Supabase yapılandırması olmadan uygulama demo veriyle açılır. Canlıya
/// bağlamak için:
/// ```sh
/// flutter run \
///   --dart-define=SUPABASE_URL=https://xxx.supabase.co \
///   --dart-define=SUPABASE_ANON_KEY=eyJhbGciOi...
/// ```
library;

import 'package:flutter/material.dart';

import 'src/api.dart';
import 'src/screens/home_screen.dart';
import 'src/theme.dart';

void main() {
  runApp(const OhaaaaApp());
}

class OhaaaaApp extends StatefulWidget {
  const OhaaaaApp({super.key});

  @override
  State<OhaaaaApp> createState() => _OhaaaaAppState();
}

class _OhaaaaAppState extends State<OhaaaaApp> {
  final OhaaaaApi _api = OhaaaaApi();

  @override
  void dispose() {
    _api.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Ohaaaa',
      debugShowCheckedModeBanner: false,
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      // Koyu tema ürünün birincil karakteridir; yine de sistem tercihine
      // uyulur — kullanıcının cihaz ayarını yok saymak kaba olurdu.
      themeMode: ThemeMode.system,
      home: HomeScreen(api: _api),
    );
  }
}
