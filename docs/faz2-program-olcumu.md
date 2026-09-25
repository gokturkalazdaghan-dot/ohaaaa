# FAZ 2 — 10 Avrupa programının ölçümü

**Tarih:** 2026-09-25 · **Kapsam:** yalnızca ÖLÇÜM. Kod, migration, import YOK.

Kanıt kaynakları: üretim veritabanı (`ltqpitckngaytisjyjqi`), Awin'in kendi
datafeed dizini (`program_feeds`, 2026-09-18/25 turlarında toplandı),
Vercel üretim ortam değişkeni listesi, ve dört uç noktaya yapılan
kimliksiz birer istek.

> **Bu oturumda hiçbir ortaklık kimlik bilgisi yoktu.** `AWIN_DATAFEED_API_KEY`,
> `AWIN_API_TOKEN`, `IMPACT_*` — hiçbiri tanımlı değil. Bu yüzden **hiçbir
> programdan gerçek ürün örneği ALINAMADI**. Aşağıdaki `sample_status`
> sütunu bunu olduğu gibi söylüyor; ölçülmemiş bir şey "ölçüldü" diye
> yazılmadı.

---

## 1. Ölçüm tablosu

| program | network | approval | access | source | product_count | required_fields | identifiers | pagination | currency | stock | sample_status | decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Lunzo PL (40454) | awin | **UNVERIFIED** (`network_status` null) | feed dizinde, HTTPS, anahtar şart | Awin CSV datafeed, gzip, 4 parça | **677 686** (ilan) | ✓ hepsi | **SKU yalnız** — EAN/UPC/MPN **yok** | sabit 4 parça, parça başı 200k tavan, imleç yok | `currency` kolonu ✓ (PLN) | `in_stock` ✓ | **ALINAMADI** (kimlik yok) | CONTROLLED-IMPORT |
| Lunzo HU (40452) | awin | **UNVERIFIED** | aynı | aynı, 4 parça | **677 750** | ✓ hepsi | **SKU yalnız** | aynı | ✓ (HUF) | ✓ | **ALINAMADI** | CONTROLLED-IMPORT |
| Lunzo CZ (54355) | awin | **UNVERIFIED** | aynı | aynı, 4 parça | **676 534** | ✓ hepsi | **SKU yalnız** | aynı | ✓ (CZK) | ✓ | **ALINAMADI** | CONTROLLED-IMPORT |
| Lapert CZ (54357) | awin | **UNVERIFIED** | aynı | aynı, 4 parça | **676 524** | ✓ hepsi | **SKU yalnız** | aynı | ✓ (CZK) | ✓ | **ALINAMADI** | CONTROLLED-IMPORT |
| Lapert SK (54359) | awin | **UNVERIFIED** | aynı | aynı, 4 parça | **677 298** | ✓ hepsi | **SKU yalnız** | aynı | ✓ (EUR) | ✓ | **ALINAMADI** | CONTROLLED-IMPORT |
| Lunzo AT (114104) | awin | **UNVERIFIED** | aynı | aynı, 4 parça | **603 168** | ✓ hepsi | **SKU yalnız** | aynı | **`currency` kolonu YOK** → `defaultCurrency=EUR` şart | ✓ | **ALINAMADI** | CONTROLLED-IMPORT (koşullu) |
| Ultrahuman (69428) | awin | **active** (Awin membership) | feed dizinde, HTTPS, anahtar şart | Awin CSV datafeed, gzip, 1 feed | **4** | ✓ hepsi | **UPC + model_number ✓** | tek parça | **kolon YOK** → `defaultCurrency=USD` şart | `stock_status` (≠ `in_stock`) | **ALINAMADI** | READY |
| Lunzo RO (40456) | awin | — | **dizinde YOK** | — | — | — | — | — | — | — | — | **REJECT** |
| Lunzo SK (54353) | awin | — | **dizinde YOK** | — | — | — | — | — | — | — | — | **REJECT** |
| Lunzo DE (69786) | awin | — | **dizinde YOK** | — | — | — | — | — | — | — | — | **REJECT** |

**Toplam ilan edilen kalem (7 program):** 3 988 964

### Ölçülen alan sözleşmesi

Pipeline'ın bir satırı kabul etmesi için zorunlu alanlar
(`packages/ingest/src/normalize.ts` red gerekçelerinden çıkarıldı):
`external_id`, `title` (asgari uzunluk), `product_url` (geçerli **ve**
mağazanın izinli alan adına ait), `price` (>0, üst sınır altında),
`currency` (desteklenen kümede).

Yedi programın hepsinde mevcut: `product_name`, `search_price`,
`aw_product_id`, `merchant_product_id`, `aw_deep_link`, görsel,
`brand_name`, kategori. Altı Lunzo/Lapert'te ayrıca `delivery_cost`.

