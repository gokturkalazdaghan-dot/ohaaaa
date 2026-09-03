---
name: ohaaaa-token-optimizer
description: Ohaaaa deposunda context ve token kullanımını daraltır. Bir göreve başlarken, büyük bir dosya okumadan önce, depo genelinde arama yapmadan önce, subagent açmadan önce ve uzun bir tool çıktısıyla karşılaşınca kullan. Doğruluk, güvenlik, test ve üretim güvenilirliğinden taviz vermeden yalnızca GEREKSİZ işi eler.
---

# Ohaaaa Token Optimizer

Amaç **daha az düşünmek değil, gereksiz şeyi düşünmemek.**

`Relevant context > More context`

Bu skill hiçbir koşulda doğruluğu, güvenliği, testi, erişilebilirliği,
SEO'yu, performansı ya da gelir doğruluğunu azaltmak için kullanılmaz.
Kısaltılan şey **gürültü**, zekâ değil.

## 1. Önce kapsam belirle

Göreve başlamadan önce kendine sor:

- Gerçekten neyi bilmem gerekiyor?
- Hangi dosyalar gerçekten önemli?
- Hangi araçlar gerçekten gerekli?
- Önceki context'in hangisi hâlâ geçerli?
- Bu, daha az context ile çözülebilir mi?

Sonra kapsamı seç:

| Kapsam | Örnek | Context |
|---|---|---|
| **SMALL** | tek dosya, yazım hatası, tek CSS sorunu, tek bileşen | Yalnızca o dosya |
| **MEDIUM** | bir özellik, birkaç bileşen, API değişikliği, SEO sayfası | Yalnızca ilgili modül |
| **LARGE** | mimari, kimlik doğrulama, yerelleştirme, gelir, migration | Önce mimari haritası, sonra hedefli okuma |

**Depoyu baştan sona okumak yasak.** Hiçbir kapsamda gerekmez.

## 2. Asla context'e alma

```
node_modules/  .next/  dist/  build/  coverage/
.cache/  .turbo/  .git/  playwright-report/  test-results/
package-lock.json  *.map  üretilmiş tipler
```

Bunlara yalnızca somut bir soruyu cevaplamak için, hedefli bakılır.

## 3. Dosya okuma

Tamamını okumadan önce: boyutuna bak → ilgili sembolü bul → **yalnızca o
aralığı** oku.

```
KÖTÜ:  cat apps/web/src/data/catalog.ts          # 1500+ satır
İYİ:   grep -n "getFlashDeals" catalog.ts        # satırı bul
       sed -n '660,700p' catalog.ts              # yalnızca o bölüm
```

**Aynı oturumda değişmemiş bir dosyayı tekrar baştan okuma.** Değiştiyse
yalnızca değişen bölümü oku.

## 4. Arama sırası

1. Kesin sembol / dosya adı
2. İlgili dizin
3. Depo geneli — **yalnızca ilk ikisi yetmezse**

Geniş arayıp sonra çıkan her şeyi okumak yerine: `ara → belirle → hedefli oku`.

## 5. Tool çıktısı

Uzun çıktıyı olduğu gibi context'e taşıma. Filtrele:

```
npm test        → grep -E "^# (pass|fail)"        (97 satır değil, 2 satır)
npm run build   → grep -E "Compiled|error"
verify:sql      → dosyaya yaz, sonra tail -5 + grep "not ok"
git diff        → önce git diff --stat, sonra yalnızca ilgili yolun diff'i
psql            → | tail -N  ya da hedefli SELECT
```

Kural: `çıktı → filtrele → özetle → yalnızca sonucu al`.

## 6. Git

```
KÖTÜ:  git diff                    # binlerce satır
İYİ:   git status --short
       git diff --stat
       git diff -- apps/web/src/components/Header.tsx
```

## 7. Bu depoda tekrar üretilmeyecek bilgiler

Aşağıdakiler zaten yazılı; her seferinde yeniden keşfetme:

| Bilgi | Kaynak |
|---|---|
| Mimari | `docs/architecture.md` |
| Uzman skill kaydı, hangi Supervisor altında ne var | `docs/skills.md` |
| Ortam değişkenleri ve neden var oldukları | `.env.example` |
| Veritabanı şeması ve kararların gerekçesi | `supabase/migrations/*.sql` başlık yorumları |
| Doğrulama komutları | `package.json` scripts |
| Kurulu skill'ler | `skills-lock.json` |

## 8. Supervisor kapsamı

12 Supervisor mimarisi korunur. Bir görev için **yalnızca gerekli
Supervisor** context'e girer.

```
SEO görevi        → SEO + GLOBAL GOVERNOR + RISK & QUALITY
Ödeme görevi      → REVENUE + RISK & QUALITY
Arayüz görevi     → COMMERCE + RISK & QUALITY (+ UX/UI uzmanı)
```

AUTOMOTIVE, TRAVEL, MERCHANT gibi ilgisiz Supervisor'lar context'e sokulmaz.
Birden fazlası gerekiyorsa `AI BRAIN → gerekli Supervisor'lar → uzmanlar`
zinciri kurulur; hepsi birden çalıştırılmaz.

## 9. Subagent

Yalnızca **gerçek paralellik avantajı varsa** aç. Şunlar için açma:
yazım hatası, tek dosya değişikliği, basit arama, küçük CSS, tek test.

Açılıyorsa: belirli görev + belirli dosyalar + belirli çıktı biçimi ver.
Subagent'tan depo özeti isteme.

Çıktı sözleşmesi:

```
RESULT / FILES / CHANGES / ERRORS / NEXT ACTION
```

## 10. Görev durumu (uzun görevlerde)

Her aşama sonunda kısa durum kaydı bırak; böylece yeni context'e geçerken
geçmişin tamamı tekrar okunmaz.

```
TASK STATE
Completed:
Changed:
Verified:
Remaining:
Important decisions:
Next action:
```

## 11. Aşamalı çalışma

Büyük görevi tek dev oturumda yürütme:

```
Audit → Mimari → Uygulama → Test → Son doğrulama
```

Her aşama yalnızca kendi context'ini taşır. Aşama bitince, büyük dosyalar
okunduysa ya da uzun test çıktıları biriktiyse `/compact`; tamamen farklı
bir göreve geçiliyorsa `/clear`. Compact'ten **önce** görev durumunu yaz.

## 12. Muhakeme seviyesi

Her göreve aynı derinlik uygulanmaz — ama **şu konularda token tasarrufu
için muhakeme düşürülmez**:

güvenlik · ödeme · gelir · kimlik doğrulama · veritabanı migration ·
üretim dağıtımı

## 13. Yanıt uzunluğu

Kod görevi bitince `Changed / Verified / Remaining` yetiyorsa uzun anlatma.
Güvenlik, mimari ve üretim riski söz konusuysa gereken açıklama yapılır —
orada kısalık kalite kaybıdır.

## 14. Ohaaaa'ya özel: doğrulamadan kısılmaz

Şu veriler token tasarrufu için doğrulama dışı bırakılamaz:

`price` · `merchant` · `stock` · `currency` · `affiliate` · `revenue` ·
`conversion` · `cash received` · `Ohaaaa Score`

Bunlara dokunan her değişiklikte ilgili test **çalıştırılır**, çıktısı
filtrelenir ama atlanmaz.

## 15. Sahte sıkıştırma yasak

Token azaltmak için şunlar silinmez: önemli context, güvenlik kuralları,
kabul kriterleri, test gereksinimleri, mimari bilgisi, alınmış kararlar.

## Görev sonu kontrol listesi

- [ ] Gereksiz dosya okunmadı
- [ ] Aynı dosya gereksiz tekrar okunmadı
- [ ] Gereksiz tool çıktısı context'e alınmadı
- [ ] Gereksiz subagent açılmadı
- [ ] Görev durumu kaydedildi
- [ ] Testler çalıştırıldı (çıktı filtrelendi, atlanmadı)
- [ ] Güvenlik kontrol edildi
- [ ] Gerekiyorsa build/typecheck çalıştırıldı
- [ ] Gerçek veri yolu doğrulandı
