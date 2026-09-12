-- ===========================================================================
-- 98 — Kaynak <-> feed <-> reklamveren bagi (Simple Project / F2281)
-- ===========================================================================
--
-- Buradaki tehlike bir kisit ihlali degil SESSIZ BIR KARISMA:
-- `upsertOffers(merchant_id, ...)` bir turdaki HER satiri kaynagin tek
-- magazasina yazar. Awin'in birlesik Product Data indirmesi tek dosyada
-- yuzlerce reklamverenin urununu tasidigi icin (elimizdeki ornek: 215
-- feed), boyle bir dosya tek kaynaga baglanirsa 215 magazanin urunu tek
-- magazaya yazilir ve HICBIR SAYAC bunu gostermez.
--
-- feed_id ile MID AYRI uzaylardir: 2281 bir feed, 158122 bir reklamveren.
-- Birinden digerini turetmek sessiz bir eslestirme hatasi olurdu.
begin;
select plan(10);

-- --- 1-3: bag dogru kuruldu mu -------------------------------------------
select is(
  (select feed_id from public.sources where slug = 'simple-project-awin-f2281'),
  '2281', '1) feed_id 2281 kayitli');

select is(
  (select expected_advertiser_id from public.sources where slug = 'simple-project-awin-f2281'),
  '158122', '2) beklenen reklamveren MID 158122');

select is(
  (select m.slug from public.sources s join public.merchants m on m.id = s.merchant_id
    where s.slug = 'simple-project-awin-f2281'),
  'simple-project'::citext, '3) kaynak dogru magazaya bagli');

-- --- 4: DETERMINISTIK BAG -------------------------------------------------
-- Kaynagin iddiasi ile magazanin gercek MID'i ayrisirsa koruma sessizce
-- anlamsizlasir: hat yanlis MID'e karsi dogrulama yapar.
select is(
  (select s.expected_advertiser_id = m.network_advertiser_id
     from public.sources s join public.merchants m on m.id = s.merchant_id
    where s.slug = 'simple-project-awin-f2281'),
  true, '4) kaynagin bekledigi MID magazanin gercek MID i ile ayni');

-- --- 5-6: pazar ve para birimi -------------------------------------------
select is(
  (select market_code from public.sources where slug = 'simple-project-awin-f2281'),
  'US', '5) pazar US -- TR varsayilanina dusmedi');

select is(
  (select currency from public.sources where slug = 'simple-project-awin-f2281'),
  'USD'::bpchar, '6) para birimi USD');

-- --- 7: SIR VERITABANINDA DUZ METIN DEGIL --------------------------------
select ok(
  (select position('${AWIN_DATAFEED_API_KEY}' in endpoint_url) > 0
     from public.sources where slug = 'simple-project-awin-f2281'),
  '7) adres sablonu sirrin ADINI tasir, degerini degil');

-- --- 8: kaynak HENUZ ETKIN DEGIL -----------------------------------------
-- merchants.homepage_url bos oldugu icin izinli alan adi turetilemiyor;
-- normalize.ts her urun adresini reddederdi (fail-closed).
select is(
  (select is_enabled from public.sources where slug = 'simple-project-awin-f2281'),
  false, '8) kaynak etkin degil -- ana sayfa ve dogrulanmis sartlar eksik');

-- --- 9-10: BTO / MID 61655 REGRESYONU ------------------------------------
select is(
  (select status::text from public.merchants where slug = 'back-to-the-office'),
  'prospect', '9) BTO hala prospect -- bu goc ona dokunmadi');

select is(
  (select count(*) from public.sources s join public.merchants m on m.id = s.merchant_id
    where m.network_advertiser_id = '61655'),
  0::bigint, '10) BTO icin kaynak acilmadi -- onaysiz programa trafik yok');

select * from finish();
rollback;