Para birimleri `public.currencies`'te kayıtlı: PLN, HUF, CZK, RON, EUR, USD
— hiçbiri eleme sebebi değil.

### FAZ 0'ın "676k tek feed" okuması düzeltildi

Awin her Lunzo/Lapert programını **4 parçaya** bölmüş: 200 000 + 200 000 +
~200 000 + ~77 000. FAZ 0'da tek feed sanılan 676k, bu dört parçanın
toplamıydı. Parça başına 200 000 tavan Awin'in kendi bölmesi; bizim
seçtiğimiz bir sayfalama değil ve **imleç/`modified_since` yok** — bir
parçanın tamamı indirilir ya da hiç indirilmez.

### Ultrahuman'ın feed *adı* yanıltıcı

`feed_name` alanı `sftp://datafeeds.shareasale.com/...` yazıyor; bu
reklamverenin Awin'e verdiği kaynağın adresi. **Bizim indirdiğimiz adres
HTTPS** (`productdata.awin.com/datafeed/download/...`) — transport sorunu
yok.

---

## 2. Hata / kota davranışı (kimliksiz birer istek)

| uç nokta | kimlik | yanıt |
|---|---|---|
| `productdata.awin.com/datafeed/download/...` | geçersiz anahtar | **404** (203 bayt) |
| `productdata.awin.com/datafeed/list/...` | geçersiz anahtar | **403** (68 bayt) |
| `api.awin.com/publishers/3074081/transactions/` | jeton yok | **401** |
| `api.impact.com/Mediapartners/.../Campaigns` | kimlik yok | **401** |

**Operasyonel tuzak:** Awin'in indirme ucu yanlış/geçersiz anahtara **404**
diyor, 401 değil. Yani bozuk bir anahtar "feed bulunamadı" gibi görünür.
Alım hattı 404'ü "feed kalktı" diye yorumlarsa sessizce boş katalog
üretir. Bu davranış kayda geçti; ilgili düzeltme FAZ 2'nin import adımına
girer.

Dört hostun hepsi HTTPS üzerinden erişilebilir.

---

## 3. Depolama bütçesi — ölçülmüş satır boyuyla

Üretimde ölçüldü (48 550 teklif):

| | bayt |
|---|---|
| `products` tek satır | **4 413** |
| zincir toplamı (`products` + `product_groups` + `price_points`) | **9 132** |

| senaryo | teklif | tahmini disk |
|---|---|---|
| 7 programın tamamı | 3 988 964 | **≈ 36,4 GB** |
| Supabase Pro disk | — | **8 GB** (şu an 450 MB dolu) |
| kalan alan | — | ≈ 7,55 GB → **≈ 826 000 teklif tavanı** |

**Sonuç: yedi programın tamamının alınması fiziksel olarak mümkün değil.**
Tavan diskin tamamını doldurmak olurdu; gerçek çalışma payı bunun altında.

---

## 4. GTIN yokluğu — FAZ 2'nin asıl riski

Altı Lunzo/Lapert feed'inin **hiçbirinde** EAN/UPC/MPN yok; yalnızca
satıcının kendi `merchant_product_id`'si var.

Bunun somut sonucu, FAZ 0'da ölçülen arızayı **büyütmek**:

- Kanonik eşleme GTIN → marka+başlık imzası sırasıyla çalışıyor
  (`pipeline.ts`). GTIN yoksa yalnızca imza kalır.
- Lunzo PL / HU / CZ / AT ve Lapert CZ / SK büyük ölçüde **aynı ürünleri
  farklı dillerde** satıyor. Başlıklar Lehçe / Macarca / Çekçe / Almanca /
  Slovakça olduğu için marka+başlık imzası bu satırları **eşleştiremez**.
- Yani altı programı almak, aynı ürün için altı ayrı Product Group üretir.
  FAZ 0'da 52 415 gruptan yalnızca **1**'inin çoklu mağaza içerdiği
  ölçülmüştü; bu yol o sayıyı düzeltmez, kötüleştirir.

Fiyat karşılaştırması bu feed'lerden **dil sınırını aşarak** kurulamaz.
Karar bu gerçeğin üstüne verilmeli.

---

## 5. Sınırların hangi ağa ait olduğu

FAZ 1'de Impact için ölçülen **20 000 `maxPagedResults`** sınırı
**Lunzo/Lapert için geçerli DEĞİL**: o programlar Awin'de ve ürünleri REST
sayfalamasıyla değil, gzip'li CSV dosyası olarak geliyor.

Lunzo/Lapert'in kısıtı **dosya boyutu ve satır bütçesi**; Impact'in kısıtı
**sayfalama tavanı**. İkisi farklı sorun ve karıştırılırsa yanlış çözüm
uygulanır.

