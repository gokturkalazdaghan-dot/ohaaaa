# Ödünç Ürün Vitrini — Mimari Karar Belgesi

**Durum:** Karar verildi (uygulanmadı).
**Kapsam:** Partnerlerden **on-demand** alınan ürün/teklif sonuçlarının nerede
yaşayacağı.
**Bu belge bir uygulama planı DEĞİLDİR.** Şema, kod, göç, API ve alım zinciri
bu belgeyle değişmez. Kararı yazar, sırayı yazmaz.

---

## 0 · Terim

**Ödünç teklif (borrowed offer):** Bir partnerin arama/ürün API'sinden, bir
kullanıcı isteği anında alınan ve bize ait OLMAYAN sonuç. Fiyatı biz ölçmedik,
tazeliğini biz garanti etmiyoruz, saklama hakkımız sınırlı.

**Sahip olunan teklif (owned offer):** Feed alımıyla gelen, `products`
tablosunda yaşayan, parmak izi tutulan, tazeliği ölçülen, fiyat geçmişi
biriktirilen satır.

İkisi aynı kelimeyle ("teklif") anılıyor ama aynı şey değiller ve bu belgenin
tamamı o farkın üstüne kurulu.

---

## 1 · İki veri sınıfı — ayrım

| | Sahip olunan (`products`) | Ödünç (partner API) |
|---|---|---|
| Kaynak | `sources` üzerinden feed alımı | kullanıcı isteği anında partner API |
| Yaşam süresi | kalıcı; bayatlayana kadar | dakikalar |
| Fiyat geçmişi | `price_points`'e yazılır | **yazılmaz** |
| Tazelik | `products_touch_freshness` ile ölçülür | partnerin söylediği ana güvenilir |
| Karşılaştırmaya girer mi | evet (`offer_count`, `min_price_cents`, `best_offer_id`) | **hayır** |
| SEO | indekslenir, site haritasında | **indekslenmez, site haritasında değil** |
| Silinince | bir olgu ("stokta yok") | bir bilgi yokluğu ("artık bilmiyoruz") |
| Sahiplik | bizim | partnerin |

Son satır, `packages/shared/src/partners.ts` içinde zaten yazılı olan kuralın
aynısı: **bilginin yokluğu, olumsuz bir cevap değildir.** Ödünç bir sonucun
önbellekten düşmesi "bu ürün yok" demek değildir; "şu an bilmiyoruz" demektir.
Altıncı sorunun cevabı buradan çıkıyor.

---

## 2 · Soru 1 — Ödünç teklif `products` içinde mi, ayrı mı?

### KARAR: Tamamen ayrı. `products` içine **asla** yazılmaz.

Bu bir tercih değil; `products` tablosunun bugünkü davranışı bunu imkânsız
kılıyor. Üretimde ölçüldü — `products` üzerinde **yedi** tetikleyici var:

```
products_record_price          products_sync_group_description
products_risk_gate             products_sync_group_stats
products_set_updated_at        products_sync_vendor_count
products_touch_freshness
```

Tek bir ödünç satır eklemek şunları yapardı:

1. **`products_record_price` → `price_points`.** Kalıcı fiyat geçmişine
   (bugün 52.796 satır) bizim ölçmediğimiz, beş dakika sonra doğrulayamayacağımız
   bir fiyat yazılır. `price_history`, `deal_score`, `price_anomaly` ve fiyat
   alarmları o geçmişten besleniyor. Ödünç fiyat oraya girerse **"fiyat düştü"
   bildirimi, hiç var olmamış bir düşüş için gider.** Geri alınamaz bir kirlilik.
2. **`products_sync_group_stats` → `product_groups` + `product_group_price_stats`.**
   `offer_count`, `min_price_cents`, `best_offer_id` her ödünç sonuçta
   yeniden yazılır. Kategori sayaçları ve "en ucuz" rozeti, sorgu geldikçe
   oynar. Kullanıcı sayfayı yenilediğinde farklı bir "en ucuz" görür.
3. **Yazma büyütmesi.** Bu depo aynı sorunla iki kez uğraştı
   (`products_yazma_buyutmesi`, `toplu_teklif_yazma_rpc`). Arama başına onlarca
   satır yazmak, o iki göçün çözdüğü şeyi geri getirir.

