# Talep anında dış ürün arama (Affiliate.com)

Bu belge, Ohaaaa'nın **katalogda olmayan** ürünleri kullanıcı aradığı anda
bir dış sağlayıcıdan getirme yolunu anlatır.

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

## API sözleşmesi: ne doğrulandı, ne doğrulanmadı

### Doğrulandı (canlı ölçüm, 2026‑09‑20)

```
POST https://api.affiliate.com/v1/products
Authorization: Bearer <anahtar>
Content-Type: application/json
```

Geçersiz jetonla yapılan istek:

```
HTTP 401  content-type: application/json
{"message":"Unauthenticated.","error":"Authentication is required to access this resource."}
```

Yani: uç nokta **vardır**, POST kabul eder, JSON döner ve yetkilendirme
**Bearer** şemasıyladır.

### DOĞRULANMADI

- İstek gövdesindeki alan adları (`query`? `q`? `search`?)
- Filtre sözlüğü — pazar, ülke, para birimi, ağ, satıcı
- Sayfalama biçimi
- Yanıt sarmalayıcısının adı (`products`? `data`? `results`?)
- Alan adlandırması (`commission_url` mu `urls.outclick` mu)
- `@@@` / `###` yer tutucularının **nasıl doldurulduğu**

Kod bu boşlukları **uydurmaz**. Aldığı üç önlem:

1. **İstek gövdesi bilerek dar.** Yalnızca `query` ve `limit` gönderilir.
   Pazar/ülke/para birimi/ağ/satıcı filtreleri sözleşmede (`ProductSearchQuery`)
   ve önbellek anahtarında vardır ama tel üzerine yazılmaz. Liste tek
   yerde: `affiliateCom.ts` → `DOGRULANMAMIS_FILTRELER`. Bir filtre
   doğrulandığında yapılacak iş o listeden adı silmek ve `buildRequest`
   içine bir satır eklemektir.

   *Neden:* doğrulanmamış bir filtre iki şekilde başarısız olur, ikisi de
   sessizdir — ya yok sayılır (kullanıcı "Türkiye sonuçları" sanıp dünya
   geneli sonuç görür) ya da 422 alınır (arama hiç çalışmaz).

2. **Yanıt savunmacı okunur.** Her alan için birkaç aday yol denenir
   (`commission_url`, `urls.outclick`, …). Aday listesinde olmayan hiçbir
   şey uydurulmaz; alan `null` kalır. Okunamayan tek bir ürün turu
   düşürmez, o satır atlanır.

3. **Çözülmemiş yer tutucu taşıyan adres DÜŞÜRÜLÜR.** `@@@`, `###` ya da
   `{...}` içeren bir link `null` olur ve ürün `unresolvedLinkPlaceholders:
   true` ile işaretlenir.

   *Neden doldurmaya çalışmıyoruz:* aynı hata bu depoda bir kez ölçüldü ve
   `packages/shared/src/affiliate.ts` içinde yazılı — çözülmemiş bir yer
   tutucu adres dilbilgisini bozmaz. Link geçerli **görünür**, yönlendirme
   çalışır, kullanıcı mağazaya varır ve tıklama **atıfsız** kalır. Sessiz
   gelir kaybı. Boş link ise gürültülüdür: arayüz düğmeyi çizmez.

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

`ExternalProduct.barcode` yalnızca **rakamlara indirgenmiş** hâldir. 14
haneye doldurulmaz ve GS1 kontrol basamağı burada doğrulanmaz.

Sebep: o kural zaten iki yerde yazılı ve ikisi de burayı önceler —
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
| `basarisiz` | `sebep`: `not_configured`, `unauthorized`, `invalid_request`, `rate_limited`, `unavailable`, `timeout`, `network`, `bad_response`, `butce` |

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

## Gerçek anahtarla doğrulama

```bash
npm run build --workspace @ohaaaa/shared
AFFILIATE_COM_API_KEY=... npm run dis-arama:deneme -- "oyuncu kulaklık"
```

Betik bir kez gerçek çağrı yapar, HTTP durumunu ve normalize edilmiş ilk
ürünleri yazdırır. Anahtar çıktıya **girmez** (yalnızca karakter sayısı).

CI bu betiği çalıştırmaz ve çalıştırmamalıdır: `.github/workflows/ci.yml`
içinde hiçbir sır yoktur ve bu korunması gereken bir özelliktir
(çatal PR'ları aynı iş akışını çalıştırır).

## Bağlanma noktası — HENÜZ BAĞLI DEĞİL

`disKaynaktaAra()` bugün hiçbir sayfadan çağrılmıyor. Bu bilinçli: gerçek
kimlik bilgisi doğrulanmadan üretim arama akışına bağlamak, en iyi
ihtimalle görünmez bir ölü kod, en kötü ihtimalle kullanıcıya sahte ürün
göstermek olurdu.

Anahtar alındığında bağlanacağı yer `apps/web/src/app/arama/page.tsx`
içindeki `Promise.all` bloğudur — `searchProducts` ve `getSearchFacets`
ile **yan yana**, kendi `catch`'iyle, tıpkı filtre şeridinin bugün
yapıldığı gibi:

```ts
const disSonuc = await disKaynaktaAra(
  { query: q, market, currency, limit: 12 },
  await headers(),
);
```

Sonuç `durum !== 'basarili'` ise hiçbir şey çizilmez; katalog sonuçları
tek başına gösterilir.
