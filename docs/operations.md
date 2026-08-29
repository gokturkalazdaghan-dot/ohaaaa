# Operasyon El Kitabı

Bu belge, ohaaaa.com'un **tek kişi tarafından** nasıl işletileceğini anlatır.
Ne kadarının otomatikleştirilebileceği ve ne kadarının insan kararı gerektirdiği
konusunda dürüsttür.

---

## 0. Otomasyonun sınırı — önce bu okunmalı

Sistemin üç katmanı vardır ve her birinin gözetim ihtiyacı farklıdır:

| Katman | Otomasyon | Gözetim |
|---|---|---|
| **Veri alımı** (feed → katalog) | Tam otomatik, 6 saatte bir | Haftalık 5 dakikalık kontrol |
| **Yönlendirme ve tıklama kaydı** | Tam otomatik, anlık | Aylık mutabakat |
| **Dönüşüm/komisyon** | Ağdan otomatik gelir | Aylık ödeme mutabakatı — **zorunlu** |
| **Kod değişikliği** | Otomatik test, otomatik PR | **Birleştirme insana ait** |
| **Yeni ortaklık, komisyon oranı, fiyatlandırma** | Otomasyon yok | Tamamen insan kararı |

Son iki satır bilinçlidir:

- **Kod kendini birleştirmez.** Para taşıyan bir sistemde denetimsiz otomatik
  dağıtım, kazandırdığından fazlasını riske atar. CI testleri yeşil olduğunda
  bir PR hazırdır; `git merge` komutunu bir insan verir. Bu, günde 30 saniye
  eder ve kataloğun/komisyon mantığının sessizce bozulmasını engeller.
- **Fiyatı biz belirlemiyoruz.** Affiliate modelde ürün başka mağazada satılır;
  indirimi o mağaza yapar. Bizim yapabildiğimiz şey **indirimi tespit etmek ve
  sıralamaktır** (`deal_score()`), üretmek değil. Marketplace tarafında da fiyat
  taşerona aittir. "Yıkıcı indirim oranı belirleyen algoritma" bu mimaride
  karşılığı olmayan bir istektir — ve rakip fiyatını hedef alan otomatik
  fiyatlandırma, TTK m.54 anlamında haksız rekabet riski taşır.

---

## 1. Veri alımı

### Nasıl çalışır

```
GitHub Actions (6 saatte bir)
   └─ node packages/ingest/dist/cli.js
        ├─ sources tablosundaki etkin kaynakları oku
        ├─ her biri için: getir → ayrıştır → doğrula → kanonik eşleştir → yaz
        └─ ingest_runs'a kaydet, çıkış kodu döndür
```

Elle çalıştırma:

```sh
# Tümü
node packages/ingest/dist/cli.js

# Tek kaynak
node packages/ingest/dist/cli.js --source=magaza-a-genel

# Yazmadan dene — yeni bir feed'in alan haritasını doğrulamanın yolu
node packages/ingest/dist/cli.js --source=yeni-kaynak --dry-run
```

### Yerleşik korumalar

| Durum | Davranış | Neden |
|---|---|---|
| Feed boş döndü | **Hata**, bayatlatma çalışmaz | Katalogun tamamı stoksuz olurdu |
| Kalemlerin <%50'si geçerli | Uyarı kaydedilir | Alan haritası bozulmuş demektir |
| Hiçbiri geçerli değil | Hata, yazma yok | Aynı sebep |
| Bir kaynak çöktü | Diğerleri devam eder | Tek feed tüm alımı düşürmemeli |
| Ürün feed'de görünmedi | `out_of_stock` işaretlenir, **silinmez** | Silme geri alınamaz |
| Fiyat 0 veya okunamıyor | Kalem atlanır | 0 TL karşılaştırmanın tepesine oturur |
| GTIN kontrol basamağı hatalı | GTIN yok sayılır | Yanlış eşleşme = yanlış ürün satın alınır |

### Yeni kaynak ekleme

Kod değişikliği **gerekmez**. `sources` tablosuna satır eklenir:

```sql
insert into public.sources
  (merchant_id, slug, name, kind, endpoint_url, field_mapping, schedule_cron)
values (
  '<mağaza id>', 'yeni-kaynak', 'Yeni Ortak — genel feed', 'feed_csv',
  'https://ortak.example/feed.csv',
  '{"external_id":"id","title":"name","price":"price","url":"link",
    "gtin":"ean","image":"img","brand":"brand","stock":"stock"}',
  '0 */6 * * *'
);
```

Sonra `--dry-run` ile haritayı doğrulayın. Geçerlilik oranı %90'ın altındaysa
harita yanlıştır.

---

## 2. Tarama politikası (kesin sınır)

`packages/ingest/src/http/politeClient.ts` ve `robots.ts` şu kurallarla çalışır
ve bunların **atlatma seçeneği yoktur**:

- `robots.txt` her alan adı için okunur ve uygulanır
- `robots.txt` alınamazsa (5xx) varsayım **yasaktır**
- Sitenin `Crawl-delay` değeri bizimkinden yavaşsa **onunki geçerlidir**
- `User-Agent` kimliğimizi ve iletişim adresimizi bildirir
- `429`/`503` yanıtında `Retry-After` beklenir
- Ardışık hatada devre kesici açılır

