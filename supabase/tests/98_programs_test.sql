-- ===========================================================================
-- 98 — programs: keşif kaydı ve idempotency
-- ===========================================================================
--
-- Bu dosyanın merkezindeki iki tehlike:
--
--   1. Aynı programın her keşif turunda yeniden eklenmesi. Sessizdir:
--      hata yok, tablo büyür, puanlama aynı programı defalarca sayar.
--   2. Bilinmeyen alanın bir DEĞER gibi kaydedilmesi (0 komisyon, boş
--      metin). O da sessizdir ve puanlamaya yanlış girdi olur.
begin;
select plan(14);

-- --- 1-2: tablo ve idempotency dayanağı ----------------------------------
select has_table('public', 'programs', '1) programs tablosu var');

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.programs'::regclass
      and conname = 'programs_network_program_unique'),
  1, '2) (network, network_program_id) tekil -- kesfin idempotency dayanagi');

-- --- 3: BİLİNMEYEN ALANLAR NULL KALABİLİYOR ------------------------------
-- Ağ katalogları komisyonu, ürün sayısını, feed durumunu çoğu zaman
-- vermez. NOT NULL olsalardı keşif bir değer UYDURMAK zorunda kalırdı.
select lives_ok(
  $$ insert into public.programs
       (network, network_program_id, merchant_name, last_verified_at)
     values ('awin', 'TEST-1', 'Test Program', now()) $$,
  '3) yalnizca ag + kimlik + ad ile kayit acilabiliyor');

select is(
  (select format('%s/%s/%s/%s',
            coalesce(commission_rate::text, 'NULL'),
            coalesce(cookie_window_days::text, 'NULL'),
            coalesce(feed_available::text, 'NULL'),
            coalesce(product_count::text, 'NULL'))
     from public.programs where network_program_id = 'TEST-1'),
  'NULL/NULL/NULL/NULL',
  '4) bildirilmeyen alanlar NULL -- 0 ya da bos metin UYDURULMUYOR');

-- --- 5: varsayılan durum -------------------------------------------------
select is(
  (select application_state::text from public.programs where network_program_id = 'TEST-1'),
  'DISCOVERED', '5) yeni kesif DISCOVERED durumunda basliyor');

-- --- 6: AYNI PROGRAM İKİNCİ KEZ EKLENEMEZ --------------------------------
select throws_ok(
  $$ insert into public.programs
       (network, network_program_id, merchant_name, last_verified_at)
     values ('awin', 'TEST-1', 'Ayni Program Tekrar', now()) $$,
  '23505', null,
  '6) ayni (ag, program) ikinci kez eklenemiyor');

-- --- 7-8: UPSERT GÜNCELLER, first_seen_at KORUNUR ------------------------
-- `first_seen_at` her turda güncellenseydi "bu programı ne zamandır
-- taniyoruz" bilgisi sifirlanir ve bayat program tespiti anlamsizlasirdi.
select lives_ok(
  $$ insert into public.programs
       (network, network_program_id, merchant_name, last_verified_at, commission_rate)
     values ('awin', 'TEST-1', 'Guncellenmis Ad', now(), 0.1000)
     on conflict (network, network_program_id) do update
       set merchant_name = excluded.merchant_name,
           commission_rate = excluded.commission_rate,
           last_verified_at = excluded.last_verified_at $$,
  '7) upsert ikinci turda guncelleme yapiyor');

select is(
  (select count(*)::int from public.programs where network_program_id = 'TEST-1'),
  1, '8) upsert sonrasi hala TEK satir -- duplicate uretilmedi');

-- --- 9: komisyon 0 GEÇERLİ bir orandır -----------------------------------
-- 0 ile NULL ayni hucreye yazilamaz: biri "komisyonsuz program", digeri
-- "ag yayinlamamis".
select lives_ok(
  $$ insert into public.programs
       (network, network_program_id, merchant_name, last_verified_at, commission_rate)
     values ('awin', 'TEST-ZERO', 'Komisyonsuz', now(), 0) $$,
  '9) komisyon 0 kabul ediliyor -- NULL ile ayni sey degil');

-- --- 10: uydurma oran reddediliyor ---------------------------------------
select throws_ok(
  $$ insert into public.programs
       (network, network_program_id, merchant_name, last_verified_at, commission_rate)
     values ('awin', 'TEST-BAD', 'Gecersiz Oran', now(), 5.0) $$,
  '23514', null,
  '10) %500 komisyon reddediliyor');

-- --- 11: bilinmeyen ağ reddediliyor --------------------------------------
-- Kod tarafindaki registry ile DB kisiti ayni kumeyi tanimali; ayrisirsa
-- kesfedilen program hicbir saglayiciyla eslesmez.
select throws_ok(
  $$ insert into public.programs
       (network, network_program_id, merchant_name, last_verified_at)
     values ('cj', 'X', 'Bilinmeyen Ag', now()) $$,
  '23514', null,
  '11) kayitli olmayan ag reddediliyor');

-- --- 12: boş program kimliği reddediliyor --------------------------------
select throws_ok(
  $$ insert into public.programs
       (network, network_program_id, merchant_name, last_verified_at)
     values ('awin', '   ', 'Bos Kimlik', now()) $$,
  '23514', null,
  '12) bos program kimligi reddediliyor -- idempotency anahtarinin yarisi');

-- --- 13-14: TABLO İSTEMCİYE KAPALI ---------------------------------------
-- `programs` is istihbaratidir: hangi aglarda ne var, hangi komisyonlar,
-- hangi basvurular beklemede. Vitrine acilacak bir sey degil.
select is(
  (select count(*)::int from (values ('anon'), ('authenticated')) as r(rol)
    where has_table_privilege(r.rol, 'public.programs', 'select')),
  0, '13) anon ve authenticated programs okuyamiyor');

select ok(
  has_table_privilege('service_role', 'public.programs', 'select'),
  '14) service_role okuyabiliyor -- kapatma fazla kapatmamis');

select * from finish();
rollback;
