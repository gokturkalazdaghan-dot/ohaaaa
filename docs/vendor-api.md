# Taşeron API'si

REST, JSON ve tek bir başlık. Temel adres **sitenin kendi adresidir**:
`https://www.ohaaaa.com` (yerelde `http://localhost:3000`).

> API ayrı bir servis değildir. Uç noktalar siteyle aynı dağıtımda,
> `/api/v1/*` altında sunulur — ayrı bir alan adı, ayrı bir dağıtım ve CORS
> ayarı gerekmez.

## Kimlik doğrulama

Her isteğe `x-api-key` başlığını ekleyin (`Authorization: Bearer …` de kabul
edilir):

```sh
curl https://www.ohaaaa.com/api/v1/me \
  -H "x-api-key: ohk_live_9f2c1a7b3d4e5f60_…"
```

Anahtarınız yalnızca oluşturulduğu anda gösterilir; veritabanında yalnızca
SHA-256 özeti saklanır. Kaybedilirse kurtarılamaz — panelden yenisini üretip
eskisini iptal edin.

### Yetkiler (scope)

| Yetki | İzin verdiği işlem |
|---|---|
| `products:read` | Kataloğu listeleme |
| `products:write` | Ürün ekleme, güncelleme, arşivleme |
| `orders:read` | Siparişleri okuma |
| `orders:write` | Sipariş durumu ve kargo bilgisi güncelleme |

En az yetki ilkesini uygulayın: yalnızca ürün besleyen bir entegrasyona
`orders:write` vermeyin.

## Hız sınırı

Varsayılan: anahtar başına **dakikada 600 istek** (kayan pencere).
Her yanıt şu başlıkları taşır:

```
x-ratelimit-limit: 600
x-ratelimit-remaining: 597
x-ratelimit-reset: 1788012345
```

Sınır aşıldığında `429` ve `retry-after` (saniye) döner.

## Hata biçimi

```json
{
  "error": {
    "code": "validation_failed",
    "message": "İstek gövdesi doğrulanamadı.",
    "details": [
      { "path": "products.0.price_cents", "message": "Tutar negatif olamaz" }
    ],
    "request_id": "3f2a8c14-…"
  }
}
```

Entegrasyonunuzu insan tarafından okunan `message` alanına değil, sabit
`code` alanına göre kurun. Destek talebinde `request_id` iletin.

| `code` | HTTP | Anlamı |
|---|---|---|
| `unauthorized` | 401 | Anahtar yok, geçersiz, iptal edilmiş veya süresi dolmuş |
| `forbidden` | 403 | Yetki yetersiz veya taşeron onaylı değil |
| `not_found` | 404 | Kayıt yok |
| `conflict` | 409 | Geçersiz durum geçişi |
| `validation_failed` | 422 | Gövde/parametre doğrulanamadı |
| `rate_limited` | 429 | Hız sınırı aşıldı |
| `internal_error` | 500 | Sunucu hatası |

---

## Uç noktalar

### `GET /api/v1/me`

Anahtarın hangi taşerona ait olduğunu ve yetkilerini döner. Entegrasyonu
doğrulamak için ilk çağıracağınız adres.

### `POST /api/v1/products` — `products:write`

Toplu besleme, en fazla **500 kalem**. **İdempotenttir:** aynı `external_id`
ile tekrar gönderim mevcut kaydı günceller, mükerrer kayıt oluşturmaz.

```json
{
  "products": [
    {
      "external_id": "SKU-12345",
      "title": "Apple iPhone 15 128GB Siyah",
      "gtin": "0195949038204",
      "brand": "Apple",
      "category_slug": "telefon",
      "price_cents": 5499900,
      "compare_at_price_cents": 6299900,
      "stock": 42,
      "shipping_fee_cents": 0,
      "free_shipping_threshold_cents": 50000,
      "estimated_delivery_days": 1,
      "image_urls": ["https://cdn.magazaniz.com/iphone15.jpg"],
      "status": "active"
    }
  ],
  "archive_missing": false
}
```

> **Tutarlar kuruş cinsindendir.** `5499900` = 54.999,00 ₺.

`archive_missing: true` gönderirseniz bu istekte yer **almayan** ürünleriniz
arşivlenir (tam senkron). Sayfalayarak besliyorsanız `false` bırakın, aksi
halde her sayfa bir öncekini arşivler.

Yanıt:

```json
{ "data": { "received": 1, "created": 0, "updated": 1, "archived": 0, "failed": [] } }
```

### `GET /api/v1/products` — `products:read`

Parametreler: `limit` (≤200), `offset`, `status`, `q`.

### `PATCH /api/v1/products/{external_id}` — `products:write`

Kısmi güncelleme. Yalnızca fiyat/stok değiştiğinde tüm beslemeyi göndermek
yerine bunu kullanın:

```json
{ "price_cents": 5299900, "stock": 37 }
```

### `DELETE /api/v1/products/{external_id}` — `products:write`

Ürünü **arşivler**, fiziksel olarak silmez: geçmiş siparişlerin kalem
kayıtları korunur ve yanlışlıkla silinen ürün geri alınabilir.

### `GET /api/v1/orders` — `orders:read`

Size düşen alt siparişleri kalemleriyle döner. Müşterinin **diğer
mağazalardan** aldığı ürünler görünmez.

Parametreler: `limit`, `offset`, `status`, `since` (ISO 8601 — artımlı çekim).

### `PATCH /api/v1/orders/{id}` — `orders:write`

```json
{ "status": "shipped", "carrier": "Yurtiçi Kargo", "tracking_number": "1234567890" }
```

Durum geçişleri tek yönlüdür:

```
awaiting_vendor → accepted → preparing → shipped → delivered
        ↓             ↓           ↓
    cancelled     cancelled   cancelled
```

`shipped` için `tracking_number` zorunludur.

---

## Kanonik ürün eşleştirme

Ohaaaa, farklı mağazaların aynı ürününü tek karşılaştırma kartında toplar:

1. **GTIN / barkod** — en güvenilir; *mümkünse daima gönderin*
2. **Marka + normalize başlık imzası** — barkodsuz beslemeler için
3. Eşleşme yoksa yeni kanonik ürün açılır

GTIN göndermek doğrudan satışa yansır: barkodlu ürünler rakiplerinizle yan
yana listelenir ve **kargo dahil** en iyi toplam fiyatı verdiğinizde ilk
sırada görünürsünüz.

## Örnek: Node.js ile besleme

```js
const response = await fetch('https://api.ohaaaa.com/api/v1/products', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.OHAAAA_KEY,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ products: batch }), // en fazla 500
});

if (response.status === 429) {
  const retryAfter = Number(response.headers.get('retry-after') ?? 60);
  await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
  // ...aynı sayfayı tekrar gönderin: besleme idempotenttir
}
```
