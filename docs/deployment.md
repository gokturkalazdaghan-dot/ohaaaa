# Yayına Alma — ohaaaa.com

Alan adı alındıktan sonra sırayla yapılacaklar. Tahmini süre: **2–3 saat**
(DNS yayılımı hariç).

---

## Hızlı yol — tek komut

Supabase projesini tarayıcıda açtıktan sonra aşağıdaki komut; migration'ları
uygular, anahtarların doğru yuvaya girdiğini doğrular, her tabloda RLS'in açık
olduğunu kontrol eder, Vercel ortam değişkenlerini yazar, üretime dağıtır ve
canlı siteyi denetler:

```bash
./scripts/setup-production.sh
```

Betik `supabase/seed.sql`'i **üretime uygulamaz** — o dosya uydurma satıcı ve
uydurma fiyat içerir. Aşağıdaki bölümler aynı işi elle yapmak isteyenler ve
betiğin ne yaptığını anlamak isteyenler içindir.

---

## 0. Yayın öncesi kilidi

Site, `NEXT_PUBLIC_LAUNCH_STATE` ayarlanmadığı sürece **arama motorlarına
kapalıdır** (`robots.txt` + `noindex` meta etiketi). Varsayılan bilinçli
olarak `prelaunch`tır.

**Neden:** Yasal metinler henüz kurulmamış bir işletmeyi adres gösteriyorsa ve
Google bu hâliyle indekslerse, sonradan düzeltilse bile o sürüm önbellekte ve
üçüncü taraf arşivlerde kalır. Ayrıca 6563 sayılı Kanun, e-ticaret hizmet
sağlayıcısının kimlik bilgilerini yayımlamasını zorunlu kılar — kayıtlı bir
işletme yokken bu bilgi verilemez.

Bu aşamada site **erişilebilir**: bağlantıyı bilen herkes girebilir, test
edebilirsiniz. Yalnızca indekslenmez.

### `live`'a geçmeden önce tamamlanması gerekenler

- [ ] İşletme kaydı yapıldı (vergi levhası alındı)
- [ ] ETBİS kaydı tamamlandı, numara alındı
- [ ] `/iletisim`, `/gizlilik`, `/kosullar` sayfalarındaki köşeli parantezli
      alanlar dolduruldu
- [ ] Yasal metinler bir hukukçu tarafından gözden geçirildi
- [ ] Çalışan e-posta adresleri kuruldu (`destek@`, `kvkk@`, …)

Hepsi tamamlandığında:

```sh
NEXT_PUBLIC_LAUNCH_STATE=live
```

ve **yeniden dağıtım** yapın (bu değer de derleme zamanında gömülür).

> Şerit her sayfada görünür ve kapatılamaz. Bu bilinçlidir: şeridin varlığı,
> hâlâ `prelaunch` modunda olduğunuzun tek görünür işaretidir.

---

## 0.5. Kanonik adres kararı

`www.ohaaaa.com` mi, `ohaaaa.com` mı? **Birini seçin ve diğerini
yönlendirin.** İkisi de yanıt verirse Google iki ayrı site görür, otoriteniz
ikiye bölünür.

Öneri: **çıplak alan adı** (`https://ohaaaa.com`). Kısa, akılda kalıcı ve
marka adıyla birebir. `www` ondan 301 ile yönlendirilecek.

Bu karar koda da yansır — `NEXT_PUBLIC_SITE_URL` tam olarak bu değer olmalıdır.

---

## 1. Barındırma

Next.js için en az sürtünmeli seçenek **Vercel**'dir: sıfır yapılandırma,
otomatik SSL, önizleme dağıtımları ve `sitemap.ts`/`robots.ts` gibi Next
özellikleri kutudan çalışır. Ücretsiz katman başlangıç için yeterlidir.

```sh
npm install -g vercel
cd ohaaaa
vercel link
```

**Proje ayarları:**

| Ayar | Değer |
|---|---|
| Framework | Next.js |
| Root Directory | `apps/web` |
| Build Command | `cd ../.. && npm run build --workspace @ohaaaa/shared && cd apps/web && next build` |
| Install Command | `cd ../.. && npm install` |
| Node.js Version | 22.x |

> Monorepo olduğu için `@ohaaaa/shared` paketi web'den **önce** derlenmelidir;
> yukarıdaki build komutu bunu yapar.

