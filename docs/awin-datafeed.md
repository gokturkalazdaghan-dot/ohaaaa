# Awin ürün feed'i (datafeed) — operatör kılavuzu

> **Bu belgedeki hiçbir şey canlı Awin'e karşı doğrulanmadı.**
> `api.awin.com`, `productdata.awin.com`, `wiki.awin.com` ve
> `developer.awin.com` bu ortamın ağ politikasıyla engelli. Kolon adları
> Awin'in yayınlanmış datafeed şemasına göre yazıldı; **gerçek bir feed
> başlığına karşı doğrulanması zorunlu** (aşağıdaki 3. adım).

## Ne yazıldı, ne yazılmadı

Awin için **yeni bir ayrıştırıcı yazılmadı ve yazılmamalı**. Hattın adaptör
sözleşmesi `(content: string) => AdapterResult`; Awin feed'leri CSV ya da
XML ve ikisini de `parseCsv` / `parseXml` zaten ayrıştırıyor. Awin'e özgü
olan tek şey **kolon adları**, o da `sources.field_mapping` sütununda
**veri** olarak duruyor.

Gerçekten eksik olan ve eklenen üç şey:

| Eksik olan | Nerede çözüldü |
|---|---|
| Sıkıştırılmış gövde (`.csv.gz`) metne çevrilince bozuluyordu | `adapters/decompress.ts` + `FetchResult.bytes` |
| Awin kolon adları ve eşlemesi hiçbir yerde yoktu | `providers/awinDatafeed.ts` |
| Onaysız programa trafik gitmesini engelleyen kapı yoktu | `checkCommercialActivation` |

## Bir Awin kaynağı açmak

Mevcut `sources` tablosu bunun için **yeterli; migration gerekmiyor**.

| Gereken | Sütun |
|---|---|
| mağaza | `merchant_id` |
| MID | `merchants.network_advertiser_id` (kaynakta değil) |
| feed adresi | `endpoint_url` |
| feed türü | `kind` = `feed_csv` \| `feed_xml` |
| kimlik referansı | `auth_type` + `auth_secret_ref` |
| para birimi | `currency` |
| aktiflik | `is_enabled` |
| son alım durumu | `last_run_at`, `last_status`, `last_error`, `last_error_class`, `last_item_count` |

### 1. Sırrı ortama koy

```
AWIN_DATAFEED_API_KEY=<Awin panelinden>
```

**Anahtarın kendisi hiçbir zaman veritabanına yazılmaz.** `auth_secret_ref`
yalnızca **değişkenin adını** taşır; değeri çalışma anında ortamdan okunur
ve okunur okunmaz maskeleme defterine yazılır.

### 2. Kaynağı yaz

`endpoint_url` içinde sır **yer tutucu** olarak durur:

```
https://<awin feed adresi>?apikey=${AWIN_DATAFEED_API_KEY}&fid=<feed id>
```

`auth_type='query'`, `auth_secret_ref='AWIN_DATAFEED_API_KEY'`.

> Gerçek adres ve `fid` **Awin panelinden** alınır. Bu depoda hiçbir feed
> adresi ya da feed ID kayıtlı değil ve **uydurulmadı**.

### 3. Eşlemeyi gerçek başlığa karşı DOĞRULA — atlanamaz

```ts
import { verifyAwinMapping, AWIN_FIELD_MAPPING } from '@ohaaaa/ingest';

const rapor = verifyAwinMapping(feedBaslikSatiri, AWIN_FIELD_MAPPING);
if (!rapor.ok) console.error(rapor.summary);
```

`missingRequired` doluysa **kaynağı açma**. O hâlde `normalize.ts` her
satırı eler ve hat kalıcı `VALIDATION_ERROR` verir — hatayı orada
"hiçbir kalem doğrulamayı geçemedi" diye görmek yerine burada kolon adıyla
görmek istersiniz.

Doğrulanan eşleme `sources.field_mapping` sütununa yazılır. Önayar
**kendiliğinden uygulanmaz**.

## `url` neden `merchant_deep_link`, `aw_deep_link` değil

Atfın sessizce bozulabileceği tek yer burası.

