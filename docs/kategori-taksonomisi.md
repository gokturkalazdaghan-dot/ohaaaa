# Kanonik Kategori Taksonomisi

Ohaaaa'nın ürün taksonomisi **üç seviyeli** ve **affiliate feed'lerden
bağımsızdır**. Bu dosya sözleşmeyi yazıyor: neyin değişebileceğini, neyin
asla değişmeyeceğini ve yeni bir satıcı bağlandığında ne yapılacağını.

```
L1  Ana Kategori      Bilgisayar & Teknoloji
L2  Alt Kategori        Bilgisayar Bileşenleri
L3  Ürün Kategorisi       Ekran Kartı
```

Ölçülen durum (göçler uygulandıktan sonra): **18 L1 · 194 L2 · 65 L3**,
toplam 285 kategori satırı (8'i pasif, 6'sı birleştirilmiş).

---

## Değişmeyen kurallar

**1 · Kaynak taksonomisi ile kanonik taksonomi ASLA karışmaz.**
`categories` bizim ağacımız. Satıcının kendi ağacı `category_source_map`
tablosunda yaşar ve oraya yazılan hiçbir şey `categories` içinde satır
açamaz. Karışsalardı bir feed'in sözlüğü bizim vitrinimizi yeniden
yazardı.

**2 · Marka kategori değildir.** İşletim sistemi de değildir. `ios-telefonlar`
ile `android-telefonlar` bu yüzden birleştirildi: ikisi de aynı ürün
tipidir ve ayrı tutmak, aynı ürünün tekliflerini iki sayfaya bölerek fiyat
karşılaştırmasını anlamsızlaştırırdı. `106_kanonik_uc_seviye_test.sql`
bilinen marka adlarını kategori adlarında arayarak bunu koruyor.

**3 · Slug bir ADRESTİR, ad bir GÖRÜNTÜDÜR.** Ad serbestçe düzeltilir;
slug değişmez. `/kategori/ram` üç seviyeli ağaçta da aynı adrestir.
Slug'ı hiyerarşiye bağlamak (`/kategori/bilgisayar-teknoloji/.../ram`) her
yeniden düzenlemeyi bir SEO kesintisine çevirirdi. Ülke/dil kırılımı
geldiğinde değişecek olan yol önekidir (`/tr/kategori/ram`), slug değil.

**4 · Kategori SİLİNMEZ.** Yinelenen kategori `merged_into_id` ile kanonik
hedefine bağlanır ve pasifleşir; ürünleri hedefe taşınır. Vitrin eski
adrese **301** verir (`kategori_yonlendirme`). Silmek hem ürünleri
kategorisiz bırakırdı hem de o sayfanın arama değerini çöpe atardı.

**5 · Derinlik üçte kilitli.** `categories.tree_level` bir tetikleyiciyle
hesaplanır ve dördüncü seviye veritabanı tarafından reddedilir. Menü ve
arama kapsamı üç seviye varsayıyor; dördüncü bir dal sessizce görünmez
olurdu.

**6 · Emin değilsek kategori vermeyiz.** Bulanık eşleşme yok. Yanlış
kategori, kategorisizlikten zararlıdır: kullanıcı yanlış rafta yanlış ürünü
görür ve kategori sisteminin tamamına güveni biter.

---

## Ana kategoriler

Hedef mimarinin yedi dalı önde:

| # | Ana kategori | slug |
|---|---|---|
| 1 | Bilgisayar & Teknoloji | `bilgisayar-tablet` |
| 2 | Telefon & Mobil | `telefon` |
| 3 | Elektronik | `elektronik` |
| 4 | Gaming & Konsol | `gaming-konsol` |
| 5 | Ev & Yaşam | `ev-yasam` |
| 6 | Kitap & Kırtasiye | `kitap-kirtasiye-ofis` |
| 7 | Eğlence & Hobi | `oyuncak-muzik-film` |

Kalan on bir dal (Sağlık & Medikal, Yapı-Bahçe, Oto, Süpermarket, Moda,
Beyaz Eşya, Kozmetik, Spor, Anne & Bebek, Altın-Takı, Yetişkin) **duruyor**
ve iki seviyeli. Kapatmak, bugün katalogda kategori ve eşleme kuralı taşıyan
dalları Türkiye dışına açılmadan önce daraltmak olurdu. Aynı kısıtlar
altında ilerideki bir göçle derinleştirilebilirler.

---

## Eski → yeni eşleme (özet)

### Ayrıştırılan kategoriler