Impact tarafında bu turda hiçbir ölçüm yapılamadı: `IMPACT_ACCOUNT_SID` /
`IMPACT_AUTH_TOKEN` ne bu oturumda ne de Vercel üretim ortamında tanımlı.
`contract_verified` bu yüzden **false** kalıyor.

---

## 6. B4 — `AWIN_API_TOKEN` üretimde YOK

Vercel `ohaaaa.com` projesinin ortam değişkeni listesi (tam liste;
`hiddenProductionEnvCount: 0`, yani gizlenen değişken yok):

| değişken | var mı | hedef |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | production |
| `AWIN_DATAFEED_API_KEY` | ✓ | production, preview, development |
| `CRON_SECRET` | ✓ | production |
| `CLICK_HASH_SECRET` | ✓ | production, preview, development |
| **`AWIN_API_TOKEN`** | **YOK** | — |
| `awin_OAuth2` | ✓ | production |

**Kanıtlanan:** `AWIN_API_TOKEN` hiçbir ortamda tanımlı değil. Awin OAuth
jetonu üretimde **`awin_OAuth2` adıyla** duruyor.

**Kod tarafı:** `apps/web/src/app/api/cron/donusum-esitle/route.ts`,
`process.env.AWIN_API_TOKEN` boşsa Awin'e **hiç istek atmadan** 503
`not_configured` dönüyor. Yani bu cron her gün 05:00'te çalışıyor ve hiçbir
şey yapmadan dönüyor.

**Tutarlı gözlem:** 1 213 tıklamaya karşılık `conversions` tablosu **0
satır**.

**Doğrudan gözlenemeyen:** 503 yanıtının kendisi. Vercel Pro'da runtime log
saklama süresi ~1 gün ve 05:00 turu saklanan pencereye girmiyor
(`/api/cron` sorgusu son 24 saatte kayıt döndürmedi).

**Sebep bir eksik kimlik değil, bir AD UYUŞMAZLIĞI.** Jeton üretilmedi,
hiçbir workaround yazılmadı — talimat gereği yalnızca kanıtlandı.

---

## 7. Teknik sınıflandırma

Bu bir ticari "en iyi" sıralaması **değil**; yalnızca teknik entegrasyon
uygunluğu.

### READY (1)
**Ultrahuman Healthcare (69428)** — Awin membership `active`, 4 kalem,
UPC + model_number taşıyor, boyut ihmal edilebilir. Tek koşul:
`currency` kolonu olmadığı için `defaultCurrency=USD` açıkça verilmeli.

### CONTROLLED-IMPORT (6)
**Lunzo PL / HU / CZ / AT, Lapert CZ / SK** — zorunlu alanların hepsi var,
transport HTTPS, feed dizinde. Ama üçü birlikte sağlanmadan alınamaz:
1. onay durumu doğrulanmalı (`network_status` null),
2. kalem sayısı tavanı konmalı (tamamı 36,4 GB),
3. GTIN yokluğu nedeniyle diller arası eşleşmeme kabul edilmeli ya da
   kapsam tek ülkeye daraltılmalı.

Lunzo AT ayrıca `currency` kolonu taşımadığı için `defaultCurrency=EUR`
gerektiriyor.

### REJECT (3)
**Lunzo RO (40456), Lunzo SK (54353), Lunzo DE (69786)** — 440 Awin
programının hiçbiri bu kimliklere sahip değil. Reddin sebebi teknik
uygunsuzluk değil **yokluk**: dizin bu programları hiç görmedi. Yeni bir
dizin turu onları bulursa karar yeniden verilir; `awin-feed-directory.mjs`
hiçbir şeyi silmediği için yokluk "kapandı" kanıtı sayılmıyor.

---

## 8. Ölçülemeyenler

Bunlar bilinmiyor ve bilinmiyor olarak kalıyor:

- **Gerçek (ölçülmüş) ürün sayısı.** Tablodaki sayılar Awin'in *ilanı*;
  `program_feeds.measured_item_count` ve `ingestable_count` hâlâ null.
- **Kaç satırın pipeline'dan geçeceği.** Zorunlu alan kolon olarak var, ama
  satır bazında dolu mu bilinmiyor.
- **Feed dosya boyutu** (gzip'li bayt).
- **Gerçek para birimi ve fiyat biçimi** (ondalık ayırıcı, binlik ayırıcı).
- **Deeplink'in izinli alan adına ait olup olmadığı** — `normalize.ts`
  ürün adresi mağazaya ait değilse satırı eliyor; bu kural ancak gerçek
  satırla sınanır.
- **Kota davranışı yük altında** — yalnızca kimliksiz hata kodları ölçüldü.

Hepsinin tek nedeni aynı: bu oturumda datafeed anahtarı yok.
