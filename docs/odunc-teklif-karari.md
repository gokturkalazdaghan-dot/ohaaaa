# Ödünç Teklif Kararı

**Durum:** Kabul edildi (mimari karar). Uygulanmadı.
**Kapsam:** Partner'lardan istek anında (on-demand) alınan ürün/teklif
sonuçlarının nerede yaşayacağı.
**Kapsam dışı:** Mevcut feed alım hattı, Awin puanlama/QUALIFY sistemi,
`products`/`price_points`/`product_group_price_stats` şeması. Bu belge
onların hiçbirine dokunmaz ve dokunulmasını önermez.

Bu belge bir uygulama planı değildir. Altı soruyu kesin cevaplar, kalan
belirsizlikleri **OPEN DECISION** olarak işaretler.

---

## 0. Neden bu belge önce yazılıyor

Denetimde çıkan tek yapısal boşluk şuydu: **ödünç bir teklifin yaşayacağı
yer tanımlı değil.** Adaptör, provider sözleşmesi, kota defteri, Amazon/eBay
kaydı — hepsi bu kararın çıktısına bağlı. Karar verilmeden yazılan her
satır sonra geri alınır.

Ve bir tuzak var: ödünç sonucu bugün `products` tablosuna yazmak, onu
`ingest_mark_stale_offers`'ın süpürme alanına sokar. Yani **çalışan sistemi
bozacak tek hamle, en kolay görünen hamledir.** Bu belgenin asıl işi o
hamleyi kapatmaktır.

---

## 1. Kalıcı veri ile ödünç veri

Ayrım tek cümleye iner:

> **Karşılaştırmayı mümkün kılan kimlik kalıcıdır. Karşılaştırılan değer
> ödünçtür.**

