# Uzman Skill Kaydı

Bu belge, Ohaaaa'da hangi uzman yeteneğin **gerçekten kurulu**, hangisinin
**kurulu olmadığını** ve her birinin hangi Supervisor altında çalıştığını
tutar.

Tek kural: **dosya var diye entegre sayılmaz.** Bir skill ancak kurulduğu
_ve_ bir iş akışına bağlandığı zaman bu belgede "entegre" yazar.

## Öncelik sırası (çakışma çözümü)

Bir uzman skill ile Ohaaaa çelişirse Ohaaaa kazanır. Sıra:

1. Ohaaaa mühendislik direktifi
2. Ohaaaa güvenlik ve gizlilik gereksinimleri
3. Ohaaaa mimarisi
4. Çalışan üretim kodu
5. Onaylı uzman skill'ler
6. Dış proje önerileri
7. Genel iyi uygulamalar

Uzman skill'ler **Supervisor değildir**. 12 Supervisor mimarisi üsttedir;
skill'ler ilgili Supervisor'ın altında birer yetenektir.

## Kurulu ve doğrulanmış

| Skill | Supervisor | Kaynak | Durum |
|---|---|---|---|
| `ui-ux-pro-max`, `design`, `design-system`, `ui-styling`, `banner-design`, `brand`, `slides` | UX/UI | `nextlevelbuilder/ui-ux-pro-max-skill` | Kurulu |
| `apple-design`, `animate`, `animate-expo`, `animation-vocabulary`, `emil-design-eng`, `ask-sonner`, `review-animations`, `improve-animations`, `find-animation-opportunities`, `prototype`, `pick-ui-library` | UX/UI | `emilkowalski/skill` | Kurulu |
| `task-observer` | Geliştirme ortamı | `rebelytics/one-skill-to-rule-them-all` | Kurulu |
| `write-swift` | — | `emilkowalski/skill` | Kurulu (Ohaaaa'da Swift yok) |

Kurulum kanıtı `skills-lock.json` içindedir (kaynak + içerik özeti).
Doğrulama: `npx skills list`.

### task-observer — kapsam sınırı

Gözlem yapar ve **öneri üretir**. Kendi belgeleri bir oturum-başı kancası
(session-start hook) kurulmasını öneriyor; **bu kanca kurulmadı**. Sebep:
kanca kalıcı bir davranış değişikliğidir ve protokol gereği ayrı onay ister.
Gözlem, skill açıkça çağrıldığında yapılır.

Skill hiçbir koşulda mimariyi ya da üretim davranışını sessizce değiştiremez.

## Kurulu DEĞİL — sizin yapmanız gereken

### `AgriciDaniel/claude-seo` → SEO & Organic Growth Supervisor

Bir **Claude Code plugin marketplace**'i; `npx skills add` ile kurulamaz ve
slash komutlarını ajan çalıştıramaz. Claude Code arayüzünde şunu yazın:

```
/plugin marketplace add AgriciDaniel/claude-seo
/plugin install claude-seo@agricidaniel-claude-seo
```

Doğrulanan bilgiler: depo erişilebilir, `LICENSE` mevcut,
`.claude-plugin/marketplace.json` geçerli, 25 alt-skill + 18 alt-ajan,
8 isteğe bağlı MCP eklentisi (DataForSEO, Firecrawl, Ahrefs, SE Ranking…).

**MCP eklentileri varsayılan olarak bağlanmayacak.** Her biri dış servis,
ücretli hesap ve yeni bir sır demek; protokolün API değerlendirme listesi
(lisans, oran sınırı, gizlilik, veri sahipliği, satıcı kilidi) her biri için
ayrı ayrı yapılmadan üretime bağlanmaz.

Kurulduktan sonra bağlanacağı iş akışı:

```
SEO çıktısı → ölçülebilir iddia mı? → hayır ise KULLANILMAZ
            → evet ise → mevcut doğrulama zinciri:
              npm run verify:brand
              npm run verify:routes
              npm run verify:browser
              npm run verify:a11y
```

SEO'nun başarı ölçütü trafik değil:
`Organik trafik → niyet → fırsat → tıklama → dönüşüm → gelir → tahsilat`.
Tahsilat ölçümü `/yonetim/tahsilat` sayfasında ve `revenue_summary()`
fonksiyonundadır.

### `zubair-trabzada/geo-seo-claude` → kurulmadı (bilinçli)

`claude-seo` zaten GEO/AI-search optimizasyonunu kapsıyor. İkisini birden
kurmak **NO DUPLICATION** kuralının ihlali olurdu. `claude-seo` yetersiz
kaldığı ölçülürse yeniden değerlendirilir.

### `usestrix/strix` → Risk & Quality Supervisor — kurulmadı

İki gerekçe:

1. **Çalışamaz.** Strix, sandbox imajı için çalışan bir Docker daemon'ı
   ister; bu ortamda Docker kurulu ama daemon yok. Kurmak, "kurulu ama
   işlemiyor" durumu üretirdi.
2. **Kendi kuralımızla çakışıyor.** Strix'in belgeleri yalnızca sahibi
   olduğunuz ya da **yazılı izniniz** olan sistemlere yöneltilmesini şart
   koşuyor. Ohaaaa üretimde Supabase ve Vercel üzerinde çalışıyor — ikisi de
   üçüncü taraf altyapı. Protokol: _"Never perform destructive security
   testing against third-party infrastructure."_

Yerine ne yapıldı: mevcut denetim genişletildi (aşağıya bakın). Strix
ileride yalnızca **yerel** bir örneğe yöneltilerek ya da sağlayıcılardan
yazılı izin alınarak devreye girebilir.

### `vercel-labs/skills` → kurulacak bir şey yok

Bu, skill kurulum aracının kendisi (`npx skills`). Bu ortamda çalışıyor ve
`task-observer` onunla kuruldu.

## Strix yerine: kalıcı güvenlik kontrolleri

Tek seferlik bir tarama yerine, her derlemede tekrarlanan kontroller:

| Kontrol | Dosya | Ne yakalar |
|---|---|---|
| Sır sütunu taraması | `supabase/tests/72_secret_column_sweep_test.sql` | Adı sır çağrıştıran **her** sütunu katalogdan tarar; istemciye açıksa derlemeyi düşürür. Yeni tablolar kendiliğinden kapsama girer. |
| Adı bilinen sırlar | `supabase/tests/69_secret_columns_test.sql` | `postback_secret`, `tracking_id`, `deeplink_template`, `commission_rate` |
| Yetki tabanı | `supabase/tests/25_grants_test.sql` | TRUNCATE/TRIGGER/REFERENCES ve yazma yetkisi taşması |
| RLS davranışı | `supabase/tests/20_rls_test.sql` | Satır sızıntısı |
| AI bütçesi | `supabase/tests/70_ai_budget_test.sql` | Kimliksiz uç noktalarda maliyet tavanı |
| Tahsilat bütünlüğü | `supabase/tests/71_cash_received_test.sql` | Kanıtsız "tahsil edildi" |
| Marka yazımı | `scripts/verify-brand.mjs` | O + dört a dışındaki her yazım |

Bu tabloda **postback sırrı açığı gerçekten bu yöntemle bulundu** —
otomatik tarama, "birinin bakmayı akıl etmesi"nin yerine geçen şeydir.

## Yeni skill eklerken

Protokolün değerlendirme listesi, sırayla:

1. Kaynak itibarı
2. GitHub etkinliği
3. Lisans
4. Kullanım kanıtı
5. Güvenlik etkileri
6. Bakım durumu
7. Mevcut yeteneklerle örtüşme
8. Ohaaaa'ya somut değeri

Ardından **insan onayı**. Popüler olması gerekçe değildir; örtüşen bir
yetenek eklenmez.

> Not: Bu oturumda `npx skills find` kayıt defteri sandbox'tan erişilemedi
> (kurulu `animate` skill'ini bile bulamıyor) ve GitHub API'si oturumun
> kendi deposuyla sınırlı. Depo doğrulaması `raw.githubusercontent.com`
> üzerinden yapıldı; yıldız sayısı ve son itme tarihi gibi etkinlik
> ölçütleri bu ortamdan **doğrulanamadı** ve doğrulanmış gibi
> sunulmamalıdır.
