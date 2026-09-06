-- ===========================================================================
-- 103 — ağ kaydı: yeni ağ bir SATIR, kanıtsız doğrulama yok
-- ===========================================================================
--
-- Bu dosyanın merkezindeki iki tehlike:
--
--   1. Ağ listesinin dört ayrı CHECK kısıtında sabit yazılı olması. Onuncu
--      ağ eklenirken biri unutulursa sonuç sessizdir ve yalnız o yolda
--      ortaya çıkar: keşif programı yazar, başvuru motoru denetim satırını
--      yazamaz -- gerçekten yapılmış bir dış eylem kayıtsız kalır.
--   2. Kanıtsız "doğrulandı". Bir hatıraya dayanan doğrulama, var olmayan
--      bir uç noktaya gerçek istek göndermek demektir.
begin;
select plan(12);

select has_table('public', 'affiliate_networks', '1) ag kaydi tablosu var');

select is((select count(*)::int from public.affiliate_networks), 11,
  '2) on bir ag taniniyor');

-- --- 3-4: YALNIZ IC SOZLESME DOGRULANMIS ----------------------------------
-- awin in deeplink i calisiyor ama API sozlesmesi dogrulanmadi; ikisini
-- karistirmak, dogrulanmamis bir uc noktaya gercek istek gondermek olurdu.
select is(
  (select string_agg(code, ',' order by code) from public.affiliate_networks where contract_verified),
  'direct', '3) yalnizca direct dogrulanmis -- digerlerinin sozlesmesi gorulmedi');

select is(
  (select contract_verified from public.affiliate_networks where code = 'awin'),
  false, '4) awin API sozlesmesi DOGRULANMADI -- deeplink calismasi bunu degistirmez');

-- --- 5-6: KANIT KURALI -----------------------------------------------------
select throws_ok(
  $$ update public.affiliate_networks set contract_verified = true where code = 'cj' $$,
  '23514', null,
  '5) kanitsiz dogrulama REDDEDILIYOR -- var olmayan uc noktaya istek giderdi');

select lives_ok(
  $$ update public.affiliate_networks
        set contract_verified = true, docs_url = 'https://ornek.example/docs', verified_at = now()
      where code = 'cj' $$,
  '6) https kanit + tarih ile dogrulama serbest -- kapatma fazla kapatmamis');

-- --- 7: IC AG DIS DOKUMAN TASIYAMAZ ---------------------------------------
select throws_ok(
  $$ update public.affiliate_networks set docs_url = 'https://ornek.example/x' where code = 'direct' $$,
  '23514', null,
  '7) ic ag dis dokuman tasiyamiyor -- sozlesmeyi biz tanimliyoruz');

-- --- 8-10: SABİT LİSTE YERİNE YABANCI ANAHTAR ------------------------------
select throws_ok(
  $$ insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
     values ('bilinmeyen-ag', 'AG-1', 'Bilinmeyen', now()) $$,
  '23503', null,
  '8) taninmayan ag hala REDDEDILIYOR -- FK, CHECK in yerini aldi');

select lives_ok(
  $$ insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
     values ('cj', 'AG-2', 'CJ Test', now()) $$,
  '9) YENI ag artik bir SATIR -- goc gerekmiyor');

select lives_ok(
  $$ insert into public.program_application_attempts
       (network, network_program_id, idempotency_key, result)
     values ('tradedoubler', 'AG-3', 'apply:tradedoubler:AG-3', 'UNAVAILABLE') $$,
  '10) denetim izi de ayni listeden besleniyor -- dort kisit tek kaynaga indi');

-- --- 11: KULLANIMDA OLAN AĞ SİLİNEMİYOR ------------------------------------
select throws_ok(
  $$ delete from public.affiliate_networks where code = 'cj' $$,
  '23503', null,
  '11) kullanimda olan ag silinemiyor -- FK koruyor');

-- --- 12: TABLO YAZMAYA KAPALI ---------------------------------------------
-- Bir ag satiri eklemek, o aga trafik gonderilebilir hale getirmektir.
select is(
  (select count(*)::int from (values ('anon'), ('authenticated')) as r(rol)
    where has_table_privilege(r.rol, 'public.affiliate_networks', 'insert')
       or has_table_privilege(r.rol, 'public.affiliate_networks', 'update')),
  0, '12) istemci roller ag ekleyemiyor/degistiremiyor');

select * from finish();
rollback;
