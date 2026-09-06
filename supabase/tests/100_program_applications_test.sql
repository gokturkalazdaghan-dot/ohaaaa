-- ===========================================================================
-- 100 — başvuru motoru: geçiş kapısı, idempotency ve denetim izi
-- ===========================================================================
--
-- Bu dosyanın merkezindeki üç tehlike, hepsi SESSİZ olanlar:
--
--   1. Onaylı bir programın otomatik bir turla geri çekilmesi. O program
--      yeniden başvuru kuyruğuna girer, merchant bağı anlamsızlaşır ve
--      calisan gelir hatti kopar.
--   2. Aynı programa iki başvuru gitmesi. Ağ tarafında kötüye kullanım
--      sayılır; hesabın askıya alınmasına kadar gider.
--   3. Onay öncesi merchant kaydı üretilmesi. `merchants` kanıtlı kayıt
--      tablosudur; kanıtsız satır girerse o kuralın anlamı kalmaz.
begin;
select plan(22);

-- --- 1-3: şema ------------------------------------------------------------
select has_table('public', 'program_application_attempts', '1) denetim izi tablosu var');

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.program_application_attempts'::regclass
      and conname = 'program_application_attempts_key_unique'),
  1, '2) idempotency anahtari TEKIL -- yarisin ve tekrarin tek dayanagi');

select is(
  (select count(*)::int from unnest(enum_range(null::public.program_application_state))),
  10, '3) durum makinesi 10 durum tasiyor (UNAVAILABLE ve NOT_IMPLEMENTED dahil)');

-- --- Zemin ----------------------------------------------------------------
insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
values ('awin', 'BASVURU-1', 'Basvuru Testi', now());

-- --- 4-6: ONAY GERİ ALINAMAZ ----------------------------------------------
update public.programs set application_state = 'APPLIED' where network_program_id = 'BASVURU-1';
update public.programs set application_state = 'APPROVED' where network_program_id = 'BASVURU-1';

select throws_ok(
  $$ update public.programs set application_state = 'DISCOVERED'
      where network_program_id = 'BASVURU-1' $$,
  '23514', null,
  '4) APPROVED -> DISCOVERED REDDEDILIYOR -- calisan gelir hatti kopardi');

select throws_ok(
  $$ update public.programs set application_state = 'PENDING'
      where network_program_id = 'BASVURU-1' $$,
  '23514', null,
  '5) APPROVED -> PENDING REDDEDILIYOR -- onayli programa yeniden basvurulurdu');

select throws_ok(
  $$ update public.programs set application_state = 'APPLIED'
      where network_program_id = 'BASVURU-1' $$,
  '23514', null,
  '6) APPROVED -> APPLIED REDDEDILIYOR');

-- --- 7: kapı fazla kapatmamış: ağ onayı geri ALABİLİR ---------------------
select lives_ok(
  $$ update public.programs set application_state = 'REJECTED'
      where network_program_id = 'BASVURU-1' $$,
  '7) APPROVED -> REJECTED kabul ediliyor -- agin onayi geri almasi mumkun');

-- --- 8-9: geriye dönüş yok ------------------------------------------------
select throws_ok(
  $$ update public.programs set application_state = 'DISCOVERED'
      where network_program_id = 'BASVURU-1' $$,
  '23514', null,
  '8) REJECTED -> DISCOVERED REDDEDILIYOR -- gecmis silinirdi');

select lives_ok(
  $$ update public.programs set application_state = 'APPLICATION_READY'
      where network_program_id = 'BASVURU-1' $$,
  '9) REJECTED -> APPLICATION_READY kabul ediliyor -- ret kalici degil');

-- --- 10: ileri geçişler serbest -------------------------------------------
insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
values ('awin', 'BASVURU-2', 'Basvuru Testi 2', now());

select lives_ok(
  $$ update public.programs set application_state = 'UNAVAILABLE'
      where network_program_id = 'BASVURU-2' $$,
  '10) DISCOVERED -> UNAVAILABLE kabul ediliyor -- sozlesme dogrulanmamis');

-- --- 11: UNAVAILABLE ÇIKMAZ SOKAK DEĞİL -----------------------------------
-- Sözleşme yarın doğrulanabilir; bu durum programı sonsuza kadar
-- gömseydi, doğrulanan her sözleşme elle temizlik gerektirirdi.
select lives_ok(
  $$ update public.programs set application_state = 'APPLICATION_READY'
      where network_program_id = 'BASVURU-2' $$,
  '11) UNAVAILABLE -> APPLICATION_READY kabul ediliyor -- geri donus mumkun');

