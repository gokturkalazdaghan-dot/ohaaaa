-- D1 + D2: atif butunlugu ve donusum durum korumalari.
--
-- Bu dosyanin varlik sebebi: iki acik da PARA yolundaydi ve ikisi de
-- "gorunurde calisan" kod tarafindan gizleniyordu. Testler tek tek negatif
-- senaryolari kanitlar -- pozitif akis zaten calisiyordu.
begin;
select plan(20);

-- --- Zemin ----------------------------------------------------------------
insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template,
   country_code, cookie_window_days)
values
  ('atif-a', 'Atif A', 'https://a.gecersiz', 'direct', 'active',
   'https://a.gecersiz/g?u={url}', 'TR', 30),
  ('atif-b', 'Atif B', 'https://b.gecersiz', 'direct', 'active',
   'https://b.gecersiz/g?u={url}', 'TR', 30),
  ('atif-dar', 'Atif Dar Pencere', 'https://d.gecersiz', 'direct', 'active',
   'https://d.gecersiz/g?u={url}', 'TR', 1);

-- Tiklamalar dogrudan ekleniyor: record_click'in kendi testi ayri dosyada.
insert into public.clicks (subid, merchant_id, created_at)
select 'clickA00000000000000000', id, now() - interval '2 days'
  from public.merchants where slug = 'atif-a';

insert into public.clicks (subid, merchant_id, created_at)
select 'clickDAR0000000000000000', id, now() - interval '10 days'
  from public.merchants where slug = 'atif-dar';

-- ===========================================================================
-- GECIS TABLOSU -- saf fonksiyon, 8 kombinasyon dogrudan
-- ===========================================================================
select ok(public.conversion_transition_allowed('pending','approved'),
  '1) pending -> approved izinli');
select ok(public.conversion_transition_allowed('pending','rejected'),
  '2) pending -> rejected izinli');
select ok(public.conversion_transition_allowed('approved','paid'),
  '3) approved -> paid izinli');
select ok(public.conversion_transition_allowed('approved','approved'),
  '4) ayni duruma tekrar bildirim izinli (idempotent)');

select ok(not public.conversion_transition_allowed('approved','rejected'),
  '5) approved -> rejected ENGELLI (kesinlesmis onay geri alinamaz)');
select ok(not public.conversion_transition_allowed('approved','pending'),
  '6) approved -> pending ENGELLI');
select ok(not public.conversion_transition_allowed('rejected','approved'),
  '7) rejected -> approved ENGELLI (rejected terminal)');
select ok(not public.conversion_transition_allowed('paid','pending'),
  '8) paid -> pending ENGELLI (paid terminal)');

-- ===========================================================================
-- D1 -- ATIF
-- ===========================================================================

-- 9) Ayni magaza, pencere icinde -> atif kurulur.
select public.record_conversion(
  (select id from public.merchants where slug = 'atif-a'),
  'SIP-ICERDE', 'clickA00000000000000000', 'pending', 100000, 3000, 'TRY', now(),
  '{}'::jsonb);

select isnt(
  (select click_id from public.conversions where network_order_id = 'SIP-ICERDE'),
  null,
  '9) ayni magaza + pencere ici tiklama ATFEDILIR'
);

-- 10) Pencere DISI -> kayit olusur ama atif kurulmaz.
--     Ciro gercektir; o tiklamadan geldigi iddiasi degildir.
select public.record_conversion(
  (select id from public.merchants where slug = 'atif-dar'),
  'SIP-ESKI', 'clickDAR0000000000000000', 'pending', 50000, 1500, 'TRY', now(),
  '{}'::jsonb);

select is(
  (select click_id from public.conversions where network_order_id = 'SIP-ESKI'),
  null,
  '10) pencere DISINDAKI tiklamaya atif kurulmaz (kayit yine tutulur)'
);

select is(
  (select count(*) from public.conversions where network_order_id = 'SIP-ESKI'),
  1::bigint,
  '11) pencere disi olsa da ciro kaydi silinmez'
);