| | Kalıcı (Supabase, kayıt otoritesi) | Ödünç (cache, otorite değil) |
|---|---|---|
| Ne | `product_groups` (kanonik kimlik, slug, GTIN, `match_signature`, kategori) | Partner arama sonucu: başlık, fiyat, stok, görsel, satıcı adı, deeplink |
| Ne | `price_points` (fiyat geçmişi) | — |
| Ne | `product_group_price_stats` (para birimi başına min/max/en iyi teklif) | — |
| Ne | `products` (feed'den gelen teklif) | — |
| Ne | `merchants`, `sources`, `programs`, `program_feeds`, `affiliate_networks` | — |
| Ne | `clicks`, `conversions`, `payouts` | — |
| Ne | `categories`, `category_source_map` | — |
| Kim yazar | Alım turu ve operatör | Yalnızca okuma yolu, yalnızca cache'e |
| Ömür | Süresiz | TTL |
| Kaybı | Veri kaybı | Kayıp değil — yeniden istenir |
| SEO | Kalıcı adres, indekslenir | **Adres yok, indekslenmez** |

Son satır kritik ve §6'da gerekçelendiriliyor.

---

## 2. Soru 1 — Ödünç teklif `products` içinde mi, ayrı mı?

### KARAR: Tamamen ayrı. `products` tablosuna **hiçbir koşulda** yazılmaz.

Ödünç teklif, Postgres dışında bir anahtar-değer cache'inde, `cache_key`
başına **tek bir normalize edilmiş JSON belgesi** olarak yaşar.

### Neden `products` içinde bir `is_borrowed` bayrağı değil

Bayrak çözümü, `products`'a değen **her** sorgunun, her RPC'nin ve
`ingest_mark_stale_offers`'ın o bayrağı filtrelemeyi hatırlamasını ister.
Biri unutulduğunda sonuç sessizdir: ödünç bir teklif ya kalıcı katalogda
donar ya da süpürücü tarafından silinip her aramada yeniden yazılır.

Yapısal ayrım disiplin istemez. Süpürücü ödünç teklifi **göremez**, çünkü
o satır o tabloda yoktur. Bu depo aynı dersi zaten ödemiş: *"iki doğruluk
kaynağı zamanla ayrışır ve ayrışma sessizdir."*

### Neden Postgres'te ayrı bir tablo da değil

Ölçülen yük buna izin vermiyor. `20260919110000_products_yazma_buyutmesi.sql`
üretimden şunu kaydediyor: `products` üzerinde `n_tup_upd = 146.151`,
`n_tup_hot_upd = 3` — **HOT oranı %0,0**, yani bir satır güncellemesi
tablonun bütün indekslerini yeniden yazdırıyor. Teklif başına ~7 tetikleyici
ayrıca çalışıyor (`products_record_price`, `products_sync_group_stats`,
`products_sync_group_description`, `products_sync_vendor_count`,
`products_risk_gate`, `products_touch_freshness`, `products_set_updated_at`).

Ödünç teklifi Postgres'e yazmak, bu maliyeti **kullanıcı isteğinin sıcak
yoluna** taşımak demektir. Alım turu bu yükü 6 saatte bir, arka planda ve
bütçeyle ödüyor ve yine de `statement_timeout`a çarpmıştı (#80, #82, #84).
Aynı yükü her aramada ödemek, çözdüğümüz sorunu daha kötü bir yere taşımaktır.

İkinci gerekçe kötüye kullanım: sorgu tarafından sürülen bir yazma yolu,
**herkesin arama kutusuna yazarak veritabanımızı şişirebildiği** bir yoldur.

### Sonuç

- **Okuma yolu Postgres'e yazmaz.** Tek istisna yok.
- Supabase kalıcı verinin kayıt otoritesi olarak **olduğu gibi kalır**.
- Cache, otorite değildir; kaybı veri kaybı sayılmaz.

### OPEN DECISION 1 — Cache altyapısı

Karar verilen: Postgres dışında, açık TTL'li, açık anahtarlı bir KV.
Karar verilmeyen: hangisi.

| Aday | Lehte | Aleyhte |
|---|---|---|
| Next.js Data Cache (`unstable_cache`) | Zaten var, ek maliyet yok | `onbellek.ts:26-44`'te belgelenen arıza: bayat girdi arka planda tazelenirken **hata yutuluyor** ve bayat değer dönmeye devam ediyor. Anahtar listelenemiyor, seçici tahliye yok. |
| Vercel KV / Upstash Redis | Açık TTL, atomik sayaç (kota defteri için), çok bölgeli okuma | Ek servis, ek maliyet |

Karar kriteri: **kota defteri atomik sayaç istiyor** (§5). Bunu Data Cache
veremez. Bu tek başına Redis'e işaret ediyor, ama maliyet verisi depoda yok.
Ölçülecek: tahmini günlük benzersiz `cache_key` sayısı ve ortalama belge boyutu.

---

## 3. Soru 2 — `cache_key` nasıl üretilir

```
ob:{v}:{partner}:{market}:{currency}:{locale}:{page}:{sha256(query_norm)[0..15]}
```

| Bileşen | Kaynak | Neden içeride |
|---|---|---|
| `ob` | sabit önek | Anahtar uzayını diğer kullanımlardan ayırır |
| `v` | cache şema sürümü | Normalizasyon ya da yük biçimi değişince **tüm** cache bir hamlede geçersizleşir. Depo bu kalıbı zaten kullanıyor: `KATALOG_SURUMU = 'v3'` (`onbellek.ts:59`) |
| `partner` | `affiliate_networks.code` | İki partner aynı sorguya farklı cevap verir. Ayrılmazsa "en ucuz" iddiası rastgele olur |
| `market` | `markets.code` | Aynı sorgu DE ve TR'de farklı ürün, farklı satıcı, farklı stok döndürür |
| `currency` | ISO-4217 | Depo bu dersi ödedi: `product_group_price_stats` yorumu — *"Tek bir min() iki para birimini kiyaslarsa dusuk mezhepli olan her zaman kazanir."* Cache'te de karışırsa aynı hata cache'e gömülür |
| `locale` | `locales` | Partner başlıkları yerelleştirilmiş döner. CH pazarı tek para birimi, üç dil — `market` locale'i türetmeye yetmez |
| `page` | tamsayı, **3 ile sınırlı** | Partner yalnızca bir sayfa döndürür; sayfa anahtarın parçası olmazsa 2. sayfa 1. sayfayı ezer |
| `sha256(query_norm)[0..15]` | normalize sorgu | Ham sorgu sınırsız uzunlukta, çok baytlı ve anahtar olarak taşınamaz |

### `query_norm` — pinlenmiş normalizasyon

Sıra sabittir ve `v` ile sürümlenir:

1. Unicode NFKD
2. Birleştirici aksan işaretlerini düşür (`é→e`, `ü→u`, `ı→i`, `ş→s`)
3. `toLowerCase()` (dile duyarsız invariant)
4. Alfanümerik, boşluk, `-` ve `+` dışındaki her şeyi düşür
5. Ardışık boşlukları teke indir, kırp
6. Belirteçleri alfabetik sırala — *"sony kulaklık"* ile *"kulaklık sony"*
   aynı partner isteğidir

### Bu normalizasyon `public.normalize_search` DEĞİLDİR — bilinçli

`normalize_search` yalnızca Türkçe karakterleri katlar (`init_schema.sql:53`).
Global bir vitrinde bu eksiktir: `é`, `ñ`, `å` listede yok.

Depo kuralı *"iki doğruluk kaynağı ayrışır"* burada **geçerli değil**, çünkü
ikisi farklı iş yapıyor:

- `normalize_search` → kendi kataloğumuzun `tsvector`'ünü besler. Ayrışırsa
  **yanlış sonuç** döner.
- `query_norm` → yalnızca opak bir cache anahtarı üretir. Gösterilen hiçbir
  şeyi etkilemez. Ayrışırsa bedeli **bir cache ıskası**, yani bir fazladan
  partner isteğidir.

Farklı maliyet, farklı kural. Yine de ikisinin aynı olduğu **iddia
edilmemeli**; isimlendirme ayrı tutulur.

### Anahtarda BULUNMAYANLAR ve nedeni

- **Sıralama ve filtreler dışarıda.** Cache partner'ın **ham sonuç kümesini**
  tutar; sıralama ve filtreleme bizim kodumuzda, bellekte yapılır. İçeride
  olsalardı her filtre kombinasyonu ayrı bir partner isteği olurdu —
  kardinalite patlar, kota yanar, isabet oranı çöker.
- **Kullanıcı kimliği dışarıda.** Ödünç sonuç kişiselleştirilmez. İçeride
  olsaydı cache paylaşılamazdı ve bütün amaç kaybolurdu.

---

## 4. Soru 3 — TTL ve bayat sonuç

### Tek girdi, tek TTL

Girdi bölünmez. Fiyat ve başlık ayrı TTL'lerle saklanmaz. TTL, girdideki
**en kısa ömürlü alana** (fiyat) göre seçilir.

Gerekçe: ikiye bölmek iki tazeleme yolu, iki tutarlılık penceresi ve
"başlık taze, fiyat bayat" gibi açıklanamayan bir ara durum üretir.
Kazanç, ek karmaşıklığı karşılamıyor.

### Üç durum

| Durum | Pencere | Davranış |
|---|---|---|
| **Taze** | 0 – 15 dk | Doğrudan sunulur |
| **Bayat** | 15 dk – tavan | Sunulur, **gözlem zamanı ekranda görünür**, arka planda tazeleme tetiklenir |
| **Süresi dolmuş** | tavan üstü | **Fiyat sunulmaz.** Girdi yok sayılır (§6) |

### Bayat sunmanın şartı: sessiz olmamak

Bu deponun ödediği en pahalı cache dersi `onbellek.ts:26-44`'te yazılı:
bayat girdi arka planda tazelenir, **tazeleme düşerse hata yutulur ve bayat
değer dönmeye devam eder.** 34.722 grup taşındıktan sonra vitrin bir saatten
uzun süre eski ağacı sundu.

Bu yüzden bayat sunmanın üç şartı var ve üçü de zorunlu:

1. **Gözlem zamanı ekranda.** "12 dk önce görüldü" — kullanıcı neye baktığını bilir.
2. **Başarısız tazeleme sayılır.** Yutulmaz; partner başına arıza sayacı artar.
3. **Giden link her zaman canlı.** Gerçek fiyat partner'ın sayfasındadır.
   Kullanıcı bir tıkla doğruya ulaşır — bayat verinin emniyet supabı budur.

Üçüncüsü aynı zamanda hukuki gerekçedir. Bu depo indirim iddiasını zaten
denetlenebilir kılmak zorunda (`20260830120000_price_history.sql`: Ticari
Reklam ve Haksız Ticari Uygulamalar Yönetmeliği, son 30 günün en düşüğü).
Bayat bir fiyatı **güncelmiş gibi** göstermek aynı sorunun başka biçimidir.

### OPEN DECISION 2 — Partner başına TTL tavanı

Tavan bizim tercihimiz değil, **sözleşme konusu**. Amazon Associates ve eBay
Partner Network'ün fiyat gösterim/tazeleme süreleri hakkında yaygın bir
kanaat var ama **depoda doğrulanmış kanıt yok** ve `affiliate_networks`
satırlarının tamamı `contract_verified = false`.

`partners.ts`'in kuralı burada da geçerli: *"BİLGİNİN YOKLUĞU, OLUMSUZ BİR
CEVAP DEĞİLDİR"* — ama ihtiyatlı varsayılan seçmeyi engellemez.

Bu yüzden kural şu: **`contract_verified = false` olduğu sürece o partner
için tavan 24 saattir ve bu bir üst sınır, bir hedef değil.** Tavan ancak
sözleşme doğrulanıp `docs_url` + `verified_at` girildikten sonra gevşetilebilir
— `affiliate_networks_verified_needs_evidence` kısıtının zaten istediği kanıt.

---

## 5. Soru 4 — `product_groups` ile ilişki

### KARAR: Okuma yolu grup **oluşturmaz**. Yalnızca arar.

Ödünç teklif, `product_groups` ile **render anında, salt okunur** eşleştirilir.
Eşleştirme mevcut kimlik kurallarını kullanır — yenisi yazılmaz:
GTIN → normalize marka+başlık imzası (`matchCanonicalGroups`,
`pipeline.ts:703`; `docs/architecture.md` §2).

Üç sonuç:

| Sonuç | Gösterim | Postgres'e yazma |
|---|---|---|
| **Eşleşti** | Grubun sayfasında, feed tekliflerinin yanında, "ödünç" etiketi ve gözlem zamanıyla | Yok |
| **Eşleşmedi** | Arama sonuçlarında tekil kart. Kalıcı adresi yok | Yok |
| **Talep birikti** | — | Ayrı, kısıtlı, **çevrim dışı** bir iş grubu açabilir |

### Neden okuma yolunda grup açılmıyor

İki sebep, ikisi de yeterli:

1. **Sınırsız büyüme.** Her arama bir grup açsaydı `product_groups` kullanıcı
   sorgularının hızında büyürdü. Kanonik kimlik bu projenin tek hendeği; onu
   denetimsiz doldurmak değersizleştirir.
2. **Saldırı yüzeyi.** Arama kutusuna yazan herkesin kalıcı tabloya satır
   ekleyebildiği bir yol, oran sınırından bağımsız olarak yanlıştır.

### Terfi (promotion) — ayrı ve çevrim dışı

Ödünç bir ürün kalıcı kataloğa ancak **talep kanıtıyla** girer ve bu kararı
okuma yolu değil, ayrı bir iş verir. Girdisi talep kaydıdır (sorgu → çözüldü/
çözülemedi); çıktısı bir `product_groups` satırı ve mümkünse gerçek bir
`sources` ilişkisidir.

Bu, hedef mimarinin *"ihtiyaç oldukça al"* ilkesinin kalıcı tarafıdır:
**katalog trafiğin peşinden büyür, trafiğin önünden değil.**

### OPEN DECISION 3 — Terfi eşiği

Kaç farklı oturum, kaç gün içinde aynı ürünü istemeli? Depoda bu kararı
verdirecek trafik verisi yok. İlk sürüm eşiksiz çıkabilir (terfi kapalı,
yalnızca talep kaydı toplanır); eşik ölçümden sonra konur.

### OPEN DECISION 4 — Talep kaydı nereye

Hacim bilinmiyor. Düşükse Postgres'te bir tablo yeter; yüksekse sıcak yolda
Postgres yazması §2'nin gerekçesine çarpar ve kayıt bir log drain'e gitmelidir.
Ölçülecek: günlük ıska sayısı.

---

## 6. Soru 5 — Feed-ingest zincirinden izolasyon

İzolasyon **yapısaldır**, bayrakla ya da konvansiyonla değil. Altı kural,
altısı da "yazmıyoruz" biçiminde — yani unutulabilecek bir adım içermiyor:

1. **`products`'a satır yazılmaz.** `ingest_mark_stale_offers` ödünç teklifi
   göremez; filtrelemesi gerekmez. İzolasyonun tamamı bu maddeye dayanıyor.
2. **`source_id` verilmez.** Ödünç teklif `sources`, `jobs`, `ingest_runs`,
   anlık görüntü bütünlüğü (`snapshotComplete`) ve `ingest_touch_seen`
   kavramlarının hiçbirine girmez.
3. **`price_points`'e yazılmaz.** Fiyat geçmişi mevzuat iddiasını taşıyan
   seridir (§4). Ödünç gözlemler seyrektir — yalnızca biri aradığında oluşur —
   ve seriyi trafiğe göre yanlı hale getirir. Yanlı bir seriye dayanan
   "%X indirim" iddiası denetlenebilir değildir.
4. **`product_group_price_stats`'a yazılmaz.** O istatistik `products`
   üzerindeki tetikleyiciyle korunur; oraya ödünç değer sokmak hem sıcak yolda
   Postgres yazması hem de süpürücüsü olmayan kalıcı bir bayat değer demektir.
5. **Tetikleyici, RPC, yabancı anahtar yok.** Ödünç taraftan kalıcı tarafa
   tek bir veritabanı bağı kurulmaz.
6. **Alım turu ödünç cache'i okumaz.** Bağımlılık tek yönlüdür: ödünç taraf
   kalıcı tarafı okur, tersi olmaz.

### Sıcak yolda Postgres okumasını da sıfıra indirmek

Grup çözümlemesi (§5) bir indeksli okuma ister. Bu okuma **cache yazılırken
bir kez** yapılır ve sonucu (`group_id`) belgenin içine gömülür. Böylece
**cache isabeti sıfır Postgres okumasıdır.**

Bedeli: grup birleştirilir ya da silinirse gömülü `group_id` yanlış kalabilir —
bu depo kategori ve grup birleştirmesi yapıyor (#86). Karşılığı ucuz: render
anında `group_id` çözülmezse teklif tekil karta düşer. Yanlış sayfaya
yapıştırmaktansa tekil göstermek doğrudur.

### Kota defteri

Partner çağrıları kota ister (Amazon'un gelire bağlı TPS'i, eBay'in günlük
tavanı). Sayaç **cache ile aynı KV'de**, atomik artırmayla tutulur.
Postgres'teki `api_rate_counters` / `ai_rate_counters` emsali sıcak yolda
bu hacme göre tasarlanmadı. `source_breakers` ise kaynak başına devre
kesicidir — kota defteri değil — ve olduğu gibi kalır.

### Kabul edilen bedel: iki yüzey, iki "en ucuz"

Liste sayfaları `product_group_price_stats` üzerinden sıralanır ve bu
istatistik **yalnızca feed tekliflerini** bilir. Ürün detay sayfasında ise
ödünç teklifler bellekte birleştirilir.

Sonuç: liste kartı 100 ₺ derken detay sayfası Amazon'dan 92 ₺ gösterebilir.
**Bu bilinen ve kabul edilmiş bir borçtur.** Alternatifi — ödünç fiyatı
kalıcı istatistiğe yazmak — §6.4'ü ihlal eder.

Azaltıcı: liste kartı kesin bir "en ucuz" iddiası kurmaz, karşılaştırmanın
otoritesi detay sayfasıdır.

### OPEN DECISION 5 — Ödünç teklif liste sıralamasını etkilemeli mi

Şimdilik **hayır**. Yeniden değerlendirme, ödünç fiyatın feed fiyatını ne
sıklıkla yendiği ölçüldükten sonra. Düşükse borç önemsizdir; yüksekse
çözüm yine `product_group_price_stats`'a yazmak değil, liste sayfasının
iddiasını yeniden ifade etmektir.

---

## 7. Soru 6 — Girdi cache'ten silindiğinde ne gösterilir

### KARAR: Fiyat kaybolur, kimlik kaybolmaz — ama yalnızca kimlik kalıcıysa.

| Ödünç teklifin durumu | Kalıcı grubu **var** | Kalıcı grubu **yok** |
|---|---|---|
| Taze | Grup sayfasında fiyatlı teklif | Arama sonucunda fiyatlı kart |
| Bayat | Aynı + "şu kadar önce görüldü" | Aynı + gözlem zamanı |
| **Süresi dolmuş / silinmiş** | Grup sayfası **durur**; feed teklifleri görünmeye devam eder. Partner satırı fiyatsız, **"bu mağazada kontrol et"** canlı linkiyle kalır | **Hiçbir şey.** Sonuç mevcut değildir |

Son hücre kolay değil ama doğru: ödünç bir sonucun kalıcı bir adresi yoktur,
dolayısıyla boşalacak bir sayfa da yoktur.

### Bundan çıkan sert kural

> **Yalnızca `product_groups` kalıcı adres alır ve indekslenir. Ödünç sonuç
> hiçbir koşulda kanonik URL almaz, sitemap'e girmez, `index` edilmez.**

Gerekçe: TTL dolduğunda boşalan bir adres, kullanıcıya ve arama motoruna
verilmiş bozulmuş bir sözdür. Bir vitrinin en pahalı hatası, tıklanan
sonucun tıklandığında var olmamasıdır.

Bu kural aynı zamanda §1'deki kalıcı/ödünç ayrımını dışarıdan görünür kılar:
**adresi olan şey bizimdir, adresi olmayan ödünçtür.**

---

## 8. Altı partner aynı modele nasıl bağlanır

Model partner'a bakmaz; `cache_key`'in `partner` bileşeni ve tek bir
normalize teklif biçimi yeter.

| Partner | Feed | Arama API | Bu modeldeki yeri |
|---|---|---|---|
| **Awin** | Var, çalışıyor | Yok | **Feed yolunda kalır.** Hiçbir şey değişmez. Puanlama/QUALIFY dokunulmaz |
| **Amazon** | Yok | Var (PA-API) | Yalnızca ödünç |
| **eBay** | Yok | Var (Browse) | Yalnızca ödünç |
| **CJ / Impact / Rakuten** | Var | Var | **İkisi birden** — çakışmadan |

Son satır, ayrılığın asıl kazancı: aynı partner'dan hem feed hem ödünç
teklif gelebilir, çünkü ikisi farklı depolarda yaşar. Tek tabloda olsalardı
"bu satırı süpürücü silsin mi" sorusunun cevabı partner'a göre değişirdi —
ve o soru her sorguda sorulurdu.

### Kasıtlı olarak yapılmayanlar

Gereksiz soyutlamadan kaçınmak için, bu kararın **içermediği** şeyler:

- Feed ve aramayı tek çatı altında toplayan genel bir "ürün kaynağı"
  arayüzü **yok**. İkisinin bütçesi, hata modeli ve ömrü farklı.
- Yeni bir veri erişim katmanı, ORM ya da eklenti çerçevesi **yok**.
- `AffiliateProvider`'da değişiklik **yok**. Arama, yanına konan ayrı ve
  küçük bir sözleşmedir; postback/deeplink/registry yolu aynen kalır.
- `Fetcher` genişletilmez. Feed indirici (2 sn nezaket gecikmesi, 30 sn
  zaman aşımı) ile istek anındaki arama istemcisi aynı bütçeyi paylaşamaz.

---

## 9. Açık kararlar özeti

| # | Konu | Neyi bekliyor |
|---|---|---|
| 1 | Cache altyapısı (Data Cache vs Redis/KV) | Günlük benzersiz anahtar sayısı ve belge boyutu tahmini; kota sayacı atomiklik gereksinimi Redis'e işaret ediyor |
| 2 | Partner başına TTL tavanı | Sözleşme doğrulaması (`affiliate_networks.contract_verified`). O zamana kadar tavan 24 saat |
| 3 | Terfi eşiği | Trafik ölçümü. İlk sürümde terfi kapalı olabilir |
| 4 | Talep kaydı nereye (Postgres vs log drain) | Günlük ıska hacmi |
| 5 | Ödünç teklif liste sıralamasını etkilesin mi | Ödünç fiyatın feed fiyatını yenme sıklığı |

---

## 10. Bu kararın bozmadıkları

Doğrulanabilir liste — hiçbiri bu belgeden etkilenmez:

- `packages/ingest/*` — tek satır değişmez
- `ingest_upsert_offers`, `ingest_touch_seen`, `ingest_mark_stale_offers`
- `products`, `price_points`, `product_group_price_stats` şeması ve
  tetikleyicileri
- Awin puanlama/QUALIFY: `programs.score`, `score_breakdown`, `scored_at`,
  `program_applications`, `program_feeds`, dizin tazeleme göçleri
- `providers/registry.ts`, postback doğrulama, `/git/:offerId`,
  open-redirect savunması
- GitHub Actions alım turu ve `/api/cron/alim`

---

DECISION:
Ödünç (on-demand) partner teklifleri `products` tablosuna ve genel olarak
Postgres'e **hiç yazılmaz**; Postgres dışında bir KV cache'te, `cache_key`
başına tek bir normalize JSON belgesi olarak yaşarlar. Anahtar
`ob:{v}:{partner}:{market}:{currency}:{locale}:{page}:{sha256(query_norm)[0..15]}`
biçimindedir; sıralama ve filtreler anahtara girmez. TTL tek parçadır:
15 dakika taze, sonrasında sözleşme doğrulanana kadar 24 saatlik tavana
kadar bayat — bayat sunum yalnızca gözlem zamanı ekranda görünürken,
tazeleme arızaları sayılırken ve giden link canlıyken meşrudur. Ödünç teklif
`product_groups` ile yalnızca **salt okunur** eşleştirilir (GTIN → marka+başlık
imzası, mevcut kurallarla); okuma yolu grup **açmaz**, terfi ayrı ve çevrim
dışı bir iştir. Feed hattından izolasyon yapısaldır — ödünç teklif `products`,
`price_points`, `product_group_price_stats`, `sources`, `jobs` ve
`ingest_runs`'a hiç değmez, dolayısıyla `ingest_mark_stale_offers` onu
göremez. Girdi süresi dolduğunda fiyat kaybolur; kalıcı grubu varsa sayfa
fiyatsız canlı linkle durur, yoksa sonuç hiç var olmaz — bu yüzden ödünç
sonuçlar kanonik adres almaz ve indekslenmez.

WHY:
Ödünç teklifi `products`'a yazmak, mevcut çalışan sistemi bozacak tek
hamledir: o satır anında `ingest_mark_stale_offers`'ın süpürme alanına
girer, teklif başına ~7 tetikleyiciyi ve HOT oranı ölçülen %0,0 olan
(146.151 güncellemede 3 HOT) indeks yeniden yazma maliyetini kullanıcı
isteğinin sıcak yoluna taşır ve arama kutusunu kalıcı tabloya yazma yoluna
çevirir. Bayrakla ayırmak yetmez, çünkü `products`'a değen her sorgunun
bayrağı filtrelemeyi hatırlaması gerekir ve unutmanın bedeli sessizdir;
yapısal ayrım ise disiplin istemez. Aynı ayrım CJ/Impact/Rakuten gibi hem
feed'i hem arama API'si olan partner'ların ikisini birden kullanabilmesini
sağlar ve Awin'i mevcut feed yolunda hiç dokunmadan bırakır.

NEXT SINGLE IMPLEMENTATION STEP:
OPEN DECISION 1'i kapat: cache altyapısı için günlük benzersiz `cache_key`
sayısını ve ortalama belge boyutunu tahmin eden tek sayfalık bir ölçüm notu
çıkar ve Next Data Cache ile Redis/KV arasında kararı yaz. Diğer dört açık
karar ölçüm ya da sözleşme bekliyor; bu ilki beklemiyor ve kod yazılacak ilk
satırın nereye yazılacağını belirleyen tek karar bu.