Ayrıca `products` şeması ödünç veriye uymuyor: `source_id`, `fingerprint`,
`external_id`, `status` alanlarının hepsi **bir feed'e sahip olmayı** varsayıyor.
Ödünç sonucun feed'i yok.

### Nerede yaşayacak: Vercel/Next veri önbelleği. Yeni tablo YOK.

Ödünç sonuç, isteği karşılayan sunucu fonksiyonunun **veri önbelleğinde**
(`unstable_cache`, depoda `onbellekle()` sarmalayıcısı) yaşar. Supabase'e
**sıfır** yazma, **sıfır** okuma ekler.

Bu, "gereksiz abstraction oluşturma" kuralının doğrudan uygulaması: yeni tablo,
yeni RLS, yeni göç, yeni temizlik cron'u — hiçbiri yok. Önbellek katmanı zaten
var ve sürüm kaldıracı (`KATALOG_SURUMU`) ile birlikte çalışıyor.

**Paylaşımlı bir Postgres önbelleği BİLEREK seçilmedi.** Tek gerekçesi partner
oran sınırlarını korumak olurdu; bugün tek bir partner API'si bağlı değil,
dolayısıyla o sınır **ölçülmemiş bir varsayım**. Ölçülmemiş bir varsayım için
tablo açmak, bu depoda tekrar tekrar reddedilen hamle. Bkz. OPEN DECISION 2.

---

## 3 · Soru 2 — `cache_key` nasıl üretilecek?

### KARAR: Tek satırlık, sürümlü, deterministik bir dize.

```
v1|<partner>|<market>|<country>|<currency>|<locale>|<intent>|<q>|<filters>|<page>
```

| Parça | Kaynak | Neden zorunlu |
|---|---|---|
| `v1` | sabit | Normalleştirme kuralı değişirse **bütün** anahtarlar geçersizleşmeli. `KATALOG_SURUMU` ile aynı kaldıraç, aynı sebep. |
| `partner` | `amazon`, `ebay`, `cj`, `impact`, `rakuten`, `awin` | Aynı sorgu iki partnerde iki farklı sonuç. Karışırsa bir partnerin sonucu diğerinin adıyla gösterilir. |
| `market` | `markets.code` (41 kayıt) | Ticari bölge. |
| `country` | `countries.code` | **Pazardan AYRI.** Depo bunu zaten yazıyor: pazar ≠ ülke ≠ para birimi. Amazon/eBay pazaryerleri ülke bazlı; `EU` tek anahtar olsaydı Almanya sonucu İspanya'ya servis edilirdi. |
| `currency` | ISO 4217 (21 kayıt) | Fiyat mezhebi. Aynı sorgu EUR ve TRY'de farklı sonuç/sıralama verir. |
| `locale` | `urlLocale` | Partner başlık/açıklamayı dile göre döndürür. |
| `intent` | `search` \| `lookup` | Serbest metin araması ile GTIN/ASIN ile tekil arama aynı anahtara düşmemeli. |
| `q` | **normalize edilmiş** sorgu | Aşağıda. |
| `filters` | kanonik sıralı JSON'un hash'i | **Yalnızca partnere GÖNDERİLEN filtreler.** Gönderilmeyen bir filtreyi anahtara koymak önbelleği boşuna böler. |
| `page` | tamsayı | Partner sayfalıyorsa. Sayfalamıyorsa sabit `1`. |

### Normalleştirme: tek kaynak, ikinci kopya yasak

`q` normalleştirmesi **`@ohaaaa/shared` içinde tek bir fonksiyon** olmalı ve
hem anahtarı üreten taraf hem de (varsa) başka her taraf onu çağırmalı.

Bu kural bedeli ödenerek öğrenildi: `categorySlugKey` bir kez iki yere
kopyalandı, kopyalar ayrıştı ve `Ev & Yaşam` değeri bir katmanda eşleşip
diğerinde eşleşmedi. Aynı hata burada **önbellek zehirlenmesi** olarak çıkar:
aynı sorgu iki anahtar üretir, biri taze biri bayat sonuç servis eder.

