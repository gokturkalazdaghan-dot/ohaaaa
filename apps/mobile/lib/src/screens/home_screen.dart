import 'package:flutter/material.dart';

import '../api.dart';
import '../cart.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/product_card.dart';
import 'cart_screen.dart';
import 'product_screen.dart';
import 'search_screen.dart';

/// Ana ekran: devasa arama alanı ve öne çıkan karşılaştırmalar.
class HomeScreen extends StatefulWidget {
  const HomeScreen({required this.api, super.key});

  final OhaaaaApi api;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<List<SearchResult>> _trending;

  @override
  void initState() {
    super.initState();
    _trending = widget.api.search(sort: 'offers', limit: 10);
  }

  void _openSearch([String? query]) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SearchScreen(api: widget.api, initialQuery: query),
      ),
    );
  }

  void _openProduct(String slug) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProductScreen(api: widget.api, slug: slug),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: <Widget>[
            SliverAppBar(
              floating: true,
              titleSpacing: 16,
              title: const _Logo(),
              actions: <Widget>[
                // Sepet rozeti, sepet değiştikçe kendini yeniler.
                ListenableBuilder(
                  listenable: cart,
                  builder: (BuildContext context, Widget? child) {
                    return Padding(
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
                    );
                  },
                ),
              ],
            ),

            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    if (OhaaaaApi.isDemoMode) const _DemoBanner(),
                    const SizedBox(height: 8),
                    Text(
                      'Aynı ürün,\nonlarca mağaza.',
                      style: theme.textTheme.displaySmall?.copyWith(
                        fontSize: 32,
                        height: 1.1,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Kargo dahil gerçek toplam maliyeti karşılaştır, '
                      'farklı mağazalardan aldıklarını tek sepette birleştir.',
                      style: theme.textTheme.bodySmall?.copyWith(height: 1.45),
                    ),
                    const SizedBox(height: 20),
                    _SearchField(onTap: _openSearch),
                    const SizedBox(height: 14),
                    _SuggestionChips(onSelected: _openSearch),
                    const SizedBox(height: 28),
                    Text(
                      'En çok karşılaştırılanlar',
                      style: theme.textTheme.titleLarge?.copyWith(fontSize: 20),
                    ),
                    const SizedBox(height: 12),
                  ],
                ),
              ),
            ),

            FutureBuilder<List<SearchResult>>(
              future: _trending,
              builder: (
                BuildContext context,
                AsyncSnapshot<List<SearchResult>> snapshot,
              ) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 48),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                  );
                }

                if (snapshot.hasError) {
                  return SliverToBoxAdapter(
                    child: _ErrorNotice(
                      message: 'Ürünler yüklenemedi.',
                      onRetry: () => setState(() {
                        _trending =
                            widget.api.search(sort: 'offers', limit: 10);
                      }),
                    ),
                  );
                }

                final List<SearchResult> results =
                    snapshot.data ?? const <SearchResult>[];

                return SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
                  sliver: SliverGrid(
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 12,
                      childAspectRatio: 0.62,
                    ),
                    delegate: SliverChildBuilderDelegate(
                      (BuildContext context, int index) {
                        final SearchResult result = results[index];
                        return ProductCard(
                          result: result,
                          onTap: () => _openProduct(result.slug),
                        );
                      },
                      childCount: results.length,
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _Logo extends StatelessWidget {
  const _Logo();

  @override
  Widget build(BuildContext context) {
    final Color base = Theme.of(context).colorScheme.onSurface;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            gradient: brandGradient,
            borderRadius: BorderRadius.circular(10),
          ),
          alignment: Alignment.center,
          child: const Text(
            'O',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
              fontSize: 17,
            ),
          ),
        ),
        const SizedBox(width: 8),
        // "aaa" markanın karakteridir: gradyanla vurgulanır.
        Text.rich(
          TextSpan(
            style: TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.4,
              color: base,
            ),
            children: const <TextSpan>[
              TextSpan(text: 'Oh'),
              TextSpan(
                text: 'aaa',
                style: TextStyle(color: OhaaaaColors.brandSoft),
              ),
              TextSpan(text: 'a!', style: TextStyle(color: OhaaaaColors.oha)),
            ],
          ),
        ),
      ],
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.onTap});

  final void Function([String?]) onTap;

  @override
  Widget build(BuildContext context) {
    // Gerçek bir metin alanı değil: dokunulduğunda arama ekranına geçer.
    // Böylece ana ekranda klavye açılıp düzeni bozmaz.
    return GestureDetector(
      onTap: () => onTap(),
      child: Container(
        padding: const EdgeInsets.all(2),
        decoration: BoxDecoration(
          gradient: brandGradient,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: <Widget>[
              const Icon(Icons.search, size: 22),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Ne arıyorsun?',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SuggestionChips extends StatelessWidget {
  const _SuggestionChips({required this.onSelected});

  final void Function([String?]) onSelected;

  static const List<String> _suggestions = <String>[
    'iPhone 15',
    'kulaklık',
    'airfryer',
    'koşu ayakkabısı',
  ];

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _suggestions
          .map(
            (String suggestion) => ActionChip(
              label: Text(suggestion, style: const TextStyle(fontSize: 12)),
              onPressed: () => onSelected(suggestion),
            ),
          )
          .toList(),
    );
  }
}

class _DemoBanner extends StatelessWidget {
  const _DemoBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: OhaaaaColors.warning.withValues(alpha: 0.1),
        border: Border.all(
          color: OhaaaaColors.warning.withValues(alpha: 0.3),
        ),
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Row(
        children: <Widget>[
          Icon(Icons.info_outline, size: 16, color: OhaaaaColors.warning),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              'Demo modu — yerleşik örnek veri gösteriliyor.',
              style: TextStyle(fontSize: 12, color: OhaaaaColors.warning),
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorNotice extends StatelessWidget {
  const _ErrorNotice({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        children: <Widget>[
          const Icon(Icons.cloud_off_outlined, size: 32),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: onRetry, child: const Text('Tekrar dene')),
        ],
      ),
    );
  }
}