**Neden proxy rotasyonu, parmak izi taklidi veya CAPTCHA çözümü yok:**
gelirin tamamı ortaklık hesaplarından gelir ve Amazon Associates, Trendyol ve
Hepsiburada ortaklık sözleşmelerinin üçü de izinsiz otomatik erişimi yasaklar.
Tespit edilmenin bedeli tarayıcının durması değil, **gelir kaynağının
kapanmasıdır**. Ayrıca 5651 ve TTK m.54 kapsamında hukuki risk doğar.

Resmî yol her açıdan daha ucuzdur: feed'ler kırılmaz, ban riski yoktur,
komisyon yasal olarak hak edilir.

---

## 3. Günlük kontrol (5 dakika)

```sql
-- 1. Son 24 saatte alım başarısız oldu mu?
select s.slug, r.status, r.items_seen, r.items_failed, r.error, r.started_at
from ingest_runs r join sources s on s.id = r.source_id
where r.started_at > now() - interval '24 hours'
order by r.started_at desc;

-- 2. Katalog bayatladı mı?
select m.display_name,
       count(*) filter (where p.last_seen_at > now() - interval '12 hours') as taze,
       count(*) filter (where p.last_seen_at < now() - interval '48 hours') as bayat
from products p join merchants m on m.id = p.merchant_id
where p.fulfillment = 'affiliate'
group by m.display_name;

-- 3. Gelir ve dönüşüm (admin oturumuyla)
select public.affiliate_dashboard(7);
```

### Alarm eşikleri

| Sinyal | Eşik | Aksiyon |
|---|---|---|
| Alım hatası | Aynı kaynak 2 kez üst üste | Feed adresini ve alan haritasını kontrol et |
| Bayat teklif | Bir mağazada >%20 | Feed yayını durmuş olabilir; ortağa yaz |
| Tıklama var, dönüşüm yok | 7 gün, >200 tıklama | Postback yapılandırması bozuk — **acil** |
| Atfedilemeyen dönüşüm | >%15 | `subid` iletimi kopuk; şablonu kontrol et |
| EPC düşüşü | Haftalık >%40 | Ortağın komisyon oranı değişmiş olabilir |

Bunlardan üçüncüsü en pahalısıdır: satış gerçekleşir, komisyon tahakkuk eder
ama biz göremeyiz. Haftada bir mutlaka bakılmalıdır.

---

## 4. Aylık mutabakat (zorunlu, otomatikleştirilemez)

Ağın panelindeki tutar ile bizim `conversions` tablomuz **her ay**
karşılaştırılmalıdır:

```sql
select m.display_name,
       count(*) as adet,
       sum(c.commission_cents) / 100.0 as komisyon_tl
from conversions c join merchants m on m.id = c.merchant_id
where c.occurred_at >= date_trunc('month', now() - interval '1 month')
  and c.occurred_at <  date_trunc('month', now())
  and c.status in ('approved', 'paid')
group by m.display_name;
```

Fark %5'i geçiyorsa postback kaybı vardır. Bu adım otomatikleştirilemez çünkü
karşı tarafın panelinde ne yazdığını yalnızca bir insan görebilir.

---

## 5. Kod değişikliği akışı

```
değişiklik → CI (tip denetimi + 116 birim testi + 20 SQL iddiası + derleme)
           → yeşilse PR hazır
           → insan birleştirir
           → dağıtım
```

CI kırmızıysa birleştirilmez. Özellikle şu üç testin kırmızısı **asla**
görmezden gelinmez:

- `supabase/tests/20_rls_test.sql` — yetki sızıntısı
- `supabase/tests/30_affiliate_test.sql` — gelir muhasebesi
- `packages/shared/src/affiliate.test.ts` — açık yönlendirme savunması

---

## 6. Sırlar ve anahtarlar

| Sır | Nerede | Sızarsa |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Yalnızca sunucu ve CI | **Tüm veritabanı** okunur/yazılır — derhal döndür |
| `merchants.postback_secret` | Veritabanı | Sahte dönüşüm yazılabilir; ağdan yenisini iste |
| `CLICK_HASH_SECRET` | Sunucu ortamı | Tıklama özetleri kaba kuvvetle çözülebilir |
| `api_keys.key_hash` | Veritabanı (özet) | Ham anahtar zaten saklanmıyor |

`apps/web/src/lib/supabase/service.ts` dosyası `import 'server-only'` taşır:
service_role anahtarının istemci paketine girmesi **derleme zamanında**
engellenir.

---

## 7. Bu sistemde henüz olmayanlar

Dürüst liste — üretime almadan önce gerekenler:

- **Gerçek ortaklık hesapları.** Şu an demo mağazalar var. Amazon Associates,
  Trendyol ve Hepsiburada ortaklık başvuruları yapılmalı; onay sonrası
  `merchants` tablosuna gerçek `tracking_id` ve `deeplink_template` girilmeli.
- **Kimlik doğrulama arayüzü.** Supabase Auth şema ve RLS seviyesinde bağlı,
  giriş/kayıt ekranları yazılmadı.
- **Ödeme entegrasyonu** (marketplace tarafı için).
- **Görsel barındırma** — şu an yer tutucu kullanılıyor.
- **Yasal metinler**: ortaklık linki açıklaması (reklam mevzuatı gereği zaten
  `rel="sponsored"` ve "satış X'te tamamlanır" notu var, ama ayrıca bir
  bilgilendirme sayfası gerekir), KVKK aydınlatma metni, çerez politikası.
- **Admin paneli** — `affiliate_dashboard()` fonksiyonu hazır, arayüzü yok.