`aw_deep_link` **zaten sarılmış** bir ortaklık adresidir
(`awin1.com/cread.php?...&ued=<mağaza adresi>`). Katalogda onu saklamak,
`/git/[offerId]` rotasının `buildAffiliateUrl` ile **bir kez daha**
sarması demektir: awin1.com içinde awin1.com. Sonuç: dış sarmalayıcı bizim
`clickref/subid`'imizi taşır ama iç sarmalayıcı Awin tarafında kazanır;
tıklama kaydı yeşil görünür, **komisyon hiç gelmez**.

`merchant_deep_link` mağazanın ham ürün adresidir. Sarmalamayı mevcut
ortaklık katmanı `merchants.deeplink_template` ile **tek sefer** yapar.
Feed `merchant_deep_link` yayınlamıyorsa `verifyAwinMapping` bunu eksik
zorunlu kolon olarak bildirir — sessizce `aw_deep_link`'e düşmek **yasak**.

## Ticari kapı — teknik destek ≠ ticari izin

Adaptörün bir feed'i okuyabilmesi, o mağazaya trafik gönderilebileceği
anlamına gelmez. `checkCommercialActivation` yalnızca şu dördü birden
varsa geçirir: `application_status='approved'`, `approved_at` dolu, MID,
deeplink şablonu.

**MID 61655 (Back to the Office / "BTO")** depo kaydında
`status='prospect'`, `application_status='not_started'` — yani başvuru
bile yapılmamış. Onaysız programa trafik göndermek tıklamaların
atfedilmemesi **ve** program şartlarının ihlali demektir; ikisi de ilk
mutabakata kadar sessizdir. Kapı bunu varsayılan olarak engeller.

## Sıkıştırma

Biçim **içerikten** (sihirli baytlar) anlaşılır, `content-type`'tan değil —
aynı `.gz` adresi sunucudan sunucuya `application/gzip`,
`application/octet-stream` ya da `text/csv` dönebiliyor.

- `gzip` / `zlib` → açılır
- `zip` → **açılmaz**, kalıcı `CONFIG_ERROR` (Node'da zip çözücü yok;
  yarım yazılmış bir okuyucu sessizce yanlış dosyayı seçebilirdi).
  Sağlayıcının `.gz` sürümünü kullanın.

**Sıkıştırma bombası** açma *sırasında* durdurulur (512 MB). `maxBodyBytes`
yalnızca indirilen baytı sınırlar ve sıkıştırılmış gövdede bu sınır
aldatıcıdır: 64 MB'lık bir gzip gigabaytlarca açılabilir.

## Idempotentlik — beklenen davranış

Hat **delta** tabanlıdır; parmak izi değişmeyen kalem **hiç yazılmaz**:

| | created | updated | unchanged | yazma çağrısı |
|---|---|---|---|---|
| 1. tur | N | 0 | 0 | var |
| 2. tur (feed aynı) | 0 | 0 | N | **yok** |
| 2. tur (1 fiyat değişti) | 0 | 1 | N-1 | var |

"İkinci turda hepsi UPDATE" beklentisi bu mimaride **yanlıştır** ve daha
kötüdür: değişmeyen 50.000 satırı yeniden yazmak tetikleyici ve yeniden
indeksleme gürültüsü üretir.

## Bilinen boşluk — SKU ve MPN

Awin feed'i `merchant_product_id` (SKU) ve `mpn` yayınlar; adaptör bunları
`RawRecord` içinde **görür** ama **saklamaz**. `offers` tarafında karşılık
gelen sütun yok (`products.sku` başka bir altsistemin — pazar yeri
tarafının — sütunu).

Saklanması isteniyorsa gereken zincir: `FieldMapping` → `NormalizedOffer`
→ `normalize.ts` → `offers` migration → `upsertOffers`. Bu bilinçli olarak
**yapılmadı**: hiçbir mevcut özellik bu alanları okumuyor ve okunmayan
sütun eklemek spekülatif şema olurdu. `gtin` (EAN) — kanonik ürün
eşleştirmesinin gerçekten kullandığı alan — zaten destekleniyor.