Normalleştirme en az şunları yapmalı: kırp, Türkçe noktalı/noktasız İ'yi
açıkça ele al (`'İ'.toLowerCase()` JavaScript'te **iki** karakter üretir —
bu depoda ölçülmüş bir tuzak), küçük harfe indir, aksanı ayıkla, ardışık
boşluğu tekille.

### Anahtara GİRMEYECEKLER

Kullanıcı kimliği, oturum, çerez, IP, `subid`, tıklama bağlamı. Önbellek
kişiselleştirilmiş olmamalı; olursa hem isabet oranı çöker hem de bir
kullanıcının sonucu başkasına servis edilme riski doğar.

---

## 4 · Soru 3 — TTL ve bayat sonuç

### KARAR: İki eşikli, partner başına yapılandırılabilir, muhafazakâr varsayılan.

```
t0 ──────── fresh_until ──────────── hard_expiry ──────→
   doğrudan     arka planda tazele        ASLA gösterme
   servis       + eskisini servis et      (partner izin veriyorsa)
```

| Eşik | Varsayılan | Kural |
|---|---|---|
| `fresh_until` | **15 dakika** | Fiyat taşıyan sonuç. Doğrudan servis edilir. |
| `hard_expiry` | **60 dakika** | Bu andan sonra fiyat **hiçbir koşulda** gösterilmez. |

Varsayılanlar `ONBELLEK` katmanlarıyla aynı mantıkta: bugün en kısa katman
`listeleme: 600` (10 dk) ve gerekçesi "fiyatlar beslemeyle değişir". Ödünç
fiyat daha oynaktır ve **bize ait değildir**; bu yüzden sert bir üst sınır var.

### Üç bağlayıcı kural

1. **`hard_expiry` partnerin sözleşmesel üst sınırını AŞAMAZ.** Bazı partner
   API şartları fiyat saklamayı süreyle sınırlar. Gerçek sayılar okunmadan
   yazılamaz → **OPEN DECISION 1.** Kod tarafı bunu partner başına
   yapılandırılabilir bir değer olarak taşımalı, sabit gömmemeli.
2. **Stale-while-revalidate yalnızca partner izin veriyorsa.** İzin yoksa
   tek eşik vardır: `hard_expiry` ve bayat sonuç hiç servis edilmez.
3. **Fiyat, "şu an itibarıyla" damgası olmadan gösterilmez.** Ekranda
   görünür bir tazelik ifadesi zorunlu. Damgasız fiyat, bizim ölçtüğümüz
   fiyat gibi okunur — oysa değil.

### Bayat sonuç bir HATA değildir

`hard_expiry` aşıldığında blok **sessizce kaybolur**. Hata sayfası yok, 404 yok,
"veri alınamadı" yok. Ödünç blok bir EK'tir; yokluğu sayfanın kendisini
etkilememelidir.

---

## 5 · Soru 4 — `product_groups` ile ilişki

### KARAR: Varsayılan olarak ilişkilendirilmez. Kalıcı bir bağ ASLA yazılmaz.

Ödünç teklif `product_groups`'a **yazmaz**: ne `group_id` alanı taşır, ne yeni
grup açar, ne mevcut grubun `offer_count`/`min_price_cents`/`best_offer_id`
değerlerini etkiler.

### Okuma anında, yalnızca GTIN ile, yalnızca bellek içinde

Bir ödünç sonuç bir kanonik ürünle **yalnızca** şu koşulda yan yana gösterilir:

- Partner bir GTIN/EAN/UPC döndürdü, **ve**
- `normalize_gtin` ile normalleştirilmiş hâli bir `product_groups.gtin` ile
  **birebir** eşleşti.

Bu eşleşme **hesaplanır, saklanmaz**. Sayfa kapandığında bağ da biter.

### Başlık/marka imzasıyla eşleştirme YASAK

Alım hattı sahip olunan teklifler için imza eşleştirmesi kullanıyor
(`canonical_product_key`, `product_signature`) ve orada doğru: yanlış eşleşme
bir sonraki turda düzeltilebilir, veri bizim.

Ödünç teklifte aynı şey **kanonik ürün sayfasında yanlış bir fiyat göstermek**
demektir ve o sayfa bizim vaadimiz. Bu deponun kategori tarafında verdiği
kararın aynısı geçerli: *yanlış eşleşme, eşleşmemekten zararlıdır.*

