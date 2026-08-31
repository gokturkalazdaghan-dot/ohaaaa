# Ohaaaa

**Çok satıcılı e-ticaret süper-agregatörü.** Aynı ürüne farklı mağazaların
verdiği teklifleri tek kartta toplar, **kargo dahil gerçek toplam maliyete**
göre sıralar ve farklı mağazalardan alınanları tek sepette birleştirir.

```
┌──────────────┐   x-api-key    ┌──────────────────┐
│  Taşeronlar  │ ─────────────▶ │  Taşeron API'si  │
│  (satıcılar) │  ürün beslemesi│  (Express 5)     │
└──────────────┘                └────────┬─────────┘
                                         │ service_role
                                ┌────────▼─────────┐
┌──────────────┐   SSR / RPC    │    PostgreSQL    │
│  Web (Next)  │ ─────────────▶ │    (Supabase)    │
│  Mobil (Flutter)              │  RLS + iş kuralı │
└──────────────┘                └──────────────────┘
```

## Hızlı başlangıç

```sh
npm install
npm run build --workspace @ohaaaa/shared   # paylaşılan paket önce derlenir
npm run dev                                # http://localhost:3000
```

**Supabase gerekmez.** Yapılandırma yoksa uygulama yerleşik demo veriyle
çalışır ve arayüzde "Demo modu" rozetiyle bunu açıkça belirtir. Böylece depoyu
klonlayan biri tek komutla dolu bir pazar yeri görür.

Canlıya bağlamak için `.env.example` dosyasını `.env` olarak kopyalayıp
doldurun, ardından migration'ları uygulayın:

```sh
supabase db reset          # migrations + seed
npm run dev:api            # (isteğe bağlı) Express API'si :4000 — üretimde
                           # kullanılmaz; uç noktalar web uygulamasında
```

## Depo yapısı

| Dizin | İçerik |
|---|---|
| `apps/web` | Next.js 16 (App Router) müşteri vitrini ve taşeron paneli |
| `apps/mobile` | Flutter iOS/Android istemcisi |
| `packages/backend` | Express 5 sürümü. **Üretimde kullanılmıyor**: uç noktalar `apps/web/src/app/api/v1/*` altında, siteyle aynı dağıtımda sunuluyor. |
| `packages/shared` | Ortak tipler, zod şemaları, para ve sepet mantığı |
| `supabase/migrations` | Şema, RLS politikaları, iş kuralı fonksiyonları |
| `supabase/tests` | SQL iddia testleri (split-cart, RLS) |
| `docs/` | Mimari kararlar |

## Üç temel tasarım kararı

### 1. İki katmanlı katalog

`product_groups` (kanonik ürün) ↔ `products` (taşeron teklifi).
Fiyat karşılaştırması ancak "aynı fiziksel ürün" tanımlanabilirse mümkündür.
Eşleştirme GTIN/barkod → normalize marka+başlık imzası sırasıyla yapılır;
eşleşme yoksa yeni kanonik ürün açılır.

### 2. Tutarlar her yerde kuruş (integer)

Float aritmetiği finansal hesapta yuvarlama hatası üretir. Tutarlar
veritabanı, API, web ve mobil boyunca `bigint`/`int` olarak taşınır ve
yalnızca gösterim anında biçimlendirilir. Komisyon **aşağı yuvarlanır**
(`floor`) — üç platformda da aynı kural.

### 3. Split-cart sunucuda hesaplanır

Bir müşteri siparişi taşeron bazında `vendor_orders` kayıtlarına bölünür.
Fiyat, kargo ve komisyon `create_order()` fonksiyonunda **veritabanından
yeniden okunarak** hesaplanır; istemciden gelen tutarlara asla güvenilmez.

Kargo kuralları üç yerde birebir aynıdır — biri saparsa sepette gösterilen
tutar ile tahsil edilen ayrışır:

| Katman | Dosya |
|---|---|
| Sunucu | `supabase/migrations/…_functions_triggers.sql` → `create_order()` |
| Web | `packages/shared/src/cart.ts` |
| Mobil | `apps/mobile/lib/src/cart.dart` |

### Tarayıcı doğrulaması

Birim testleri ve durum kodu kontrolleri bir arayüzün çalıştığını kanıtlamaz.
Öneri listesinin açıldığını, ok tuşlarıyla gezilebildiğini, Enter'ın doğru
yere gittiğini, mobilde yatay kaydırma olmadığını ve konsola hata düşmediğini
yalnızca gerçek bir tarayıcı gösterir.

```sh
cd apps/web
NEXT_PUBLIC_SITE_URL=https://www.ohaaaa.com npm run build
NEXT_PUBLIC_SITE_URL=https://www.ohaaaa.com npx next start -p 3137 &

npm run verify:browser          # arayüz akışları (31 kontrol)
npm run verify:a11y             # erişilebilirlik (axe-core, 9 sayfa)
```

Demo modunda (Supabase yapılandırılmamışken) çalışır; yerleşik veri kümesi
kontrollerin hepsini besler.

## Doğrulama

```sh
# SQL: migration'lar + split-cart + RLS testleri (gerçek bir PostgreSQL'e karşı)
DATABASE_URL=postgres://… ./scripts/verify-sql.sh

# TypeScript birim ve uçtan uca testleri
npm test

# Tip denetimi ve derleme
npm run typecheck && npm run build
```

`supabase/tests/20_rls_test.sql` şunları kanıtlar: anon taslak ürünleri ve
sipariş tablolarını göremez; bir taşeron başka bir taşeronun API anahtarlarını,
siparişlerini veya panel verisini okuyamaz; kullanıcı kendi rolünü ya da
komisyon oranını yükseltemez.

## Taşeron API'si

```sh
curl https://www.ohaaaa.com/api/v1/me -H "x-api-key: ohk_live_…"
```

Ayrıntı: [`docs/vendor-api.md`](docs/vendor-api.md) ve uygulama içindeki
`/tasoron/api` sayfası.

## Lisans

MIT

### Şemayı hizalama

Kod dağıtıldı ama migration uygulanmadıysa, yeni SQL fonksiyonlarını çağıran
yollar hata verir. Tek komutla kapatılır:

```sh
SUPABASE_DB_URL='postgresql://...' ./scripts/apply-migrations.sh
```

Yalnızca eksik olanları uygular; ayrıntılar `docs/operations.md` içinde.
