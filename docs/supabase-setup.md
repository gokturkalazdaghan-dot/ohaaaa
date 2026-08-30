# Supabase Kurulumu

Bu rehber ohaaaa.com'un veritabanını sıfırdan ayağa kaldırır. İki yol var;
**ikisini de yapmanız gerekiyor** ama sırayla:

| Yol | Ne zaman | Maliyet |
|---|---|---|
| **A — Yerel** | Geliştirme, migration denemesi | Ücretsiz, Docker gerekir |
| **B — Bulut** | Yayına alma | Ücretsiz katman yeterli (başlangıç için) |

Önce yerelde çalıştırıp migration'ları doğrulayın, sonra buluta itin. Doğrudan
buluta itmek, bozuk bir migration'ı canlıda keşfetmek demektir.

---

## Ön koşullar

```sh
node --version     # 22+
docker --version   # yalnızca Yol A için
npx supabase --version
```

Supabase CLI'ı ayrıca kurmanıza gerek yok; `npx supabase` çalışır. Sürekli
kullanacaksanız kurmak daha hızlıdır:

```sh
npm install -g supabase        # veya: brew install supabase/tap/supabase
```

---

## Yol A — Yerel geliştirme ortamı

### A1. Yerel yığını başlatın

```sh
cd ohaaaa
npx supabase start
```

İlk çalıştırmada Docker imajlarını indirir (~1 GB, birkaç dakika). Bittiğinde
şuna benzer bir çıktı verir — **bu değerleri saklayın**:

```
         API URL: http://127.0.0.1:54321
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
        anon key: eyJhbGciOiJIUzI1NiIs...
service_role key: eyJhbGciOiJIUzI1NiIs...
```

> Çıktıyı kaybederseniz: `npx supabase status`

### A2. Şemayı ve örnek veriyi yükleyin

```sh
npx supabase db reset
```

Bu komut sırayla:

1. Yerel veritabanını **siler**
2. `supabase/migrations/` içindeki 6 dosyayı tarih sırasıyla uygular
3. `supabase/seed.sql` ile örnek kataloğu yükler

Beklenen çıktı, migration adlarının sırayla listelenmesi ve hatasız bitmesidir.

### A3. Doğrulayın

Studio'yu açın (`http://127.0.0.1:54323`) → **Table Editor**. Şu tabloları
görmelisiniz:

```
users · vendors · api_keys · categories · product_groups · products
flash_deals · orders · vendor_orders · order_items · api_request_logs
merchants · sources · ingest_runs · clicks · conversions · price_points
```

SQL Editor'de hızlı bir kontrol:

```sql
-- Katalog dolu mu? (iPhone 5 teklifli olmalı: 3 taşeron + 2 ortak mağaza)
select title, offer_count, min_price_cents from product_groups order by offer_count desc;

-- Arama çalışıyor mu? (Türkçe karaktersiz yazım da bulmalı)
select title, best_vendor_name from search_products('kulaklik');
```

---

## Yol B — Bulut projesi

### B1. Proje oluşturun

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. **Region: Frankfurt (eu-central-1)** seçin — Türkiye'den en düşük gecikme
3. Veritabanı parolasını **güvenli bir yere kaydedin**; sonradan gösterilmez

Proje hazırlanması 2–3 dakika sürer.

### B2. Projeyi bağlayın

Proje referansını panel adresinden alın:
`dashboard/project/<PROJE_REF>` — işte o `<PROJE_REF>`.

```sh
npx supabase link --project-ref <PROJE_REF>
```

Veritabanı parolasını ister.

> **Sürüm uyuşmazlığı uyarısı alırsanız:** `supabase/config.toml` içindeki
> `major_version` değerini projenizin PostgreSQL sürümüne eşitleyin
> (Panel → Settings → Database → Postgres version).

### B3. Migration'ları itin

```sh
npx supabase db push
```

Uygulanacak migration'ları listeler ve onay ister. Bu komut **veri silmez**;
yalnızca henüz uygulanmamış olanları çalıştırır.

### B4. Örnek veriyi yükleyin (isteğe bağlı)

`db push` seed'i çalıştırmaz — bu bilinçlidir, üretim veritabanına demo veri
basmak istemezsiniz. Yine de test için istiyorsanız:

```sh
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/seed.sql
```

veya Studio → SQL Editor'e `supabase/seed.sql` içeriğini yapıştırın.

---

## Anahtarları uygulamaya bağlayın

```sh
cp .env.example .env
```

`.env` dosyasını doldurun. Değerler **Panel → Settings → API** altındadır
(yerelde `npx supabase status` çıktısı):

```sh
# Tarayıcıya gider — herkese açık olması normaldir, koruma RLS'tedir
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...

# Sunucuda kalır
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# Tıklama özetlerinin tuzu — üretimde MUTLAKA değiştirin
CLICK_HASH_SECRET=$(openssl rand -hex 32)
```