GTIN yoksa ödünç sonuç kendi bloğunda, kanonik ürüne bağlanmadan durur.

---

## 6 · Soru 5 — Alım zincirinden izolasyon

### KARAR: İzolasyon bir bayrakla değil, **yokluk** ile sağlanır.

`ingest_mark_stale_offers(p_source_id uuid, p_run_started_at timestamptz)`
**`source_id` kapsamlıdır** (doğrulandı). Dolayısıyla:

> Ödünç teklifin `products` içinde satırı olmadığı için, bayatlatma
> fonksiyonunun ona dokunması **fiziksel olarak mümkün değildir.**

Bayrak tabanlı bir izolasyon (`products.is_borrowed` gibi) bunu sağlamazdı:
bayrağı unutan tek bir sorgu izolasyonu sessizce delerdi. Yokluk unutulamaz.

### Bağlayıcı değişmezler

1. Ödünç veri şu tabloların **hiçbirine** yazmaz:
   `products`, `product_groups`, `price_points`, `product_group_price_stats`,
   `product_group_markets`, `clicks` (ölçüm hariç), `conversions`.
2. Partner arama API'si için **`sources` tablosunda satır açılmaz.** `sources`
   bugün 3 satır ve hepsi `feed_csv`. Ödünç partner oraya girerse zamanlayıcı
   (`due_sources`, `schedule_due_sources`) onu bir feed sanıp alım işi kurar.
3. Ödünç önbellek ile katalog tabloları arasında **iki yönde de yabancı anahtar
   yoktur.** Birbirlerini tanımazlar.
4. Alım hattının hiçbir aşaması (`normalize`, `matchCanonicalGroups`,
   `resolveCategoryIds`, `kaynakKategorileriniCoz`) ödünç veriyi görmez.
5. Ödünç çağrı **cron'dan yapılmaz.** Yalnızca canlı kullanıcı isteğiyle
   tetiklenir. Cron'a girerse alım penceresiyle yarışır ve partner oran
   sınırını alım turunun ortasında tüketir.

### Nasıl kanıtlanacak (uygulama aşamasında)

Bir CI iddiası, ödünç önbelleğin katalog tablolarına yabancı anahtarı
olmadığını ve `sources` içinde feed dışı `kind` bulunmadığını doğrular.
Bu belge o testi **şart koşar**, yazmaz.

---

## 7 · Soru 6 — Partner sonucu önbellekten silindiğinde ne gösterilir?

### KARAR: Blok kaybolur. Fiyat asla hayatta kalmaz. Sayfa asla bozulmaz.

| Bağlam | Davranış |
|---|---|
| Kanonik ürün sayfası | Ödünç blok çizilmez. Sayfa sahip olunan tekliflerle tam çalışır. |
| Kategori sayfası | Etkilenmez — ödünç veri zaten kategori sayfasına girmez. |
| Arama sonucu (karma) | Sahip olunan sonuçlar kalır; ödünç bölüm çizilmez. |
| Arama sonucu (yalnızca ödünç) | "Şu an sonuç gösteremiyoruz, tekrar deneyin." **Hata değil, boşluk.** |

### Neden "ürün yok" YAZILMAZ

`partners.ts` kuralı burada da geçerli: **bilginin yokluğu, olumsuz bir cevap
değildir.** Önbellekten düşmüş bir sonuç, partnerin o ürünü artık satmadığı
anlamına gelmez — yalnızca bizim artık bilmediğimiz anlamına gelir. "Ürün yok"
demek, bilmediğimiz bir şeyi olgu gibi sunmaktır.

### SEO: ödünç içerik dizine GİRMEZ — birinci günden

- Ödünç sonuç taşıyan sayfa/bölüm `noindex`.
- Site haritasına **girmez**.
- Kanonik etiket **almaz**.

Gerekçe: önbellekten düşünce kaybolan içerik, ölçekte **soft-404 üretir**.
Bu depo 404/301 ayrımının bedelini bir kez ödedi; aynı hatayı ödünç veride
tekrarlamak, bu sefer binlerce adreste olurdu.

---

## 8 · Yük bütçesi

**Supabase'e eklenen yük: sıfır.** Ödünç yol veritabanına dokunmaz.

