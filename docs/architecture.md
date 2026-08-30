# Mimari Kararlar

Bu belge *neden* böyle yapıldığını açıklar. *Nasıl* çalıştığı kodun kendi
yorumlarındadır.

---

## 1. İş mantığı neden veritabanında?

`create_order()` bir PostgreSQL fonksiyonudur, bir Node servisi değil.

**Gerekçe:** Sipariş oluşturma atomik olmak zorundadır — stok düşümü, tutar
hesabı ve komisyon tek bir transaction'da olmalıdır. Uygulama katmanında
yapılırsa, üç istemci (web, mobil, taşeron API'si) aynı mantığı üç kez
uygular ve er ya da geç ayrışırlar.

Ayrıca `FOR UPDATE` kilidi olmadan eşzamanlı iki sipariş aynı son ürünü
satabilir. Bu yarış (race) yalnızca veritabanı seviyesinde güvenilir biçimde
kapatılabilir.

**Bedeli:** Mantık SQL'de olduğu için birim testi yazmak TypeScript'e göre
zahmetlidir. Bu yüzden `supabase/tests/` altında gerçek bir veritabanına karşı
çalışan iddia testleri var; `scripts/verify-sql.sh` bunları CI'da koşturur.

---

## 2. Neden `product_groups` + `products` ayrımı?

Bir agregatörün tek işi vardır: **"bu iki kayıt aynı ürün mü?"** sorusunu
cevaplamak. Tek tablolu bir katalogda bu soru sorulamaz.

Eşleştirme sırası güvenilirlikten zayıfa doğrudur:

1. **GTIN / barkod** — küresel benzersiz, en güvenilir
2. **Normalize marka + başlık imzası** — barkodsuz beslemeler için
3. Eşleşme yoksa yeni kanonik ürün

2. adım bilinçli olarak **muhafazakârdır**: yalnızca tam imza eşleşmesi kabul
edilir. Yanlış eşleştirme (iki farklı ürünü birleştirmek) hiç eşleştirmemekten
daha zararlıdır — kullanıcı yanlış ürünü satın alır.

---

## 3. "En iyi fiyat" neden etiket fiyatı değil?

Sıralama **ürün + kargo** toplamına göre yapılır.

Örnek (demo verisinden): iPhone 15 için Moda Vitrin 53.899 ₺ + 49,99 ₺ kargo
= **53.948,99 ₺**; Teknomarkt 54.999 ₺ + ücretsiz kargo = 54.999 ₺.
Etiket fiyatına göre sıralasaydık aynı sıra çıkardı — ama kargosu pahalı bir
mağaza etiket fiyatını düşürerek listenin başına geçebilir ve kullanıcı ödeme
adımında sürprizle karşılaşırdı. Kullanıcının ödeyeceği tutar tek doğru
ölçüttür.

---

## 4. API anahtarı: neden SHA-256, bcrypt değil?

Parolalar düşük entropilidir; bu yüzden yavaş özet (bcrypt/argon2) gerekir.
API anahtarının gizli kısmı **192 bit kriptografik rastgelelik** taşır —
kaba kuvvet zaten imkânsızdır. Yavaş özet burada her API isteğine gereksiz
gecikme eklerdi.

Doğrulama, aranabilir bir **önek** (`ohk_live_<16 hex>`) üzerinden tek indeks
sorgusuyla yapılır; tüm tabloyu taramak yerine anahtar sayısından bağımsız
sabit maliyette kalır. Bulunamayan anahtarda da kukla bir karşılaştırma
yapılır, böylece "anahtar yok" ile "anahtar yanlış" yanıt süreleri ayrışmaz
(timing attack).

---

## 5. RLS politikalarında özyineleme tuzağı

`orders` politikası `vendor_orders`'ı sorgularsa, onun politikası da
`orders`'ı sorguladığı için PostgreSQL şu hatayı verir:

```
ERROR: infinite recursion detected in policy for relation "orders"
```

Bu hata geliştirme sırasında gerçekten alındı. Çözüm: tablolar arası
kontroller `SECURITY DEFINER` fonksiyonlara taşındı
(`order_belongs_to_current_user`, `order_has_vendor_of_current_user`).
Bu fonksiyonların içindeki sorgular RLS'e takılmaz ve döngü kırılır.

Aynı nedenle `owns_vendor()` ve `is_admin()` de `SECURITY DEFINER`'dır.

`SECURITY DEFINER` fonksiyonlar RLS'i bypass ettiği için **yetkiyi kendileri
doğrulamak zorundadır** — örneğin `vendor_dashboard_stats()` içinde sahiplik
kontrolü elle yapılır.

---

## 6. Hız sınırlayıcı neden bellekte?

`packages/backend/src/lib/rateLimiter.ts` süreç belleğinde kayan pencere
tutar. Tek örnek (instance) için doğrudur; yatay ölçeklemede her örnek kendi
sayacını tutacağı için efektif tavan örnek sayısıyla çarpılır.

**Bilinçli bir ödünleşme:** Redis eklemek, tek bir kutuda çalışan bir sistem
için işletme maliyeti ve tek hata noktası getirir. `RateLimiter` arayüzü
korunduğu sürece Redis destekli bir uygulamayla değiştirmek tek dosyalık bir
iştir.

Kayan pencere tercih edildi çünkü sabit pencere sayacı, pencere sınırında iki
katı trafiğe izin verir (09:59:59'da 600, 10:00:00'da 600 daha).

---

## 7. Demo modu neden var?

Supabase yapılandırılmamışsa uygulama çökmek yerine yerleşik veriye düşer.

**Gerekçe:** Bir pazar yerini değerlendirmek için onu dolu görmek gerekir.
Boş bir vitrin, tasarımı da mimariyi de anlatmaz. Demo verisi
`supabase/seed.sql` ile birebir aynıdır, dolayısıyla canlıya geçiş arayüzü
değiştirmez.

**Risk ve karşı önlem:** Demo verinin canlı veri sanılması bu projedeki en
pahalı yanlış anlaşılma olurdu. Bu yüzden uyarı şeridi gizlenebilir değildir
ve her sayfada görünür.

---

## 8. Kuruş (minor unit) değişmezi

Hiçbir katmanda ondalıklı para taşınmaz. `0.1 + 0.2 !== 0.3` olduğu için
float aritmetiği finansal hesapta yuvarlama hatası üretir.

Komisyon **aşağı yuvarlanır** (`floor`) — yuvarlama farkı taşeron lehinedir.
Bu kural üç yerde birden uygulanır ve testlerle sabitlenmiştir:

- `create_order()` (SQL): `floor(v_line_total * v_vendor.commission_rate)`
- `calculateCommission()` (TS): `Math.floor(...)`
- `packages/shared/src/cart.test.ts`: SQL testindeki sayılarla aynı iddialar

---

## Bilinen sınırlar

Bu bir referans uygulamadır; üretime almadan önce şunlar gerekir:

- **Gerçek ödeme entegrasyonu.** Şu an simülasyon var; kart verisi hiçbir
  yerde işlenmiyor (bilinçli — PCI-DSS kapsamı sağlayıcıda kalmalı).
- **Kimlik doğrulama akışı.** Supabase Auth şema ve RLS seviyesinde bağlı,
  ancak giriş/kayıt ekranları yazılmadı.
- **Görsel barındırma.** Ürün görselleri için yer tutucu kullanılıyor.
- **Çok örnekli hız sınırı** (bkz. §6).
- **Taşeron paneli canlı veriyi henüz okumuyor**; `vendor_dashboard_stats()`
  fonksiyonu hazır, panel şu an demo üreteciyle besleniyor.
