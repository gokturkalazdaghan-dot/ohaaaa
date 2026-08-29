/// Ohaaaa API istemcisi.
///
/// Supabase PostgREST/RPC uç noktalarını doğrudan kullanır; ek bir Dart SDK
/// bağımlılığı gerektirmez. Yapılandırma derleme zamanında verilir:
///
/// ```sh
/// flutter run \
///   --dart-define=SUPABASE_URL=https://xxx.supabase.co \
///   --dart-define=SUPABASE_ANON_KEY=eyJhbGciOi...
/// ```
///
/// Yapılandırma yoksa istemci DEMO moduna düşer ve web'dekiyle aynı örnek
/// veriyi döndürür — uygulama ilk çalıştırmada dolu görünür.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;

import 'demo_data.dart';
import 'models.dart';

class OhaaaaApiException implements Exception {
  OhaaaaApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => 'OhaaaaApiException($statusCode): $message';
}

class OhaaaaApi {
  OhaaaaApi({http.Client? client}) : _client = client ?? http.Client();

  static const String _supabaseUrl =
      String.fromEnvironment('SUPABASE_URL', defaultValue: '');
  static const String _supabaseAnonKey =
      String.fromEnvironment('SUPABASE_ANON_KEY', defaultValue: '');

  final http.Client _client;

  /// Supabase yapılandırılmamışsa demo veriye düşülür.
  static bool get isDemoMode =>
      !_supabaseUrl.startsWith('https://') || _supabaseAnonKey.length < 20;

  Map<String, String> get _headers => <String, String>{
        'apikey': _supabaseAnonKey,
        'Authorization': 'Bearer $_supabaseAnonKey',
        'Content-Type': 'application/json',
      };

  /// Arama — veritabanındaki `search_products` fonksiyonunu çağırır.
  Future<List<SearchResult>> search({
    String? query,
    String sort = 'relevance',
    int limit = 24,
  }) async {
    if (isDemoMode) return demoSearch(query: query, sort: sort, limit: limit);

    final http.Response response = await _client.post(
      Uri.parse('$_supabaseUrl/rest/v1/rpc/search_products'),
      headers: _headers,
      body: jsonEncode(<String, dynamic>{
        'p_query': query,
        'p_sort': sort,
        'p_limit': limit,
      }),
    );

    final List<dynamic> rows = _decodeList(response, 'Arama başarısız');
    return rows
        .map((dynamic row) =>
            SearchResult.fromJson(row as Map<String, dynamic>))
        .toList();
  }

  /// Ürün detayı — kanonik ürün ve tüm teklifleri.
  Future<ProductGroup?> productGroup(String slug) async {
    if (isDemoMode) return demoProductGroup(slug);

    // PostgREST gömülü kaynak (embedded resource) sözdizimi.
    const String select =
        'id,slug,title,brand,image_url,description,attributes,offer_count,'
        'min_price_cents,max_price_cents,'
        'offers:products(id,vendor_id,title,image_urls,price_cents,'
        'compare_at_price_cents,stock,shipping_fee_cents,'
        'free_shipping_threshold_cents,estimated_delivery_days,'
        'vendor:vendors(id,slug,display_name,logo_url,rating))';

    final Uri uri = Uri.parse('$_supabaseUrl/rest/v1/product_groups').replace(
      queryParameters: <String, String>{
        'select': select,
        'slug': 'eq.$slug',
        'offers.status': 'eq.active',
        'limit': '1',
      },
    );

    final http.Response response = await _client.get(uri, headers: _headers);
    final List<dynamic> rows = _decodeList(response, 'Ürün okunamadı');

    if (rows.isEmpty) return null;
    return ProductGroup.fromJson(rows.first as Map<String, dynamic>);
  }

  /// Sipariş oluşturma — split-cart mantığı SUNUCUDA çalışır.
  ///
  /// İstemci yalnızca (ürün, adet) çiftlerini gönderir; fiyat, kargo ve
  /// komisyon veritabanında yeniden hesaplanır.
  Future<Map<String, dynamic>> createOrder({
    required List<Map<String, dynamic>> items,
    required String email,
    required Map<String, dynamic> shippingAddress,
    String? accessToken,
  }) async {
    if (isDemoMode) {
      return demoCreateOrder(items);
    }

    final http.Response response = await _client.post(
      Uri.parse('$_supabaseUrl/rest/v1/rpc/create_order'),
      headers: <String, String>{
        ..._headers,
        // Oturum açmış kullanıcı varsa RLS onun kimliğiyle değerlendirilir.
        if (accessToken != null) 'Authorization': 'Bearer $accessToken',
      },
      body: jsonEncode(<String, dynamic>{
        'p_items': items,
        'p_email': email,
        'p_shipping_address': shippingAddress,
      }),
    );

    if (response.statusCode >= 400) {
      throw OhaaaaApiException(
        _readableError(response.body),
        statusCode: response.statusCode,
      );
    }

    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  void dispose() => _client.close();

  List<dynamic> _decodeList(http.Response response, String context) {
    if (response.statusCode >= 400) {
      throw OhaaaaApiException(
        '$context: ${_readableError(response.body)}',
        statusCode: response.statusCode,
      );
    }

    final dynamic decoded = jsonDecode(response.body);
    return decoded is List<dynamic> ? decoded : <dynamic>[decoded];
  }

  /// Veritabanı, iş kuralı ihlallerini `OHAAAA_KOD: mesaj` biçiminde
  /// fırlatır. Bu mesajlar kullanıcıya gösterilebilir; diğerleri gösterilmez.
  String _readableError(String body) {
    try {
      final Map<String, dynamic> decoded =
          jsonDecode(body) as Map<String, dynamic>;
      final String message = (decoded['message'] ?? '').toString();

      final RegExpMatch? match =
          RegExp(r'OHAAAA_[A-Z_]+:\s*(.+)$').firstMatch(message);

      if (match != null) return match.group(1)!;
      return 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
    } catch (_) {
      return 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
    }
  }
}