**Vercel tarafı sınırları:**

| Sınır | Değer | Gerekçe |
|---|---|---|
| Tetikleme | yalnızca açık kullanıcı niyeti | Katalog sayfası açılışında, prefetch'te, cron'da **yok**. |
| Partner başına zaman aşımı | kısa ve sabit | Yavaş bir partner fonksiyonu tutamaz. Referans: `anon` deyim zaman aşımı 3 sn, `authenticated` 8 sn. |
| Eşzamanlı partner | sıralı geri çekilme, hepsine birden değil | "Altı partnere paralel sor" tasarımı, altı kat maliyet ve en yavaşın gecikmesi demektir. |
| Başarısızlık | sessiz düşüş | Partner hata verirse blok çizilmez; istek düşmez. |

---

## 9 · Altı partner aynı modele nasıl bağlanır

Model partnere özel hiçbir şey varsaymıyor. Bir partneri bağlamak için gereken
tek şey, üç işi yapan ince bir adaptör:

1. **İstek:** normalize sorgu + market/ülke/para birimi → partnerin çağrısı.
2. **Cevap:** partnerin gövdesi → ortak ödünç teklif şekli
   (başlık, fiyat+para birimi, mağaza adı, ürün adresi, görsel, varsa GTIN,
   partnerin verdiği tazelik damgası).
3. **Şartlar:** bu partnerin `hard_expiry` üst sınırı ve zorunlu atıf metni.

Amazon, eBay, CJ, Impact, Rakuten ve Awin bu üç maddeye sığar. `cache_key`
şeması partneri zaten bir parça olarak taşıyor; yeni partner **anahtar şemasını
değiştirmez**, yalnızca yeni bir değer ekler.

**Bilerek yapılmayan genelleme:** "partner türü" hiyerarşisi, eklenti kaydı,
soyut yetenek keşfi yok. Altı adaptör, tek arayüz, bir seçim noktası. Üçüncü
partner bağlandığında tekrar eden bir şey görülürse o zaman ortaklaştırılır —
şimdi değil.

---

## 10 · Bilerek YAPILMAYANLAR

| Yapılmadı | Neden |
|---|---|
| `products.is_borrowed` bayrağı | Bayrağı unutan tek sorgu izolasyonu deler. Yokluk unutulamaz. |
| Ödünç teklif için `sources` satırı | Zamanlayıcı onu feed sanar ve alım işi kurar. |
| Paylaşımlı Postgres önbellek tablosu | Tek gerekçesi ölçülmemiş bir oran sınırı varsayımı. Bkz. OPEN DECISION 2. |
| Ödünç veriden `product_groups` açmak | Katalogumuz partnerin sözlüğüyle büyümez — taksonomi kararının aynısı. |
| Ödünç fiyatı `price_points`'e yazmak | Fiyat alarmları ve düşüş rozeti hiç olmamış bir düşüş için tetiklenir. |
| Ödünç sonucu indekslemek | Ölçekte soft-404. |
| Partner cevabını uzun süre saklamak | Saklama hakkımız sınırlı; bkz. OPEN DECISION 1. |

---

## 11 · OPEN DECISIONS

> Bunlar "sonra bakarız" değil; **karar vermek için elimde kanıt olmayan**
> noktalar. Kanıt gelmeden kod yazılmamalı.

**OPEN DECISION 1 — Partner başına sözleşmesel saklama üst sınırı.**
Her partnerin API şartları fiyat/veri saklamayı farklı sürelerle sınırlayabilir.
Gerçek sayıları okumadan yazmak, doğrulanmamış bir varsayımı koda gömmek olurdu.
*Kapanması için gereken:* altı partnerin API şartlarının okunup partner başına
`hard_expiry` üst sınırının tabloya yazılması.
*Bu arada:* varsayılan 60 dk ve partner başına yapılandırılabilirlik yeterli.

**OPEN DECISION 2 — Paylaşımlı önbellek katmanı gerekli mi?**
Next veri önbelleği bölge bazlıdır; çok bölgeli trafikte aynı sorgu birden çok
kez partnere gidebilir. Bu, partner oran sınırını zorlar **mı**, bilmiyoruz —
bağlı partner yok, ölçüm yok.
*Kapanması için gereken:* ilk partner bağlandıktan sonra önbellek isabet oranı
ve partner oran sınırı ölçümü.
*Karar kuralı:* ölçüm sınırın zorlandığını gösterirse paylaşımlı katman eklenir;
göstermezse **eklenmez**.