| Eski (birden çok ürün tipi) | Yeni |
|---|---|
| Oyun & Oyun Konsolları | **Oyun Konsolları** + **Konsol Oyunları** (ayrı L2) |
| Oyuncak, Müzik, Film & Oyun | **Eğlence & Hobi** (Oyuncak · Müzik · Film & Dizi · Hobi & Koleksiyon) + oyun dalı **Gaming & Konsol**'a |
| Kitap, Kırtasiye & Ofis | **Kitap & Kırtasiye**: `kitap` ile `ofis-okul-kirtasiye` ayrı L2 |
| Bilgisayar & Tablet (23 düz kardeş) | 9 L2 + 13 L3 (Bilgisayarlar > Laptop, Bileşenler > RAM…) |
| Elektrik & Elektronik (düz) | **Elektronik**: 6 L2 + 19 L3 |

### Belirsizlikten çıkarılan adlar

| Eski ad | Yeni ad | Neden |
|---|---|---|
| Aksesuarlar (`elektronik-aksesuarlar`) | Elektronik Aksesuarlar | tek başına hiçbir şey söylemiyordu |
| Aksesuar (`moda-aksesuar`) | Moda Aksesuarları | aynı sebep, ikinci kopya |
| Şarj Cihazı (`sarj-cihazlari`) | Telefon Şarj Cihazı | genel adaptörle karışıyordu |
| Kablo (`sarj-kablolari`) | Şarj Kablosu | `kablo-priz` ile karışıyordu |
| Bataryalar (`bataryalar`) | Telefon Bataryası | `batarya-pil` ile karışıyordu |
| Kadın Pedleri & Hijyen Ür. | Kadın Hijyen Ürünleri | `hijyen-urunleri` ile karışıyordu |
| Vücut Bakımı (`kisisel-bakim`) | Kişisel Bakım & Vücut Bakımı | üstküme, birleştirmeden sonra |
| Video Oyunları (`video-oyunlari`) | Dijital Oyun & Oyun Kodları | konsol/PC oyunuyla örtüşüyordu |
| Koleksiyon (`hobi-eglence`) | Hobi & Koleksiyon | `hobi-el-isi` ile örtüşüyordu |

### Birleştirilen yinelenenler (6)

| Kaynak → Hedef | Gerekçe |
|---|---|
| `ios-telefonlar` → `android-telefonlar` | işletim sistemi ürün tipi değil |
| `projektor` → `projeksiyon-sistemleri` | aynı ürün tipi, iki dal |
| `elektrikli-mutfak-aletleri` → `kucuk-mutfak-aletleri` | aynı ürün tipi, aynı üst |
| `hijyenik-pedler` → `kadin-pedleri` | aynı ürün tipi, iki üst |
| `bebek-bezi-islak-mendil` → `bebek-bakim-saglik` | aynı ürün tipi, iki üst |
| `kisisel-bakim-urunleri` → `kisisel-bakim` | aynı ürün tipi, iki üst |

Her biri için eski adres **301** ile hedefe gider.

### Seviye değiştirenler

`ev-elektronigi` ana kategori olmaktan çıkıp **Elektronik > Ev Elektroniği**
(L2) oldu; `aydinlatma` Ev & Yaşam'dan Elektronik'e taşındı (hedef mimari
öyle sayıyor); `oyuncu-ozel` (Gaming Aksesuarları) Bilgisayar dalından
Gaming & Konsol'a geçti.

**Hiçbir ürünün `category_id`'si bu seviye değişiklikleri yüzünden
değişmedi.** Ürün taşıma yalnızca birleştirme göçünde oldu ve orada sayıldı.

---

## Yeni bir satıcı / feed bağlandığında

Kod değişikliği **gerekmez**. Adımlar:

1. Satıcının kendi kategori değerlerini topla (alım logu
   `unknown_category_slugs` alanında örnekliyor).
2. `category_source_map` tablosuna satır yaz:

```sql
insert into public.category_source_map (source, source_key, category_id, note)
select 'yeni-satici', 'Haushalt & Garten',
       (select id from public.categories where slug = 'ev-yasam'),
       'Almanca feed: ev ve bahce.';
```

3. Bilerek almadığımız bir dal ise hedef yerine **gerekçe** yaz:

```sql
insert into public.category_source_map (source, source_key, excluded_reason, note)
values ('yeni-satici', 'Lebensmittel', 'gida', 'Gida kapsam disi.');
```

Üç hâl birbirinden ayrıdır ve karıştırılırsa hata sessiz kalır:

| Satır | Anlam |
|---|---|
| `category_id` dolu | bu kanonik kategoriye gider |
| `category_id` NULL + `excluded_reason` dolu | **bilerek** kapsam dışı |
| satır hiç yok | **henüz eşlenmedi** — başlık kurallarına düşer |

`source` alanına `'*'` yazmak kuralı **her kaynak için** geçerli kılar.
Kanonik kategori adlarımızdan türetilen `'*'` kuralları
`kategori_ad_kurallarini_tazele()` ile üretilir; bir kaynak kategoriyi bizim
adımızla söylüyorsa (örn. "Gaming & Konsol") otomatik eşleşir.

