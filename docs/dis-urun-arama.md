# Talep anında dış ürün arama (Affiliate.com)

Bu belge, Ohaaaa'nın **katalogda olmayan** ürünleri kullanıcı aradığı anda
bir dış sağlayıcıdan getirme yolunu anlatır.

> **DURUM: HAZIRLIK — ÜRETİME BAĞLI DEĞİL.**
> Uç noktanın erişilebilir olduğu ve geçersiz Bearer token ile 401
> döndüğü doğrulandı. **Gerçek ürün sorgusu henüz doğrulanmadı**; gerçek
> credential yok. Ayrıntı: [Doğrulama durumu](#doğrulama-durumu-2026-09-20).

## Bu sistem neyin yerine GEÇMEZ

Hiçbir şeyin. Özellikle:

| Mevcut sistem | Durumu |
| --- | --- |
| Awin dönüşüm/deeplink sağlayıcısı (`packages/shared/src/providers/awin.ts`) | **Değişmedi** |
| Feed alımı (`packages/ingest`, `sources`, `/api/cron/alim`) | **Değişmedi** |
| Katalog araması (`search_products` RPC, `apps/web/src/data/catalog.ts`) | **Değişmedi** |
| QUALIFY/skorlama, taksonomi, DB şeması | **Değişmedi** |

Yeni kod tamamen **paraleldir** ve tek bir ortam değişkeniyle geri alınır:
`AFFILIATE_COM_API_KEY` boşsa sistem kapalıdır, hiçbir ağ isteği yapılmaz
ve site bugünkü davranışını birebir sürdürür.

## Katmanlar

```
apps/web/src/lib/dis-arama/ayar.ts      ortam okuma (server-only), sınır kıstırma
apps/web/src/lib/dis-arama/ara.ts       bütçe + önbellek + GÜVENLİ GERİ DÜŞÜŞ
        │
        ▼
packages/shared/src/productSearch/
        types.ts         sözleşme: ExternalProduct, ProductSearchQuery, hata kodları
        affiliateCom.ts  adaptör: istek gövdesi + savunmacı normalizasyon
        client.ts        HTTP: timeout, 401/422/429/503, gövde sınırı
        cacheKey.ts      deterministik önbellek anahtarı
```

`productSearch`, `@ohaaaa/shared` ana `index.ts`'inden **dışa açılmaz**;
yalnızca `@ohaaaa/shared/product-search` alt yolundan erişilir. Sebep:
içinde API anahtarı taşıyan bir HTTP istemcisi var ve ana pakete koymak,
istemci bileşenlerinin onu paketlerine çekme riskini doğururdu.

## DOĞRULAMA DURUMU (2026‑09‑20)

Bu bölüm entegrasyonun **bugünkü gerçek durumudur**. Aşağıdaki tablonun
dışındaki hiçbir şey doğrulanmış sayılmaz.

| # | Durum | |
| --- | --- | --- |
| 1 | Uç nokta erişilebilir | ✅ **CANLI DOĞRULANDI** |
| 2 | 401 authentication kontrolü | ✅ **CANLI DOĞRULANDI** |
| 3 | Gerçek credential | ❌ **YOK** |
| 4 | Gerçek ürün yanıtı (200 + ürün) | ❌ **HENÜZ DOĞRULANMADI** |
| 5 | Request sözleşmesi (alan adları, gövde) | 📘 **DOKÜMANDAN OKUNDU** — canlı değil |
| 6 | Response sözleşmesi (sarmalayıcı, alan adları) | 📘 **DOKÜMANDAN OKUNDU** — canlı değil |
| 7 | Filtre sözleşmesi (para birimi / ağ / satıcı / havuz) | 📘 **DOKÜMANDAN OKUNDU** — canlı değil |
| 8 | Deeplink yer tutucu sözleşmesi (`@@@` / `###`) | 📘 **DOKÜMANDAN OKUNDU** — canlı değil |
| 9 | `sale_discount` birimi (tutar mı yüzde mi) | ⚠️ **DOKÜMAN KENDİ İÇİNDE ÇELİŞİYOR** — okunmuyor |
| 10 | 422'nin kota/parametre ayrımı | ⚠️ **SEZGİ** — yanıt metnine bakılıyor, doğrulanmalı |

📘 = resmî dokümandan (https://guides.affiliate.com) okundu ve koda geçirildi;
başarılı bir yanıtla ölçülmedi.

**Kabul kriterinin doğru ifadesi:** *"Endpoint erişilebilir ve geçersiz
Bearer token ile 401 döndüğü doğrulandı; gerçek ürün sorgusu henüz
doğrulanmadı."*

"POST /v1/products server-side çalışıyor" demek bugün için **yanlış**
olurdu: server-side istek yolu kuruludur ve 401'e kadar gider, ama
başarılı bir ürün sorgusu hiç yapılmamıştır.

### 1–2. Ne doğrulandı — canlı ölçüm

Geçersiz bir jetonla tek bir istek yapıldı:

```
POST https://api.affiliate.com/v1/products
Authorization: Bearer <geçersiz deneme jetonu>
Content-Type: application/json
{"query":"kulaklik","limit":1}

→ HTTP 401   content-type: application/json
  {"message":"Unauthenticated.","error":"Authentication is required to access this resource."}
```

Bundan **yalnızca** şunlar çıkar: uç nokta vardır, POST'u kabul eder,
JSON döner ve yetkilendirme **Bearer** şemasıyladır. Kimlik doğrulama
katmanı, istek gövdesi doğrulanmadan ÖNCE çalıştığı için bu ölçüm gövde
sözleşmesi hakkında **hiçbir şey söylemez**.

### 3. Gerçek credential yok

`AFFILIATE_COM_API_KEY` sağlanmadı. Bu yüzden:

- Sistem **kapalıdır** — hiçbir ağ isteği yapılmaz.
- `disKaynaktaAra()` **hiçbir sayfadan çağrılmıyor**; üretim arama akışına
  **bağlanmadı** ve bu bilinçli bir karardır.
- Mock/örnek veriyle "çalışıyor gibi" gösterilmedi. Sahte ürün, gerçek
  fiyat ve gerçek stok sanılır; bir karşılaştırma sitesinde bu, kullanıcıya
  doğrudan yalan söylemektir.

### 4. Hâlâ doğrulanmayan tek şey: başarılı bir yanıt

Başarılı (200) bir ürün yanıtı **hiç görülmedi**. Aşağıdaki sözleşme
resmî dokümandan okundu ve koda geçirildi, ama **ölçülmedi**.

### 5–8. Dokümandan okunan sözleşme

**İstek** (`/first-request`, `/api-reference/products/search`):

```jsonc
{
  "search": [ { "field": "any", "value": "oyuncu kulaklık", "operator": "LIKE" } ],
  "per_page": 24,
  "page": 2,            // istendiğinde
  "pool_id": "01HXYZ"   // ÇIPLAK ULID; `pool_` öneki 422 döndürür
}
```

`search` bir **dizidir**; elemanlar **VE** ile birleşir, aynı `value`
içindeki `||` ise **VEYA**'dır. `any` alanı yalnızca `LIKE` kabul eder.

**Pazar daraltması** — `market` diye bir alan **YOKTUR**. Kapsam iki
mekanizmayla kurulur:

- `currency` (`=`, `"TRY||EUR||AED"`)
- `network.id` / `merchant.id` — **ağlar bölgeseldir** ("Awin UK",
  "Impact US"; `region` ve `country` taşırlar). Hangi ağın hangi ülkeye
  ait olduğu `GET /v1/networks` ile öğrenilir; bu depo o listeyi
  **tahmin etmez**.
- `pool_id` — ağ/satıcı kümesi Affiliate.com'da adlandırılıp saklanır.

Ürünün `country` alanı **MENŞE ÜLKEDİR**, pazar değil.

**Yanıt:** `{ meta, facets?, data: [...] }` — `meta.total` toplam eşleşme.

**Adresler** (`/concepts/products`):

| Link | Durum |
| --- | --- |
| `urls.outclick` | **Tercih edilen.** Yer tutucu yok; Affiliate.com'un tıklamayı **kaydettiği tek adres** |
| `urls.affiliate` | Ağın linki — `@@@`/`###` doldurulmalı |
| `commission_url` | `urls.affiliate`'in **legacy** adı |
| `urls.direct` | Takipsiz, **komisyon yok** |

**`@@@` = affiliate ID'niz, `###` = sub ID'niz.** `networks` parametresi
gönderilirse API bunları otomatik doldurur.

Kod bu sözleşmeyi uygular ve boşlukları **uydurmaz**:

1. **Adres önceliği:** `urls.outclick` → `urls.affiliate`/`commission_url`
   → yoksa `null`. `direct_url` bu zincire **hiç girmez**: komisyonsuz bir
   adresi ortaklık linki diye sunmak, trafiği bedavaya vermektir.

2. **Yanıt savunmacı okunur.** Sözleşmedeki ad denenir, tutmazsa alan
   `null` kalır. Okunamayan tek bir ürün turu düşürmez, o satır atlanır.

3. **Çözülmemiş yer tutucu taşıyan adres DÜŞÜRÜLÜR.** `@@@`, `###`,
   `{SUB_ID}` içeren bir link `null` olur ve ürün
   `unresolvedLinkPlaceholders: true` ile işaretlenir.

   *Bu artık bir sezgi değil:* `/api-reference/reports/outclick` sayfası
   açıkça yazıyor — doldurulmamış yer tutucular tıklama kaydına **harfi
   harfine** geçer (`sub_id` alanı `{SUB_ID}` olur) ve hiçbir raporla
   eşleşmez. Link geçerli **görünür**, kullanıcı mağazaya varır, tıklama
   **atıfsız** kalır. Sessiz gelir kaybı.

### 9. `sale_discount` — doküman kendi içinde çelişiyor

| Sayfa | Tanım |
| --- | --- |
| `/concepts/products` | "Discount **amount** in the product's currency" (float, **para**) |
| `/api-reference/products/search` | "Discount **percentage** applied to `regular_price`" (integer, **yüzde**) |

Birini seçmek varsayım olurdu ve yanlış seçim doğrudan yanlış bilgi
demektir (₺150 indirimi "%150" diye basmak). Alan, gerçek bir yanıtla
ölçülene kadar modele **hiç girmiyor** — `affiliateCom.ts` içinde TODO
olarak duruyor. Eksik bir alan görünür; yanlış bir alan değil.

### 10. 422'nin iki anlamı — ayrım bir SEZGİ

`/authentication` sayfası 422'yi **abonelik kotasının tükenmesi** olarak
tanımlıyor; `/api-reference/products/search` ise aynı kodu **parametre
doğrulama** hataları için kullanıyor (`facets` dizi değil, `sort_by`
tanınmıyor, `pool_id` önekli…).

İkisi operatörden bambaşka şey ister: biri kodda düzeltme, diğeri plan
yükseltmesi. Doküman ayırt edici bir alan tanımlamadığı için ayrım
**yanıt metninden** yapılıyor (`client.ts` → `KOTA_KALIBI`) ve gerçek
anahtarla doğrulanmalıdır. Gövde yalnızca bu eşleştirme için, bellekte
okunur; hiçbir yere yazılmaz.

## Veri nerede durur

**Hiçbir yerde** — kısa önbellek dışında.

- Affiliate.com ürünleri **Supabase'e yazılmaz**.
- `products` / `product_groups` tablolarına **kalıcı alım yapılmaz**.
- Katalog **aynalanmaz**.

Tek istisna, okuma anındaki `unstable_cache` girdisidir. Süresi
`AFFILIATE_COM_ONBELLEK_SANIYE` ile ayarlanır ama kod değeri **30–900
saniye** arasına kısar: yanlış yazılmış bir değer sistemi sessizce uzun
süreli veri saklamaya (yani bir katalog aynasına) çeviremez.

Önbellek anahtarı deterministiktir ve sonucu etkileyebilecek her alanı
sayar — sağlayıcı o alanı bugün tel üzerine yazmasa bile. Fazladan alan
saymanın bedeli birkaç ıskalanan isabettir; eksik saymanın bedeli yanlış
sonuç göstermektir.

## GTIN / barkod eşleştirmesi

İki alan vardır ve ayrı olmaları kasıtlıdır:

| Alan | İçerik |
| --- | --- |
| `barcode` | Sağlayıcının gönderdiği **ham** değer, harfi harfine |
| `barcodeDigits` | Yalnızca rakamlardan oluşuyorsa aynı değer; **aksi hâlde `null`** |

**Ham değer neden korunuyor:** resmî doküman `barcode` alanının UPC, EAN,
GTIN **ya da ISBN** olabileceğini ve **büyük/küçük harfe duyarlı**
olduğunu söylüyor. ISBN-10'un kontrol basamağı `X` olabilir; bir rakam
süzgeci onu sessizce siler ve geriye geçersiz, hiçbir şeyle eşleşmeyen
bir kod bırakır. Sağlayıcıya geri sorgu atarken (`barcode` alanı, `=`
operatörü) kullanılacak olan da ham değerdir.

`barcodeDigits` 14 haneye **doldurulmaz** ve GS1 kontrol basamağı burada
doğrulanmaz: o kural zaten iki yerde yazılı ve ikisi de burayı önceler —
`packages/ingest/src/normalize.ts#normalizeGtin` ve veritabanındaki
`public.normalize_gtin`. Üçüncü bir kopya, zamanla ayrışacak üçüncü bir
doğruluk kaynağı olurdu.

Okuma anında kanonik ürün eşleştirmesi yapılacaksa bağlanma noktası
`apps/web/src/data/catalog.ts` → `findGroupByGtin(gtin)`'dir. Bu
**kullanılabilir** bir imkândır, otomatik değildir: eşleşen bir dış ürün
mevcut ürün kaydına **yazılmaz**, yalnızca okuma anında yan yana
gösterilebilir.

## Arıza davranışı

`disKaynaktaAra()` **hiçbir koşulda fırlatmaz**. Üç durum döner:

| Durum | Ne zaman |
| --- | --- |
| `kapali` | Anahtar yok — hiç ağa çıkılmadı |
| `basarili` | Ürünler geldi (boş liste de başarıdır) |
| `basarisiz` | `sebep`: `not_configured`, `unauthorized`, `invalid_request`, **`quota_exhausted`**, `rate_limited`, `unavailable`, `timeout`, `network`, `bad_response`, `butce` |

Her durumda **Ohaaaa katalog araması olduğu gibi çalışır**. Dış sonuç
gelmemesi aramanın bozulması değildir.

Hata `unstable_cache`'in içinden geçer, yani **önbelleğe girmez**:
sağlayıcının beş saniyelik bir kesintisi bizim tarafımızda TTL boyunca
sürmez.

## Sır hijyeni

- `AFFILIATE_COM_API_KEY` yalnızca sunucuda okunur; `NEXT_PUBLIC_` öneki
  **yoktur** ve verilmemelidir (`npm run verify:secrets` bunu denetler).
- `ayar.ts` `server-only` ithal eder: bir istemci bileşeninden ithal
  edilirse **derleme kırılır**.
- Anahtar hiçbir hata metnine, hiçbir günlük satırına ve hiçbir yanıta
  girmez. Birim testi bunu her hata kodu için ayrıca doğrular
  (*"API ANAHTARI HATA METİNLERİNE SIZMAZ"*).
- Sağlayıcının **yanıt gövdesi** de hiçbir hataya girmez: gövde isteğimizi
  yankılayabilir, isteğimiz de kullanıcının arama metnini taşır.
- Günlüklerde kullanıcının **sorgu metni** yazılmaz — yalnızca sebep ve
  durum kodu.

## Hız sınırı ve zaman aşımı

| Kapı | Varsayılan | Değişken |
| --- | --- | --- |
| Kişi başı (saatlik) | 60 | `DIS_ARAMA_IP_SAATLIK` |
| Küresel (günlük) | 5000 | `DIS_ARAMA_GUNLUK` |
| Zaman aşımı | 4000 ms | `AFFILIATE_COM_TIMEOUT_MS` (üst sınır 10 sn) |
| Yanıt gövdesi | 2 MiB | sabit (`EN_BUYUK_GOVDE_BAYT`) |

Bütçe, önbellekten **önce** sayılır. Tersi cazip görünür ("isabet varsa
kota harcama") ama koruma tam da orada kaybolurdu: sorgu metnini her
istekte değiştiren bir betik zaten asla isabet almaz, yani hep
sağlayıcıya gider.

429 yanıtındaki `Retry-After` hem saniye hem HTTP tarihi biçiminde
okunur ve hataya alan olarak taşınır.

## Gerçek anahtar geldiğinde İLK VE TEK iş

```bash
npm run build --workspace @ohaaaa/shared
AFFILIATE_COM_API_KEY=... npm run dis-arama:deneme -- "oyuncu kulaklık"
```

Bu komut çalıştırılıp **gerçek yanıt raporlanmadan** başka hiçbir adım
atılmaz: kod değişikliği yok, üretime bağlama yok, filtre açma yok.

Sebep sıralamada: yukarıdaki 4–8 numaralı sözleşmelerin hepsinin cevabı
bu tek yanıttadır. Yanıtı görmeden yapılacak her düzenleme, tahmin
üzerine tahmin biriktirmek olur.

Betik bir kez gerçek çağrı yapar, HTTP durumunu ve normalize edilmiş ilk
ürünleri yazdırır. Anahtar çıktıya **girmez** (yalnızca karakter sayısı).

CI bu betiği çalıştırmaz ve çalıştırmamalıdır: `.github/workflows/ci.yml`
içinde hiçbir sır yoktur ve bu korunması gereken bir özelliktir
(çatal PR'ları aynı iş akışını çalıştırır).

## Bağlanma noktası — HENÜZ BAĞLI DEĞİL (CTO kararı)

`disKaynaktaAra()` **üretimde çağrılmıyor** ve bu bir eksiklik değil,
alınmış bir karardır. Gerçek kimlik bilgisi doğrulanmadan üretim arama
akışına bağlamak, en iyi ihtimalle görünmez bir ölü kod, en kötü
ihtimalle kullanıcıya sahte ürün göstermek olurdu.

Karara bağlı olarak bugün **değişmeyecek** olanlar:

- Awin dönüşüm/deeplink sağlayıcısı ve feed alımı
- Katalog araması (`search_products`, `catalog.ts`)
- Supabase şeması
- Üretim arama akışı (`arama/page.tsx`)
- Önbellek mimarisi (`onbellek.ts`, `KATALOG_SURUMU`)

Aşağıdaki kod örneği **yapılacak iş değil**, gerçek yanıt raporlandıktan
sonra değerlendirilecek bağlanma noktasının kaydıdır. Bağlanacağı yer
`apps/web/src/app/arama/page.tsx`
içindeki `Promise.all` bloğudur — `searchProducts` ve `getSearchFacets`
ile **yan yana**, kendi `catch`'iyle, tıpkı filtre şeridinin bugün
yapıldığı gibi:

```ts
const disSonuc = await disKaynaktaAra(
  {
    query: q,
    // Pazar daraltması: `market` diye bir alan YOK. Para birimi +
    // AĞ kimliği. Ağ kimlikleri `GET /v1/networks` ile bulunur ve
    // yapılandırmadan gelir — kodda SABİTLENMEZ.
    currencies: ['TRY'],
    networkIds: [/* GET /v1/networks ile doldurulacak */],
    perPage: 12,
  },
  await headers(),
);
```

Sonuç `durum !== 'basarili'` ise hiçbir şey çizilmez; katalog sonuçları
tek başına gösterilir.