-- 12) CAPRAZ MAGAZA -- B, A'nin subid'siyle bildirim gonderiyor.
select throws_ok(
  format(
    'select public.record_conversion(%L::uuid, %L, %L, %L::public.conversion_status, 1, 1)',
    (select id from public.merchants where slug = 'atif-b'),
    'SIP-CAPRAZ', 'clickA00000000000000000', 'approved'
  ),
  'OH409',
  null,
  '12) Magaza A tiklamasi + Magaza B postback -> REDDEDILIR'
);

select is(
  (select count(*) from public.conversions where network_order_id = 'SIP-CAPRAZ'),
  0::bigint,
  '13) capraz magaza denemesinde donusum HIC olusmaz'
);

-- ===========================================================================
-- D2 -- DURUM / REPLAY
-- ===========================================================================

-- 14) Ilk kayitta status_changed_at bos: dogus bir DEGISIM degildir.
select is(
  (select status_changed_at from public.conversions where network_order_id = 'SIP-ICERDE'),
  null,
  '14) ilk kayitta status_changed_at bos kalir'
);

-- pending -> approved (ileri yon, izinli)
select public.record_conversion(
  (select id from public.merchants where slug = 'atif-a'),
  'SIP-ICERDE', 'clickA00000000000000000', 'approved', 100000, 3500, 'TRY',
  now() + interval '1 hour', '{}'::jsonb);

select is(
  (select status::text from public.conversions where network_order_id = 'SIP-ICERDE'),
  'approved',
  '15) pending -> approved uygulanir'
);

select isnt(
  (select status_changed_at from public.conversions where network_order_id = 'SIP-ICERDE'),
  null,
  '16) gercek durum degisiminde status_changed_at damgalanir'
);

-- 17) REPLAY: approved -> rejected geriye donus. Durum DEGISMEMELI.
select public.record_conversion(
  (select id from public.merchants where slug = 'atif-a'),
  'SIP-ICERDE', 'clickA00000000000000000', 'rejected', 100000, 0, 'TRY',
  now() + interval '2 hours', '{}'::jsonb);

select is(
  (select status::text from public.conversions where network_order_id = 'SIP-ICERDE'),
  'approved',
  '17) approved -> rejected replay durumu GERI CEVIREMEZ'
);

-- 18) Ayni replay finansal alani da bozmamali (komisyon 3500 kalmali).
select is(
  (select commission_cents from public.conversions where network_order_id = 'SIP-ICERDE'),
  3500::bigint,
  '18) engellenen gecis komisyonu da degistiremez'
);

-- ===========================================================================
-- merchants.network -- DB kisiti kod tarafindaki kayitla ayni olmali
-- ===========================================================================

-- DIKKAT: iki kisit da 23514 dondurur (merchants_active_needs_template ve
-- merchants_network_known). Yalnizca SQLSTATE'e bakan bir iddia YANLIS SEBEPLE
-- gecebilir. Bu yuzden satir her acidan gecerli tutuluyor ve kisit ADI da
-- dogrulaniyor.
select throws_matching(
  $$insert into public.merchants
      (slug, display_name, homepage_url, network, status, country_code,
       deeplink_template)
    values ('ag-bilinmeyen', 'Bilinmeyen Ag', 'https://x.gecersiz',
            'uydurma-ag', 'active', 'TR', 'https://x.gecersiz/g?u={url}')$$,
  'merchants_network_known',
  '19) taninmayan network degeri veritabanina YAZILAMAZ (dogru kisit adiyla)'
);

select lives_ok(
  $$insert into public.merchants
      (slug, display_name, homepage_url, network, status, country_code,
       deeplink_template)
    values ('ag-awin', 'Awin Magaza', 'https://w.gecersiz',
            'awin', 'active', 'TR', 'https://w.gecersiz/g?u={url}')$$,
  '20) kayitli ag (awin) kabul edilir'
);

select * from finish();
rollback;