**OPEN DECISION 3 — Ödünç teklif kanonik ürün sayfasında görünsün mü?**
Bu mimari değil **ürün/marka** kararı: doğrulayamadığımız bir fiyatı kendi
karşılaştırma sayfamızda göstermek güven açısından ne ifade eder?
Mimari her iki cevabı da destekliyor (GTIN eşleşmesi zaten okuma anında).
*Kapanması için gereken:* ürün tarafının kararı.
*Varsayılan (karar gelene kadar):* **hayır** — yalnızca arama yüzeyinde.

**OPEN DECISION 4 — Zorunlu atıf/ibare metinleri.**
Bazı partnerler fiyat gösterimiyle birlikte belirli bir metin ister.
*Kapanması için gereken:* partner şartlarının okunması (OPEN DECISION 1 ile
aynı tur).

**OPEN DECISION 5 — İlk partner hangisi?**
Mimari açısından fark etmez; sıra iş kararıdır. Bu belge bir tercih dayatmıyor.

---

## 12 · Bu belge neyi DEĞİŞTİRMEDİ

Hiçbir şeyi. Kod, göç, şema, API, alım zinciri, Awin akışı ve QUALIFY
tarafı bu belgeyle **olduğu gibi** duruyor. Mevcut katalog (43.160 ürün grubu,
45.321 teklif) ve alım hattı bu kararlardan etkilenmez — çünkü kararların
tamamı **yeni ve ayrı** bir yüzey hakkında.

---

DECISION:
Ödünç partner sonuçları `products` ve genel olarak katalog şemasının **dışında**,
yalnızca Vercel/Next veri önbelleğinde yaşar; yeni tablo, yeni göç ve yeni
`sources` kaydı açılmaz. Anahtar sürümlü ve deterministiktir
(`v1|partner|market|country|currency|locale|intent|q|filters|page`), normalleştirme
`@ohaaaa/shared` içinde **tek** kaynaktan gelir. İki eşik kullanılır —
varsayılan 15 dk taze / 60 dk sert son, partner başına yapılandırılabilir ve
partnerin sözleşmesel sınırını asla aşmaz. Kanonik ürünle ilişki yalnızca
**normalleştirilmiş GTIN birebir eşleşmesiyle, okuma anında ve bellekte** kurulur;
kalıcı bağ yazılmaz. Alım zincirinden izolasyon bayrakla değil **yokluk** ile
sağlanır: `products` içinde satır olmadığı için `ingest_mark_stale_offers`
(`source_id` kapsamlı) ona erişemez. Önbellekten düşen sonuçta blok sessizce
kaybolur, "ürün yok" denmez, ödünç içerik hiçbir zaman indekslenmez.

WHY:
`products` üzerinde yedi tetikleyici var; ödünç bir satır `price_points`'e
(52.796 satırlık kalıcı fiyat geçmişi) bizim ölçmediğimiz bir fiyat yazar ve
"fiyat düştü" bildirimi hiç olmamış bir düşüş için gider, ayrıca
`offer_count`/`best_offer_id` her sorguda oynar ve bu deponun iki göçle çözdüğü
yazma büyütmesi geri gelir. Ödünç veriyi dışarıda tutmak bu üç arızayı birden
imkânsız kılar; izolasyonu yoklukla kurmak, unutulabilecek bir bayrağa
güvenmekten güçlüdür; önbelleği veritabanına koymamak Supabase yükünü sıfırda
tutar ve ölçülmemiş bir oran sınırı varsayımı için tablo açmayı önler.

NEXT SINGLE IMPLEMENTATION STEP:
Altı partnerin (Amazon PA-API, eBay, CJ, Impact, Rakuten, Awin) API şartlarındaki
veri/fiyat saklama üst sınırlarını oku ve partner başına `hard_expiry` tavanını
bu belgeye bir tabloya yaz — OPEN DECISION 1'i kapat. Kod yazılmaz; o tavan
bilinmeden yazılacak her TTL doğrulanmamış bir varsayım olur.