-- --- 12: DURUM DEĞİŞMEYEN GÜNCELLEME KAPIDAN GEÇMİYOR ---------------------
-- Puanlama ve keşif turları bu satırları güncelliyor. Kapı her UPDATE'te
-- calissaydi, ilgisiz her yazma basvuru mantigina takilirdi.
select lives_ok(
  $$ update public.programs
        set application_state = application_state, merchant_name = 'Yeni Ad'
      where network_program_id = 'BASVURU-2' $$,
  '12) durum degismeyen guncelleme serbest');

-- --- 13-14: merchant_id ONBOARDING'DEN ÖNCE DOLDURULAMAZ ------------------
insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
values ('awin', 'BASVURU-3', 'Basvuru Testi 3', now());

select throws_ok(
  format(
    $$ update public.programs set merchant_id = %L where network_program_id = 'BASVURU-3' $$,
    (select id from public.merchants order by slug limit 1)),
  '23514', null,
  '13) DISCOVERED programa merchant baglanamiyor -- kanitsiz magaza kaydi uretilirdi');

select lives_ok(
  format(
    $$ update public.programs set application_state = 'APPROVED' where network_program_id = 'BASVURU-3';
       update public.programs set merchant_id = %L where network_program_id = 'BASVURU-3' $$,
    (select id from public.merchants order by slug limit 1)),
  '14) ONAY sonrasi merchant baglanabiliyor -- kapatma fazla kapatmamis');

-- --- 15-16: İDEMPOTENCY ---------------------------------------------------
insert into public.program_application_attempts
  (program_id, network, network_program_id, idempotency_key, result)
select id, 'awin', 'BASVURU-1', 'apply:awin:BASVURU-1', 'SUBMITTED'
  from public.programs where network_program_id = 'BASVURU-1';

select throws_ok(
  $$ insert into public.program_application_attempts
       (network, network_program_id, idempotency_key, result)
     values ('awin', 'BASVURU-1', 'apply:awin:BASVURU-1', 'SUBMITTED') $$,
  '23505', null,
  '15) ayni anahtarla ikinci deneme REDDEDILIYOR -- aga iki basvuru giderdi');

-- Aynı program kimliği FARKLI ağda ayrı programdır: anahtarı ağ da taşır.
select lives_ok(
  $$ insert into public.program_application_attempts
       (network, network_program_id, idempotency_key, result)
     values ('direct', 'BASVURU-1', 'apply:direct:BASVURU-1', 'MANUAL_REQUIRED') $$,
  '16) ayni kimlik farkli agda ayri basvuru -- anahtar agi da tasiyor');

-- --- 17: DENETİM İZİ PROGRAM SİLİNSE DE KALIR ------------------------------
-- Yapilmis, geri alinamaz bir dis eylemin kaydi, konusunun silinmesiyle
-- kaybolmamali.
delete from public.programs where network_program_id = 'BASVURU-1';

select is(
  (select program_id is null from public.program_application_attempts
    where idempotency_key = 'apply:awin:BASVURU-1'),
  true, '17) program silindi ama denetim izi kaldi (program_id NULL oldu)');

select is(
  (select network || '/' || network_program_id from public.program_application_attempts
    where idempotency_key = 'apply:awin:BASVURU-1'),
  'awin/BASVURU-1', '18) ag kimligi izde KOPYA duruyor -- "kime basvurmustuk" cevaplanabiliyor');

-- --- 19-20: SIR SIZINTISI SON KAPIDA -------------------------------------
select throws_ok(
  $$ update public.program_application_attempts
        set message = 'hata: Authorization: Bearer ornek0123456789abcdef'
      where idempotency_key = 'apply:awin:BASVURU-1' $$,
  '23514', null,
  '19) kimlik bilgisi gorunumlu metin denetim izine YAZILAMIYOR');

select lives_ok(
  $$ update public.program_application_attempts
        set message = 'Awin basvuru sozlesmesi dogrulanmadi; istek gonderilmedi.'
      where idempotency_key = 'apply:awin:BASVURU-1' $$,
  '20) siradan hata mesaji yazilabiliyor -- kapatma fazla kapatmamis');

-- --- 21-22: TABLO İSTEMCİYE KAPALI, İZ SİLİNEMEZ --------------------------
select is(
  (select count(*)::int from (values ('anon'), ('authenticated')) as r(rol)
    where has_table_privilege(r.rol, 'public.program_application_attempts', 'select')),
  0, '21) anon ve authenticated denetim izini okuyamiyor');

-- Silinebilen bir denetim izi denetim izi değildir.
select ok(
  not has_table_privilege('service_role', 'public.program_application_attempts', 'delete'),
  '22) service_role denetim izini SILEMIYOR');

select * from finish();
rollback;