Çözüm sırası, özelden genele: **kaynağa özgü tam anahtar → ortak (`*`) kural
→ yol parçaları, en spesifikten**. Yani `"Bilgisayar & Teknoloji >
Bilgisayar Bileşenleri > Ekran Kartı"` değeri `ekran-karti`'na düşer,
genel bilgisayar kategorisine değil.

---

## Alım hattının eşleme sırası

```
0. feed zaten geçerli bir katalog slug'ı mı        (operatörün açık kararı)
1. ürün ADI kuralları                              (categorize.ts — en özel sinyal)
2. feed kategorisi, KODDAKİ liste                  (categorize.ts)
3. feed kategorisi, VERİTABANI sözlüğü             (category_source_map) ← dağıtım gerektirmez
4. null                                            (uydurma yok; sayılır ve loglanır)
```

3. katman `kaynakKategorileriniCoz()` içinde. Sözlük okunamazsa alım
**düşmez**: katman bir iyileştirmedir, kural listesi eskisi gibi çalışır.

---

## Bu sözleşmeyi koruyan testler

| Dosya | Neyi koruyor |
|---|---|
| `supabase/tests/99_kanonik_taksonomi_test.sql` | 18 L1, yinelenen yok, yetim yok, gıda kapsam dışı, +18/medikal işaretli, çözücü tutarlı |
| `supabase/tests/106_kanonik_uc_seviye_test.sql` | derinlik 3, seviye yayılımı, kapsam üç seviye, birleştirme + 301, marka kategori değil, yedi hedef dal |
| `packages/shared/src/categoryTree.test.ts` | L3 sayıları L1 toplamına giriyor, boş dal eleniyor, döngü kilitlemiyor |
| `packages/ingest/src/category.test.ts` | veri tabanlı eşleme, kapsam dışı kararının korunması, sözlük hatasında alımın düşmemesi |

---

## Ölçümler

35.006 ürün grubuyla, üretimdeki çarpık dağılım taklit edilerek (ürünlerin
çoğu tek bir dalda) ölçüldü. `anon` rolünün deyim zaman aşımı **3.000 ms**.

| Sorgu | Süre |
|---|---|
| `kategori_grup_sayilari()` (şerit sayaçları) | 13 ms |
| `search_facets()` | 93 ms |
| `search_facets('dell')` | 157 ms |
| `search_products(L1)` | 102 ms |
| `search_suggestions('a')` — 200 kategori eşleşiyor, en kötü hâl | 158 ms |

**Kapsam düzeltmesi ne kadar ürün kurtardı:** "Bilgisayar & Teknoloji"
sayfası tek seviye kapsamla **3.501**, özyinelemeli kapsamla **33.251**
grup gösteriyor — eski hâli dalın ürünlerinin **%89'unu gizliyordu.**

**Filtre sayaçları ayrıca bir performans düzeltmesi çıktı.** Eski
`by_category` her ana kategori satırı için yeniden koşan bir
`in (select …)` alt sorgusu kullanıyordu:

| | Süre |
|---|---|
| eski (tek seviye, in-subquery) | **9.425 ms** |
| yeni (`kategori_kapsami` + lateral) | **20 ms** |

Eski hâl bu ölçekte yalnızca eksik değil, `anon`'un bütçesini üçe
katlayarak **düşüyordu**. Düştüğünde Next.js bayat önbelleği sunmaya devam
eder ve vitrin eski sayılarda kalır — `onbellek.ts` içinde yazılı, bu
depoda bir kez yaşanmış arızanın aynısı.

### Göçten sonra önbellek

`KATALOG_SURUMU` **v3**'e çıkarıldı. Toplu bir veri değişikliğinden sonra
artırılmazsa üst çubuk eski ağacı bir saatten uzun süre sunmaya devam eder
(ölçülmüş arıza). Rutin yol ise `POST /api/cron/katalog-tazele`.

---

## Bilinen ve kabul edilmiş borç

- **`android-telefonlar` slug'ı "Akıllı Telefon" adını taşıyor.** Ad doğru,
  slug tarihsel. Düzeltmek yayımlanmış bir adresi kırardı.
- **"Film & Dizi" adı hedef listedeki "Film"den geniş.** `film` slug'ı dizi
  ürünlerini de taşıyor; adı daraltmak içeriğin bir kısmını yanlış
  adlandırmak olurdu. Üstküme, yanlış addan iyidir.
- **On bir dal hâlâ iki seviyeli.** Yeniden düzenleme yedi hedef dalda
  yapıldı. Diğerleri aynı kısıtlar altında ilerideki bir göçle derinleşir.
