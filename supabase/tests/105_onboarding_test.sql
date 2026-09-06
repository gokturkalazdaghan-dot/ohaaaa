-- ===========================================================================
-- 105 — otomatik onboarding: onay şartı, kanıt kapısı, idempotency
-- ===========================================================================
--
-- Merkezdeki tehlike: onayı bir mağaza kaydı açmak için yeterli saymak.
-- Ana sayfası bilinmeyen bir mağaza için deeplink üretilemez; çerez
-- penceresi bilinmeyen bir program için dönüşüm ilişkilendirilemez. İkisi
-- de GERÇEK TRAFİKTE patlar.
begin;
select plan(14);

-- --- Zemin: kanıtı TAM, henüz onaysız program -----------------------------
insert into public.programs (
  network, network_program_id, merchant_name, homepage_url, country_code,
  commission_rate, cookie_window_days, terms, last_verified_at
) values (
  'awin', '910000001', 'Onboarding Testi', 'https://onb-test.example', 'US',
  0.1000, 30, 'Standart sartlar.', now()
);

-- --- 1-2: ONAY ŞART -------------------------------------------------------
select is(
  (select refusal::text from public.onboard_approved_program(
     (select id from public.programs where network_program_id = '910000001'))),
  'not_approved', '1) onaysiz program DEVREDILMIYOR');

select is(
  (select count(*)::int from public.merchants where slug like 'awin-910000001%'),
  0, '2) onaysiz programa magaza ACILMIYOR');

update public.programs set application_state = 'APPROVED' where network_program_id = '910000001';

-- --- 3-5: DEVİR ------------------------------------------------------------
select ok(
  (select merchant_id is not null from public.onboard_approved_program(
     (select id from public.programs where network_program_id = '910000001'))),
  '3) kaniti tam onayli program devrediliyor');

select is(
  (select m.status::text from public.merchants m
     join public.programs p on p.merchant_id = m.id
    where p.network_program_id = '910000001'),
  'prospect',
  '4) magaza PROSPECT aciliyor -- aktiflestirme AYRI bir karar');

select is(
  (select count(*)::int from public.merchant_network_links
    where network = 'awin' and network_program_id = '910000001'),
  1, '5) ag bagi kuruldu ve TEKIL');

-- --- 6-7: İDEMPOTENCY ------------------------------------------------------
select is(
  (select created from public.onboard_approved_program(
     (select id from public.programs where network_program_id = '910000001'))),
  false, '6) ikinci devir YENI magaza ACMIYOR');

select is(
  (select count(*)::int from public.merchants where slug like 'awin-910000001%'),
  1, '7) tek magaza kaldi -- iki deeplink ve iki gelir kalemi olusmadi');

-- --- 8-12: EKSİK KANIT FAIL-CLOSED, GEREKÇE AYRIŞIK -----------------------
-- Tek bir "basarisiz" degeri, eksik ana sayfa ile onaysiz programi ayni
-- kefeye koyar ve operator ne yapacagini bilemez.
insert into public.programs (
  network, network_program_id, merchant_name, country_code,
  commission_rate, cookie_window_days, terms, last_verified_at, application_state
) values ('awin', '910000002', 'Ana Sayfasiz', 'US', 0.10, 30, 'S.', now(), 'APPROVED');

select is(
  (select refusal::text from public.onboard_approved_program(
     (select id from public.programs where network_program_id = '910000002'))),
  'missing_homepage', '8) ana sayfa eksik -> missing_homepage');

insert into public.programs (
  network, network_program_id, merchant_name, homepage_url,
  commission_rate, cookie_window_days, terms, last_verified_at, application_state
) values ('awin', '910000003', 'Ulkesiz', 'https://x.example', 0.10, 30, 'S.', now(), 'APPROVED');

select is(
  (select refusal::text from public.onboard_approved_program(
     (select id from public.programs where network_program_id = '910000003'))),
  'missing_country', '9) ulke eksik -> missing_country');

insert into public.programs (
  network, network_program_id, merchant_name, homepage_url, country_code,
  cookie_window_days, terms, last_verified_at, application_state
) values ('awin', '910000004', 'Komisyonsuz', 'https://x.example', 'US', 30, 'S.', now(), 'APPROVED');

select is(
  (select refusal::text from public.onboard_approved_program(
     (select id from public.programs where network_program_id = '910000004'))),
  'missing_commission', '10) komisyon BILINMIYOR -> missing_commission');

insert into public.programs (
  network, network_program_id, merchant_name, homepage_url, country_code,
  commission_rate, terms, last_verified_at, application_state
) values ('awin', '910000005', 'Cerezsiz', 'https://x.example', 'US', 0.10, 'S.', now(), 'APPROVED');

select is(
  (select refusal::text from public.onboard_approved_program(
     (select id from public.programs where network_program_id = '910000005'))),
  'missing_cookie_window', '11) cerez penceresi eksik -> donusum iliskilendirilemezdi');

insert into public.programs (
  network, network_program_id, merchant_name, homepage_url, country_code,
  commission_rate, cookie_window_days, last_verified_at, application_state
) values ('awin', '910000006', 'Sartsiz', 'https://x.example', 'US', 0.10, 30, now(), 'APPROVED');

select is(
  (select refusal::text from public.onboard_approved_program(
     (select id from public.programs where network_program_id = '910000006'))),
  'missing_terms', '12) sartlar dogrulanmamis -> missing_terms');

-- --- 13: EKSİK KANITLI PROGRAMA MERCHANT BAĞLANMIYOR ----------------------
select is(
  (select count(*)::int from public.programs
    where network_program_id in ('910000002','910000003','910000004','910000005','910000006')
      and merchant_id is not null),
  0, '13) eksik kanitli hicbir programa merchant baglanmadi');

-- --- 14: SLUG ADDAN DEĞİL KİMLİKTEN TÜRÜYOR -------------------------------
-- Iki agdaki iki program ayni adi tasiyabilir ("Nike", "Nike US") ve ad
-- tabanli bir slug ikisini ayni satira cokertirdi.
select isnt(
  public.program_merchant_slug('awin', '12345'),
  public.program_merchant_slug('cj', '12345'),
  '14) ayni kimlik farkli agda AYRI slug');

select * from finish();
rollback;
