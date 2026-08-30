import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import '../widgets/product_card.dart';
import 'product_screen.dart';

/// Arama ekranı.
///
/// Arama, yazma durduktan 350 ms sonra tetiklenir (debounce): her tuş
/// vuruşunda istek atmak hem ağ hem de veritabanı için gereksiz yüktür.
class SearchScreen extends StatefulWidget {
  const SearchScreen({required this.api, this.initialQuery, super.key});

  final OhaaaaApi api;
  final String? initialQuery;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  static const Duration _debounce = Duration(milliseconds: 350);

  late final TextEditingController _controller =
      TextEditingController(text: widget.initialQuery ?? '');

  Timer? _debounceTimer;
  List<SearchResult> _results = const <SearchResult>[];
  bool _loading = false;
  String? _error;
  String _sort = 'relevance';

  /// Yalnızca en son isteğin sonucu gösterilir: yavaş bir önceki yanıt,
  /// yeni sorgunun sonucunu ezmemeli (race condition).
  int _requestId = 0;

  @override
  void initState() {
    super.initState();
    _runSearch();
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onQueryChanged(String _) {
    // Temizle düğmesinin görünürlüğü metne bağlı; bekletmeden yenile.
    setState(() {});
    _debounceTimer?.cancel();
    _debounceTimer = Timer(_debounce, _runSearch);
  }

  Future<void> _runSearch() async {
    final int currentRequest = ++_requestId;

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final List<SearchResult> results = await widget.api.search(
        query: _controller.text.trim().isEmpty ? null : _controller.text.trim(),
        sort: _sort,
        limit: 48,
      );

      if (!mounted || currentRequest != _requestId) return;
      setState(() {
        _results = results;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || currentRequest != _requestId) return;
      setState(() {
        _error = 'Arama yapılamadı. Bağlantınızı kontrol edin.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Padding(
          padding: const EdgeInsets.only(right: 16),
          child: TextField(
            controller: _controller,
            autofocus: widget.initialQuery == null,
            textInputAction: TextInputAction.search,
            onChanged: _onQueryChanged,
            onSubmitted: (_) => _runSearch(),
            decoration: InputDecoration(
              hintText: 'Ürün ara…',
              prefixIcon: const Icon(Icons.search, size: 20),
              isDense: true,
              suffixIcon: _controller.text.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () {
                        _controller.clear();
                        _runSearch();
                      },
                    ),
            ),
          ),
        ),
      ),
      body: Column(
        children: <Widget>[
          _SortBar(
            sort: _sort,
            onChanged: (String value) {
              setState(() => _sort = value);
              _runSearch();
            },
          ),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading && _results.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.cloud_off_outlined, size: 32),
            const SizedBox(height: 12),
            Text(_error!, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: _runSearch,
              child: const Text('Tekrar dene'),
            ),
          ],
        ),
      );
    }

    if (_results.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            const Icon(Icons.search_off, size: 36),
            const SizedBox(height: 12),
            const Text(
              'Sonuç bulunamadı',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(
              'Türkçe karakter kullanmanız gerekmez — “kulaklik” de '
              '“kulaklık” sonuçlarını getirir.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      );
    }

    return GridView.builder(
      padding: const EdgeInsets.all(16),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 0.62,
      ),
      itemCount: _results.length,
      itemBuilder: (BuildContext context, int index) {
        final SearchResult result = _results[index];
        return ProductCard(
          result: result,
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => ProductScreen(api: widget.api, slug: result.slug),
            ),
          ),
        );
      },
    );
  }
}

class _SortBar extends StatelessWidget {
  const _SortBar({required this.sort, required this.onChanged});

  final String sort;
  final ValueChanged<String> onChanged;

  static const Map<String, String> _options = <String, String>{
    'relevance': 'En uygun',
    'price_asc': 'Artan fiyat',
    'price_desc': 'Azalan fiyat',
    'offers': 'En çok mağaza',
  };

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        children: _options.entries
            .map(
              (MapEntry<String, String> entry) => Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text(
                    entry.value,
                    style: const TextStyle(fontSize: 12),
                  ),
                  selected: sort == entry.key,
                  onSelected: (_) => onChanged(entry.key),
                ),
              ),
            )
            .toList(),
      ),
    );
  }
}
