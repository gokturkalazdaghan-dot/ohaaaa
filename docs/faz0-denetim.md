# FAZ 0 — Mevcut Durum Denetimi

**Tarih:** 2026-09-25 · **Kapsam:** kod değişikliği YOK, yalnızca ölçüm.

Kanıtlar üç kaynaktan: (1) depo kodu, (2) üretim veritabanı (Supabase
`ltqpitckngaytisjyjqi`, Pro plan), (3) canlı site (`https://www.ohaaaa.com`).

---

## Özet tablo

| # | Alan | Durum | Ölçülen gerçek |
|---|---|---|---|
| 1 | Awin provider | **PASS** | `packages/shared/src/providers/awin.ts` (362 sat.) — pull tabanlı dönüşüm, clickref↔subid, mid↔mağaza eşlemesi. Canlı yönlendirme doğrulandı. |
| 2 | Affiliate abstraction | **PARTIAL** | Sözleşme yalnızca postback/deeplink/dönüşümü kapsıyor. `programs`, `catalog/feed`, `offers`, `commissions` arayüzde YOK. |
| 3 | Impact hazırlığı | **FAIL** | Yalnızca `affiliate_networks` satırı var. Provider dosyası yok, ENV yok, `merchant_network_links` CHECK kısıtı `('direct','awin')` ile kapalı. |
| 4 | CJ | **FAIL** | Aynı durum: DB satırı var, kod yok. |
| 5 | Direct provider | **PASS** | HMAC-SHA256 postback doğrulaması, testli. |
| 6 | Feed ingestion | **PASS** | 3 kaynak, günlük çalışıyor; son tur `bto-instock` 35.478 kalem, `success`. Idempotent RPC upsert + fingerprint farkı. |
| 7 | Product Group / Offer modeli | **PARTIAL** | Model doğru, veri bozuk: 52.415 gruptan **15.662'si teklifsiz** (%30). Yalnızca **764** grupta ≥2 teklif, **1** grup birden fazla mağaza içeriyor. |
| 8 | Search | **PASS** | Canlı: `/arama?q=iphone` → 200, 24 ürün bağlantısı (4,2 sn). |
| 9 | Product detail | **PASS** | Canlı: `/urun/grade-mobile-iphone-8-5s3j1t` → 200 (1,0 sn), Product/Offer/AggregateOffer/BreadcrumbList JSON-LD mevcut. |
| 10 | Merchant | **PASS** | `/magaza/[slug]` mevcut; 29 mağaza kaydı, 3'ü aktif ve teklif taşıyor. |
| 11 | Affiliate redirect | **PASS** | `/git/<offerId>` → 302 → `awin1.com/cread.php?awinmid=22069&awinaffid=3074081&clickref=…&ued=…` |
| 12 | Click tracking | **PASS** | Test tıklaması DB'ye düştü: `clicks` 17:31:06Z, `placement=product_page`, `price_cents_at_click=5900`. Günlük ~250 tık, %100'ü subid'li. |
| 13 | Conversion | **PARTIAL** | Kod + cron hazır (`/api/cron/donusum-esitle`, günlük 05:00). Ama `conversions` tablosu **0 satır** ve `AWIN_API_TOKEN` üretimde doğrulanamadı. |
| 14 | Commission | **PARTIAL** | Şema ve mutabakat yolu var (`payouts`, `payout_conversions`); dönüşüm olmadığı için hiç veri üretmedi. |
| 15 | Price history | **PASS** | `price_points` 65.786 satır, `product_group_price_stats` 36.753 satır, `price_history()` RPC canlı. |
| 16 | Supabase index / cache | **PARTIAL** | DB 450 MB / 8 GB. Teklif başına ~8,9 KB → mevcut satır boyuyla tavan ~800k teklif. `katalog-tazele` yalnızca ingest iş akışından tetikleniyor. |
| 17 | Cron / sync | **PARTIAL** | Vercel'de 2 cron (fiyat-alarmı, dönüşüm); alım GitHub Actions'ta 6 saatte bir. **Incremental sync sütunları var, onları okuyan kod YOK.** |
| 18 | Localization | **PARTIAL** | `locale` ≠ `market` ayrımı doğru kurulmuş (tr/de/en). Ama 41 pazardan yalnızca **UK (45.086)** ve **PL (3.342)** teklif taşıyor; US = 0. |
| 19 | SEO | **PASS** | `sitemap.xml` 200 (9,7 sn), `robots.txt` 200, canonical/hreflang/JSON-LD mevcut. Site haritası `offer_count > 0` filtreli — boş gruplar dışarıda. |
| 20 | Mobile | **PARTIAL** | Flutter istemcisi + duyarlı web var; `verify:browser` / `verify:a11y` betikleri mevcut, bu turda çalıştırılmadı. |

---

## Çalışanlar

