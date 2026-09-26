-- =============================================================================
-- AWIN: DÜŞÜK SEPET DEĞERLİ KAYNAKLAR KAPATILDI
-- =============================================================================
-- Hesap sahibinin önceliği (26/09/2026): yüksek komisyon TUTARI bırakan
-- ürünler -- elektrik/elektronik, mobilya, telefon, bilgisayar. Sarf ve
-- düşük sepetli kategoriler istenmiyor.
--
-- 20260926140000 göçünün açtığı kaynaklardan KALANLAR:
--   decathlon-ie (spor ekipmanı, bisiklet), eonon-us (araç elektroniği),
--   kippy-it (GPS takip cihazı), mooncool (çocuk mobilyası),
--   dyu-bikes (elektrikli bisiklet), fullscopemd (tıbbi cihaz),
--   grade-mobile (yenilenmiş telefon; iki ek feed).
--
-- KAPATILANLAR: hairdressing-supplies, belleek, red-gorilla-international,
--   enjox-toys, tsarbomba, giftlab, pandahall, dima-eyewear-us.
--
-- NASIL: kaynak kapatılır (alım hattına girmez), yazılmış teklifler
-- `archived` olur (arama ve vitrin yalnızca `active` teklifi gösterir),
-- mağaza `paused` olur. Hiçbir satır SİLİNMEZ: tıklama ve dönüşüm geçmişi
-- tekliflere bağlı; silmek o izi koparırdı. Karar geri alınırsa kaynak
-- yeniden açılır ve bir sonraki tur teklifleri tazeler.
--
-- RED GORILLA ÖNCEKİ HÂLİNE DÖNER. 20260905110000/20260905120000 göçleri
-- onu kısa listede ADAY (prospect, not_started, şartlar doğrulanmamış)
-- olarak kurdu ve `88_awin_advertiser_terms_test` o hâli iddia ediyor.
-- Onu yayına alan tek şey bir önceki göçtü; kapatılınca kısa listedeki
-- kaydı da ilk hâline döner.
-- =============================================================================

begin;

update public.sources
   set is_enabled = false
 where slug in ('hairdressing-supplies-main', 'belleek-uk', 'belleek-eu',
                'red-gorilla-main', 'enjox-toys-main', 'tsarbomba-main',
                'giftlab-main', 'pandahall-main', 'dima-eyewear-us-main');

update public.products p
   set status = 'archived'
  from public.sources s
 where s.id = p.source_id
   and s.slug in ('hairdressing-supplies-main', 'belleek-uk', 'belleek-eu',
                  'red-gorilla-main', 'enjox-toys-main', 'tsarbomba-main',
                  'giftlab-main', 'pandahall-main', 'dima-eyewear-us-main')
   and p.status <> 'archived';

update public.merchants
   set status = 'paused',
       notes  = concat_ws(' | ', notes,
         'KAPATILDI (26/09/2026): dusuk sepet degerli kategori; hesap sahibi '
         || 'elektronik/mobilya/telefon/bilgisayar onceligi istedi.')
 where slug in ('hairdressing-supplies', 'belleek', 'enjox-toys', 'tsarbomba',
                'giftlab', 'pandahall', 'dima-eyewear-us');

update public.merchants
   set status             = 'prospect',
       display_name       = 'Red Gorilla International',
       application_status = 'not_started',
       approved_at        = null,
       terms_verified_at  = null,
       deeplink_template  = null,
       countries          = null
 where slug = 'red-gorilla-international';

commit;
