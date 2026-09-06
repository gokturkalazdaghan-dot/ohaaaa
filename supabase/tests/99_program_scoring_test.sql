-- ===========================================================================
-- 99 — programs: puanlama sütunları, sınırlar ve DURUM KORUMASI
-- ===========================================================================
--
-- Bu dosyanın merkezindeki üç tehlike:
--
--   1. Puanın sıralamayı ele geçirmesi. Sınırsız ya da NULL/0 ayrımı
--      olmayan bir skor sütunu, tek bozuk satırla tüm sıralamayı bozar.
--   2. "Puanlanmadı" ile "0 aldı"nın karışması. Sessizdir: keşfedilmiş
--      ama henüz puanlanmamış her program en kötü görünür.
--   3. Puanlamanın onboarding durumunu ezmesi. En pahalısı bu: onaylı
--      bir programın `application_state`i ya da `merchant_id`si bir
--      puanlama turunda sıfırlanırsa gerçek gelir akışı kopar.
begin;
select plan(16);

-- --- 1-2: sütunlar ve nullable olmaları ----------------------------------
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'programs'
      and column_name in ('epc_cents','aov_cents','score','score_breakdown','scored_at')),
  5, '1) bes puanlama sutunu eklendi');

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'programs'
      and column_name in ('epc_cents','aov_cents','score','score_breakdown','scored_at')
      and is_nullable = 'NO'),
  0, '2) bes sutunun hicbiri NOT NULL degil -- puanlanmamis program bir deger UYDURMAK zorunda kalmaz');

-- --- Zemin: bir program kaydı --------------------------------------------
insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
values ('awin', 'PUAN-1', 'Puan Testi', now());

-- --- 3: PUANLANMAMIŞ PROGRAM NULL KALIR ----------------------------------
-- Varsayilan 0 olsaydi, hic puanlanmamis program "en kotu" olurdu.
select is(
  (select format('%s/%s/%s',
            coalesce(score::text, 'NULL'),
            coalesce(scored_at::text, 'NULL'),
            coalesce(score_breakdown::text, 'NULL'))
     from public.programs where network_program_id = 'PUAN-1'),
  'NULL/NULL/NULL',
  '3) yeni kesif puansiz -- 0 ile "puanlanmadi" ayri');

-- --- 4-5: SKOR SINIRLARI -------------------------------------------------
select throws_ok(
  $$ update public.programs
        set score = 100.01, scored_at = now(), score_breakdown = '{}'::jsonb
      where network_program_id = 'PUAN-1' $$,
  '23514', null,
  '4) 100 ustu skor reddediliyor -- siralamayi tek satir ele geciremez');

select throws_ok(
  $$ update public.programs
        set score = -0.01, scored_at = now(), score_breakdown = '{}'::jsonb
      where network_program_id = 'PUAN-1' $$,
  '23514', null,
  '5) negatif skor reddediliyor');

-- --- 6-7: SKOR YALNIZ BAŞINA YAZILAMAZ -----------------------------------
select throws_ok(
  $$ update public.programs set score = 50, scored_at = now()
      where network_program_id = 'PUAN-1' $$,
  '23514', null,
  '6) dokumsuz skor reddediliyor -- "neden 50 aldi" cevapsiz kalmaz');

select throws_ok(
  $$ update public.programs set score = 50, score_breakdown = '{}'::jsonb
      where network_program_id = 'PUAN-1' $$,
  '23514', null,
  '7) tarihsiz skor reddediliyor -- bayatligi olculemeyen skor');

-- --- 8: SINIRLAR FAZLA KAPATMAMIŞ ----------------------------------------
select lives_ok(
  $$ update public.programs
        set score = 65.10,
            scored_at = now(),
            score_breakdown = '{"commission":{"weight":25,"normalized":0.5}}'::jsonb
      where network_program_id = 'PUAN-1' $$,
  '8) gecerli skor + tarih + dokum birlikte yazilabiliyor');

select is(
  (select score from public.programs where network_program_id = 'PUAN-1'),
  65.10::numeric, '9) yazilan skor aynen okunuyor');

-- --- 10-11: DURUM KORUMASI ------------------------------------------------
-- Puanlama turu YALNIZCA score/scored_at/score_breakdown yazar. Bu testin
-- kanitladigi sey, o yazmanin onboarding durumunu YAN ETKIYLE bozmadigi:
-- trigger, default ya da kural araya girip application_state'i geri
-- almiyor.
update public.programs
   set application_state = 'APPROVED', merchant_id = null
 where network_program_id = 'PUAN-1';

update public.programs
   set score = 88.00,
       scored_at = now(),
       score_breakdown = '{"feed":{"weight":15,"normalized":1}}'::jsonb
 where network_program_id = 'PUAN-1';

select is(
  (select application_state::text from public.programs where network_program_id = 'PUAN-1'),
  'APPROVED', '10) puanlama application_state''i DEGISTIRMIYOR');

select is(
  (select score from public.programs where network_program_id = 'PUAN-1'),
  88.00::numeric, '11) ayni islemde skor guncellendi -- test bos gecmiyor');

-- merchant_id: onaylı bir programın gerçek gelir bağı. Puanlama bunu koparsa
-- deeplink ve dönüşüm hattı sessizce kopar. Bağ, seed'de zaten var olan
-- gerçek bir mağazaya kuruluyor -- test kendi mağazasını uydurmuyor.
update public.programs
   set merchant_id = (select id from public.merchants order by slug limit 1)
 where network_program_id = 'PUAN-1';

update public.programs
   set score = 12.34,
       scored_at = now(),
       score_breakdown = '{"epc":{"weight":20,"normalized":0}}'::jsonb
 where network_program_id = 'PUAN-1';

select is(
  (select p.merchant_id from public.programs p where p.network_program_id = 'PUAN-1'),
  (select id from public.merchants order by slug limit 1),
  '12) puanlama merchant_id bagini KOPARMIYOR');

-- --- 13: İDEMPOTENCY BOZULMADI -------------------------------------------
-- AŞAMA 2'nin (network, network_program_id) tekilligi puanlama sutunlari
-- eklendikten sonra da yerinde.
select throws_ok(
  $$ insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
     values ('awin', 'PUAN-1', 'Ayni Program', now()) $$,
  '23505', null,
  '13) (ag, program) tekilligi puanlama sonrasi da geciyor');

-- --- 14: GİRDİ SÜTUNLARI NEGATİF OLAMAZ ----------------------------------
select throws_ok(
  $$ update public.programs set epc_cents = -1 where network_program_id = 'PUAN-1' $$,
  '23514', null,
  '14) negatif EPC reddediliyor -- olcum hatasi sessizce puana girmez');

-- --- 15: SIRALAMA İNDEKSİ VAR --------------------------------------------
select ok(
  (select count(*) > 0 from pg_indexes
    where schemaname = 'public' and tablename = 'programs' and indexname = 'programs_score_idx'),
  '15) puana gore siralama indeksi var');

-- --- 16: PUANLAR İSTEMCİYE KAPALI ----------------------------------------
-- Skor is istihbaratidir: hangi programin bizim icin ne kadar degerli
-- oldugu rakibe acilacak bir sey degil.
select is(
  (select count(*)::int from (values ('anon'), ('authenticated')) as r(rol)
    where has_table_privilege(r.rol, 'public.programs', 'select')),
  0, '16) anon ve authenticated puanlari okuyamiyor');

select * from finish();
rollback;