> **`service_role` anahtarı RLS'i tamamen bypass eder.** Asla
> `NEXT_PUBLIC_` öneki vermeyin, asla istemci koduna koymayın, asla git'e
> commit'lemeyin. Sızarsa Panel → Settings → API → **Reset** ile derhal
> döndürün.

Ardından:

```sh
npm run dev
```

Ana sayfadaki turuncu **"Demo modu"** şeridi kaybolduysa bağlantı kurulmuştur.
Şerit duruyorsa `NEXT_PUBLIC_SUPABASE_URL` okunamıyor demektir — Next.js bu
değişkenleri **derleme zamanında** gömer, `.env` değiştirdikten sonra sunucuyu
yeniden başlatın.

---

## Gerçek bir yönetici hesabı oluşturun

`seed.sql` doğrudan `auth.users` tablosuna satır yazar. Bu satırların
**`auth.identities` kaydı yoktur**, dolayısıyla o hesaplarla **giriş
yapılamaz** — yalnızca sahiplik ilişkilerini kurmak için vardırlar.

Giriş yapabilen gerçek bir yönetici için:

**1.** Panel → **Authentication → Users → Add user** (e-posta + parola)

**2.** SQL Editor'de rolü yükseltin:

```sql
update public.users
   set role = 'admin'
 where email = 'sizin@adresiniz.com';
```

> `users` tablosundaki satır, kayıt anında `on_auth_user_created` trigger'ı
> tarafından otomatik açılır. Satır yoksa trigger'ın uygulandığını kontrol edin.

Admin rolü `affiliate_dashboard()`, `sources` ve `conversions` tablolarına
erişim için gereklidir.

---

## Kurulum kontrol listesi

```sql
-- 1. Tüm migration'lar uygulandı mı? (6 satır dönmeli)
select version, name from supabase_migrations.schema_migrations order by version;

-- 2. RLS her tabloda açık mı? (boş dönmeli — açık olmayan tablo kalmamalı)
select tablename from pg_tables
 where schemaname = 'public'
   and rowsecurity = false
   and tablename not like 'pg_%';

-- 3. Politikalar yerinde mi? (30+ satır)
select tablename, count(*) from pg_policies
 where schemaname = 'public' group by tablename order by tablename;

-- 4. Eklentiler kurulu mu? (3 satır: citext, pg_trgm, pgcrypto)
select extname from pg_extension where extname in ('citext','pg_trgm','pgcrypto');

-- 5. auth.users trigger'ı bağlı mı? (1 satır)
select tgname from pg_trigger where tgname = 'on_auth_user_created';
```

Beşi de beklendiği gibiyse kurulum tamamdır.

---

## Sık karşılaşılan hatalar

### `type "user_role" already exists`

Migration'lar ikinci kez elle çalıştırılmış. PostgreSQL'de
`create type ... if not exists` yoktur, bu yüzden tekrar çalıştırma patlar.

Supabase CLI zaten uygulananları `supabase_migrations.schema_migrations`
tablosunda izler ve tekrarlamaz — **SQL dosyalarını Studio'ya elle
yapıştırmayın**, `db push` kullanın.

### `permission denied for schema auth`

Migration'ı `postgres` dışında bir rolle çalıştırıyorsunuz. Studio'nun SQL
Editor'ü ve `db push` doğru rolü kullanır; harici bir istemciyle bağlanıyorsanız
bağlantı dizesindeki kullanıcıyı kontrol edin.

### `must be owner of relation users`

`auth.users` üzerinde trigger oluşturma yetkisi yok. Bu, yalnızca kısıtlı bir
rolle bağlıyken olur; `db push` ile tekrar deneyin.

### Sürüm uyuşmazlığı / gölge veritabanı hatası

`config.toml`'daki `major_version` ile uzak projenin sürümü farklı.
Panel → Settings → Database'den gerçek sürümü okuyup eşitleyin.

### Demo şeridi kaybolmuyor

1. `.env` dosyası proje kökünde mi? (`apps/web/` içinde değil)
2. `NEXT_PUBLIC_SUPABASE_URL` gerçek adresi mi gösteriyor (`xxxxxxxx` kalmamış)?
3. Geliştirme sunucusu yeniden başlatıldı mı?

---

## Bundan sonrası

- **Ortaklık hesapları** — Amazon Associates / Trendyol / Hepsiburada onayı
  gelince `merchants` tablosuna gerçek `tracking_id` ve `deeplink_template`
  girin (bkz. `docs/operations.md` §1).
- **Alım hattı** — `node packages/ingest/dist/cli.js --dry-run` ile feed
  haritanızı doğrulayın, sonra GitHub Actions sırlarını (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`) ekleyin.
- **Yedekleme** — Ücretsiz katmanda günlük yedek yoktur. Ciro verisi
  (`conversions`) girmeye başladığında Pro'ya geçin veya `pg_dump` ile
  zamanlanmış yedek alın.
