# Ohaaaa — Mobil (Flutter)

iOS ve Android için tek kod tabanlı istemci. Web arayüzüyle **aynı** alan
modelini, aynı split-cart kurallarını ve aynı tasarım tokenlarını kullanır.

## Çalıştırma

```sh
cd apps/mobile
flutter pub get
flutter run
```

Supabase yapılandırması **olmadan** uygulama yerleşik demo veriyle açılır —
`supabase/seed.sql` ve web'deki demo kümesiyle aynı ürünler.

Canlı veriye bağlamak için:

```sh
flutter run \
  --dart-define=SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=eyJhbGciOi...
```

> `--dart-define` kullanılır çünkü anahtarlar derleme zamanında gömülür ve
> `.env` dosyası uygulama paketine sızmaz. `anon` anahtarı zaten herkese
> açıktır; koruma RLS politikalarındadır, anahtarın gizliliğinde değil.

## Yapı

```
lib/
├── main.dart              Uygulama girişi ve tema seçimi
└── src/
    ├── api.dart           Supabase REST/RPC istemcisi (+ demo moduna düşüş)
    ├── cart.dart          Sepet durumu ve SPLIT-CART hesaplaması
    ├── demo_data.dart     seed.sql ile aynı örnek veri
    ├── format.dart        Kuruş → "54.999,00 ₺" biçimlendirme
    ├── models.dart        Alan modeli ve JSON ayrıştırma
    ├── theme.dart         Renk tokenları, açık/koyu tema
    ├── screens/           Ana sayfa, arama, ürün, sepet
    └── widgets/           Yeniden kullanılan parçalar
```

## Neden ek durum yönetimi paketi yok?

`ChangeNotifier` + `ListenableBuilder` bu ölçekte yeterlidir. `provider`,
`riverpod` veya `bloc` eklemek, tek bir sepet nesnesi için üç katman soyutlama
getirirdi. Tek harici bağımlılık `http`.

## Kritik değişmez (invariant)

`lib/src/cart.dart` içindeki kargo ve eşik kuralları, şu iki yerle **birebir**
aynı olmak zorundadır:

- `packages/shared/src/cart.ts` (web)
- `supabase/migrations/…_functions_triggers.sql` → `create_order()` (sunucu)

Biri saparsa, sepette gösterilen tutar ile tahsil edilen tutar ayrışır.
Kural değişikliği daima üçünde birden yapılmalıdır.