- **Para zinciri uçtan uca ayakta:** arama → ürün → teklif → `/git` → Awin deeplink → `clicks` satırı. Canlı olarak doğrulandı.
- **Alım hattı sağlıklı:** 3 kaynak, idempotent toplu yazma (`ingest_upsert_offers` RPC), fingerprint ile değişiklik farkı, boş feed'e karşı koruma, nezaket/SSRF kapısı (`politeClient`).
- **Sağlayıcı sözleşmesi doğru kurulmuş:** doğrulama ile normalize etme ayrı; bilinmeyen ağ sessizce `direct`'e düşmüyor, hata fırlatıyor.
- **Awin'in pull tercihi gerekçeli:** dönüşüm durumu sonradan değiştiği için imzasız push yolu kapalı tutulmuş.
- **Kalite kapıları yeşil:** `npm run typecheck` → 0 hata; `npm test` → **986/986 geçti** (25 + 256 + 705).
- **Güvenlik taban çizgisi iyi:** Supabase security advisor'da **ERROR seviyesinde bulgu yok**; kuruş-tam sayı aritmetiği, sabit zamanlı sır karşılaştırması, open-redirect savunması yerinde.

## Eksikler

1. **Katalogda %30 ölü grup.** 15.662 `product_groups` satırı teklifsiz. Site haritasından filtreleniyor ama DB'de duruyor ve 204 MB'lık tablonun payını taşıyor.
2. **Fiyat karşılaştırması pratikte yok.** 52.415 gruptan yalnızca **1**'i birden fazla mağaza içeriyor. Ürünün temel vaadi bugün veriyle karşılanmıyor — üç mağaza üç ayrı ülkede ve ayrı kategorilerde.
3. **Incremental sync ölü şema.** `sources.sync_mode / sync_cursor / sync_watermark / http_etag / last_full_sync_at` sütunları 20260908100700 göçüyle eklenmiş; **hiçbir kod bunları okumuyor ya da yazmıyor.** Üç kaynağın üçü de `full`.
4. **Sağlayıcı arayüzü katalog tarafını kapsamıyor.** Program keşfi, feed okuma ve teklif üretimi Awin'e özgü kodda ve script'lerde dağınık; `AffiliateProvider` bunları tanımıyor.
5. **`merchant_network_links` CHECK kısıtı iki ağa kilitli** (`'direct','awin'`) — Impact satırı eklenemez.
6. **ENV dokümantasyonu eksik.** `AWIN_API_TOKEN` ve `AWIN_DATAFEED_API_KEY` kod ve iş akışında kullanılıyor ama `.env.example` içinde yok.
7. **`product_group_markets` tablosu boş** (0 satır) — pazar↔grup ilişkisi kurulmamış.
8. **`products.gtin` sütunu tamamen NULL** (48.428/48.428). Eşleme `product_groups.gtin` üzerinden yürüdüğü için işlev kaybı yok; sütun ölü.
9. **1.164 bayat teklif** (>7 gün görülmemiş) hâlâ aktif katalogda.
10. **Advisor uyarıları:** `citext` ve `pg_trgm` `public` şemasında; 11 SECURITY DEFINER fonksiyonu `anon`'a açık (çoğu vitrin için kasıtlı, ama denetlenmedi).

## Blocker'lar

| # | Blocker | Etkilediği faz |
|---|---|---|
| B1 | FAZ 2 hedef programlarının **10'undan 6'sı** keşfedilmiş, hepsi `DISCOVERED` — hiçbiri onaylı/aktif değil. Eksik: **40456 (Lunzo RO), 54353 (Lunzo SK), 69786 (Lunzo DE), 69428 (Ultrahuman)**. | FAZ 2 |
| B2 | Keşfedilen Lunzo/Lapert feed'lerinin her biri **~676.000 kalem** ilan ediyor; 9 program ≈ 6M teklif. Mevcut satır boyuyla (~8,9 KB) bu **~53 GB** eder; 8 GB disk buna yetmez. Kontrollü/filtreli alım şart. | FAZ 2, FAZ 7 |
| B3 | `program_feeds.feed_access` hepsinde `unverified`; hiçbir feed URL'si doğrulanmadı, ürün alanları ölçülmedi. | FAZ 2 |
| B4 | `conversions` = 0 ve `AWIN_API_TOKEN` üretimde doğrulanamıyor. Komisyon zinciri hiç kanıtlanmadı. | FAZ 5, FAZ 9 |
| B5 | Impact entegrasyonu için hem DB kısıtı hem provider dosyası hem ENV yok. | FAZ 1, FAZ 3 |

## Kritik dosyalar

| Dosya | Rol |
|---|---|
| `packages/shared/src/providers/types.ts` | Sağlayıcı sözleşmesi — FAZ 1'de genişletilecek yer |
| `packages/shared/src/providers/registry.ts` | Ağ→sağlayıcı kaydı; Impact buraya bir satır |
| `packages/shared/src/providers/awin.ts` | Awin pull/eşleme mantığı — **bozulmayacak** |
| `packages/shared/src/affiliate.ts` | Deeplink üretimi + open-redirect savunması |
| `packages/ingest/src/pipeline.ts` | Feed → normalize → kanonik eşleme |
| `packages/ingest/src/supabaseRepository.ts` | Toplu upsert, fingerprint farkı |
| `packages/ingest/src/runner.ts` | Zamanlayıcı + worker; tek alım yolu |
| `apps/web/src/app/git/[offerId]/route.ts` | Tıklama kaydı + yönlendirme |
| `apps/web/src/app/api/cron/donusum-esitle/route.ts` | Awin dönüşüm çekme turu |
| `supabase/migrations/20260908100600_merchant_network_links.sql` | Ağ CHECK kısıtı (B5) |
| `supabase/migrations/20260908100700_incremental_sync.sql` | Ölü incremental şema |
| `scripts/awin-feed-directory.mjs` | Feed dizini keşfi (618 feed) |
