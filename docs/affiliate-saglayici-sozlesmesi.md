# Ortaklık ağı sağlayıcı sözleşmesi

**Durum:** FAZ 1 · 2026-09-25
**Kod:** `packages/shared/src/providers/`

Yeni bir ortaklık ağı eklemek = **bir dosya + registry'ye bir satır**.
`/git/:offerId`, `clicks`, `conversions` ve open-redirect savunması
değişmez.

---

## Tek kural

> **Sağlayıcı isteği TARİF EDER ve yanıtı ÇÖZER; isteği ATMAZ.**

Bu, Awin'de zaten uygulanan kalıptır (`awinTransactionsUrl` adresi kurar,
`awinTransactionToConversion` yanıtı çözer, `fetch` çağıran taraftadır) ve
bilerek korundu.

Gerekçesi tek cümlede: SSRF kapısı, nezaket gecikmesi, gövde boyutu sınırı,
zaman aşımı ve devre kesici `packages/ingest/src/http/politeClient.ts`
içinde **tek yerde** duruyor. Sağlayıcıya `fetch` vermek, o korumaların her
ağda yeniden — ve er geç eksik — yazılması demekti.

## İkinci kural

> **Sır bu pakete girmez.**

`ProviderRequest` hazır bir `Authorization` başlığı **taşımaz**; yalnızca
hangi ortam değişkeninin gerektiğini **söyler**:

```ts
{
  method: 'GET',
  url: 'https://api.impact.com/Mediapartners/…/Actions?…',
  credential: { kind: 'basic', usernameEnv: 'IMPACT_ACCOUNT_SID',
                                passwordEnv: 'IMPACT_AUTH_TOKEN' },
  accept: 'application/json',
}
```

Üç sonucu var: paket hiçbir koşulda sır tutmaz; sırrı çözen taraf tek ve
denetlenebilir kalır; bir ağın hangi değişkeni istediği **koda değil
veriye** yazılmış olur. `impact.test.ts` bunu bir testle sabitliyor —
istek nesnesinin içinde `authorization` sözcüğü geçemez.

---

## Yetenek matrisi

Her sağlayıcı ne sunduğunu **ilan eder**. "Bu ağ katalog veriyor mu"
sorusu çalışma anında denenerek değil, önceden bilinerek cevaplanır.

| | `direct` | `awin` | `impact` |
|---|---|---|---|
| `programs` | `manual` | `api` | `api` |
| `catalog` | `feed` | `feed` (CSV datafeed) | `api` (REST) |
| `deeplink` | `template` | `template` | `template` |
| `clicks` | `local` | `local` | `local` |
| `conversions` | `postback` | `pull` | `pull` |
| `commissions` | `in_conversion` | `in_conversion` | `in_conversion` |

İlan ile kod ayrışamaz; testler şunu zorunlu kılıyor:

- `capabilities.conversions` ile `conversionSource` aynı değeri söylemeli
- `deeplink: 'template'` diyen bir ağ kendi `buildDeeplink`'ini **yazamaz**
  (ikizlenmiş mekanizma zamanla sapar)
- `catalog: 'api'` diyen bir ağ `catalogItemsRequest` + `parseCatalogItems`
  sunmak zorunda

## Sınırlar

`null`, "sınırsız" değil **"ağ yayınlamamış"** demektir. Bilinmeyen bir
sınırı sonsuz saymak, kotayı tüketip 429 yemenin kestirme yoludur.

| | `awin` | `impact` |
|---|---|---|
| `requestsPerMinute` | 20 | `null` (yayınlanmıyor) |
| `requestsPerHour` | `null` | 1 000 |
| `maxRangeDays` | 31 | 45 |
| `maxPageSize` | `null` (sayfalamaz) | 1 000 |
| `maxPagedResults` | `null` | **20 000** |

`impact.maxPagedResults = 20 000` FAZ 2'nin doğrudan sınırı: bir katalog
bundan büyükse sayfalamayla sonuna gidilemez, daraltıcı sorgu gerekir.

---

## Impact hakkında üç karar

### 1. Dönüşüm çekilir, beklenmez

Impact'te bir aksiyonun durumu `PENDING → APPROVED` ya da
`PENDING → REVERSED` olarak **sonradan** değişir. Tek seferlik bir bildirim
nihai durumu söyleyemez. Bu yüzden `Actions` periyodik olarak yeniden
okunur; idempotentlik veritabanında
(`on conflict (merchant_id, network_order_id)`) soğurulur.

Impact'in webhook'u vardır ama imza şeması **canlı bir hesapla
doğrulanmadan** imzasız bir yazma yolu açılmadı — Awin için verilen kararın
aynısı. Postback ucu bu ağ için de kapalı; `/api/postback/:merchant` zaten
`conversionSource === 'pull'` olan her ağı 501 ile reddediyor, yani Impact
için **route değişikliği gerekmedi**.

### 2. Deeplink şablonla üretilir, çağrıyla değil

`POST …/Programs/{id}/TrackingLinks` her çağrıda bir link üretir. Tıklama
anında kullanılamaz: saatte 1000 istek kotası var ve her tıklamaya bir dış
çağrı eklemek yönlendirmeye ağ gecikmesi bindirirdi.

Doğru yol ağın zaten verdiği hazır linktir: `Campaigns` yanıtındaki
`TrackingLink`. O değer `merchant_network_links.deeplink_template`
sütununa yazılır; ortak `buildAffiliateUrl` `{subid}` ve `{url_encoded}`
yer tutucularını doldurur — Awin'de bugün çalışan mekanizmanın aynısı.

### 3. `ActionDateStart`, `StartDate` değil

İkisi farklı soru sorar: `StartDate` "bu aralıkta **güncellenen**"
satırları döner, `ActionDateStart` "bu aralıkta **gerçekleşen**"leri. Biz
"bu pencerede ne oldu" diye sorduğumuz için olay tarihini kullanıyoruz —
Awin'de `dateType=transaction` seçilmesiyle aynı gerekçe.

Tarih hiç vermemek ağın varsayılanına (son 7 gün) düşerdi; o sessiz bir
daralma olurdu, bu yüzden iki uç da zorunlu.

---

## Sözleşmenin kaynağı ve doğrulanmışlığı

Impact uç noktaları, sınırları ve alan adları 2026-09-25'te resmî yayıncı
API dokümantasyonundan (`integrations.impact.com/partner-api-reference`)
okundu. Tahmin edilen tek bir alan adı yok.

Buna rağmen `affiliate_networks.contract_verified` bu ağ için **false**
kalıyor: doküman okumak ile canlı bir hesapla doğrulamak aynı şey değil.
İlk gerçek yanıt alınana kadar bu ağ "doğrulanmadı" sayılır — tablo
şemasındaki `affiliate_networks_verified_needs_evidence` kısıtı da zaten
`docs_url` + `verified_at` olmadan `true` yazılmasına izin vermiyor.

## Yeni bir ağ eklerken

1. `packages/shared/src/providers/<ag>.ts` — sözleşmeyi uygula
2. `registry.ts` içindeki `PROVIDERS` dizisine bir satır
3. `affiliate_networks` tablosunda satır **zaten varsa** migration
   gerekmez: `merchants`, `programs`, `merchant_network_links` ve
   `program_application_attempts` o tabloya FK ile bağlı
4. `.env.example` — gereken değişken adlarını yaz (değerlerini değil)
5. Test: yetenek ilanı, sır sızıntısı, sayfalama sonu, tanınmayan durum