**Alternatifler:** Netlify, Cloudflare Pages veya kendi sunucunuzda
`next start` + nginx. Hepsi çalışır; sitemap/robots yolları için Next'in
kendi sunucusunu (standalone çıktı) kullanmanız gerekir.

---

## 2. Ortam değişkenleri

Vercel → Project → Settings → **Environment Variables**. Üçü de
(Production / Preview / Development) için ayrı ayrı ayarlanabilir.

```sh
# ZORUNLU — eksikse derleme kırılır (bilinçli)
NEXT_PUBLIC_SITE_URL=https://ohaaaa.com

# Yayın durumu. Ayarlanmazsa 'prelaunch' kabul edilir (arama motorlarına kapalı).
# İşletme kaydı ve yasal metinler tamamlanana kadar böyle kalmalı.
NEXT_PUBLIC_LAUNCH_STATE=prelaunch

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...     # SADECE sunucu — Preview'a da koymayın

# Tıklama özetlerinin tuzu
CLICK_HASH_SECRET=<openssl rand -hex 32 çıktısı>

# SEO / ölçümleme (sonradan eklenebilir)
NEXT_PUBLIC_GA_MEASUREMENT_ID=
NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=

# Taşeron API'si ayrı bir yerde barındırılıyorsa
NEXT_PUBLIC_API_BASE_URL=https://api.ohaaaa.com
```

> **`NEXT_PUBLIC_*` değişkenleri derleme zamanında gömülür.** Değiştirdikten
> sonra **yeniden dağıtım** yapmanız gerekir; ortam değişkenini güncellemek
> tek başına yetmez.

> **`SUPABASE_SERVICE_ROLE_KEY`'i Preview ortamına koymayın.** Önizleme
> adresleri tahmin edilebilir ve genelde korumasızdır; RLS'i bypass eden bir
> anahtarı oraya koymak tüm veritabanını açar.

---

## 3. DNS kayıtları

Alan adı kayıt firmanızın panelinde (veya Cloudflare'de) aşağıdakileri girin.

### 3.1 Site

| Tip | Ad | Değer | Not |
|---|---|---|---|
| `A` | `@` | Vercel'in verdiği IP | Panelde **Domains** altında gösterilir |
| `CNAME` | `www` | `cname.vercel-dns.com` | `www` → çıplak yönlendirme için |

Vercel → Project → Settings → **Domains** → `ohaaaa.com` ekleyin. Panel size
girmeniz gereken **tam değerleri** gösterir; buradaki isimler değişebileceği
için **panelin verdiği değeri esas alın**.

Aynı ekranda `www.ohaaaa.com`'u da **ekleyin** (yönlendirme seçeneğini
işaretlemeniz şart değil).

`www` → çıplak yönlendirmesi artık `apps/web/next.config.ts` içinde tanımlı ve
`NEXT_PUBLIC_SITE_URL`'den türetiliyor: kanonik adres www'suzsa www'lu istekler
308 ile çıplak alan adına gider, kanonik adres www'luysa yön tersine döner.
Panel ayarına güvenmiyoruz çünkü panel ayarı depoda görünmez, gözden kaçar ve
başka bir ortama taşınınca gelmez.

### 3.2 E-posta

Sitede dört adres yayınlıyoruz ve bunlar **çalışmak zorunda** — KVKK
aydınlatma metni çalışan bir başvuru kanalı gerektirir:

```
destek@ohaaaa.com     duzeltme@ohaaaa.com
satici@ohaaaa.com     kvkk@ohaaaa.com
iletisim@ohaaaa.com   (bot sayfasında)
```

Google Workspace, Zoho Mail (ücretsiz katmanı var) veya Fastmail kullanın.
Sağlayıcının verdiği `MX` kayıtlarını girin, ardından **üçünü de** ekleyin:

| Tip | Ad | Değer | Ne işe yarar |
|---|---|---|---|
| `TXT` | `@` | `v=spf1 include:<sağlayıcı> ~all` | Kimin adınıza posta gönderebileceği |
| `TXT` | `<seçici>._domainkey` | Sağlayıcının verdiği DKIM anahtarı | Postanın yolda değiştirilmediği |
| `TXT` | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@ohaaaa.com` | İhlal edildiğinde ne yapılacağı |

> **DMARC'ı posta göndermeseniz bile ekleyin.** Kaydı olmayan bir alan adı
> adına sahte posta göndermek serbesttir; yeni bir marka için bu, ilk
> karşılaşacağınız dolandırıcılık biçimidir.

### 3.3 Doğrulama kayıtları

Search Console ve ortaklık ağları alan adı sahipliğini doğrulatır. Bunlar
`TXT` kaydı olarak `@` altına eklenir; her sağlayıcı kendi değerini verir.

---

## 4. Supabase tarafını hizalayın

Panel → **Authentication → URL Configuration**:

```
Site URL:               https://ohaaaa.com
Redirect URLs:          https://ohaaaa.com/**
                        https://*.vercel.app/**     (önizleme dağıtımları için)
```

Bu ayar yapılmazsa e-posta doğrulama ve parola sıfırlama bağlantıları
`localhost`'a gider.

---

## 5. Yayın sonrası doğrulama

Dağıtım bittikten sonra sırayla:

```sh
# 1. Yönlendirme çalışıyor mu? (308 ve Location: https://ohaaaa.com bekleniyor)
curl -sI https://www.ohaaaa.com | grep -iE "^HTTP|^location"

# 2. HTTPS zorunlu mu?
curl -sI http://ohaaaa.com | grep -iE "^HTTP|^location"

# 3. robots.txt doğru alan adını gösteriyor mu? (localhost KALMAMALI)
curl -s https://ohaaaa.com/robots.txt

# 4. Sitemap gerçek adresleri içeriyor mu?
curl -s https://ohaaaa.com/sitemap.xml | grep -c "https://ohaaaa.com"

# 5. Yapılandırılmış veri gömülü mü?
curl -s https://ohaaaa.com/urun/<bir-slug> | grep -c "application/ld+json"

# 6. service_role anahtarı istemciye sızmış mı? (0 DÖNMELİ)
curl -s https://ohaaaa.com | grep -c "service_role"
```

**6. maddede sıfırdan farklı bir sayı görürseniz derhal anahtarı döndürün.**

Ardından:

- [ ] **Search Console** → Mülk ekle → `https://ohaaaa.com` → sitemap gönder
- [ ] **Zengin sonuç testi** → search.google.com/test/rich-results → bir ürün
      sayfasını girin; `Product` ve `AggregateOffer` görünmeli
- [ ] **Lighthouse** → ana sayfa ve bir ürün sayfası
- [ ] **E-posta testi** → dört adrese de dışarıdan posta atıp ulaştığını
      doğrulayın
- [ ] **`/bot` sayfası** açılıyor mu (tarayıcı ajanımızın User-Agent'ı oraya
      işaret ediyor)

---

## 6. Alt alan adları

İleride gerekecekler — şimdiden planlayın:

| Alt alan | Ne için | Not |
|---|---|---|
| `api.ohaaaa.com` | Taşeron API'si (`packages/backend`) | Ayrı barındırma; `CORS_ORIGINS=https://ohaaaa.com` |
| `cdn.ohaaaa.com` | Ürün görselleri | Supabase Storage veya Cloudflare R2 |
| `status.ohaaaa.com` | Kesinti sayfası | Sonraya bırakılabilir |

`api` alt alan adını kullanacaksanız `NEXT_PUBLIC_API_BASE_URL` değerini de
güncelleyin — panelde gösterilen örnek `curl` komutları bu adresi kullanır.

---

## 7. Hemen sonrası

1. **Ortaklık başvuruları.** Artık gerçek bir alan adınız var; Amazon
   Associates, Trendyol ve Hepsiburada başvurularının çoğu çalışan bir site
   ister. Site yayında olduğuna göre başvurabilirsiniz.
2. **Yasal metinleri tamamlayın.** `/iletisim`, `/gizlilik` ve `/kosullar`
   sayfalarındaki köşeli parantezli alanlar (unvan, MERSİS, vergi no) şirket
   bilgileriyle doldurulmalı — 6563 sayılı Kanun bunu zorunlu kılar.
3. **Yedekleme.** Supabase ücretsiz katmanında günlük yedek yoktur. Ciro
   verisi girmeye başlamadan önce Pro'ya geçin.
