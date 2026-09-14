-- ===========================================================================
-- ÇOK AĞLI ORTAKLIK: ağ referansı, program adayları, denetim izi
-- ===========================================================================
begin;
select plan(16);

-- --- A) AĞ REFERANSI ------------------------------------------------------

select has_table('public', 'affiliate_networks', '1) affiliate_networks tablosu var');

select is(
  (select count(*) from public.affiliate_networks where code in ('direct','awin')),
  2::bigint,
  '2) direct ve awin tohumlandi'
);

select is(
  (select is_direct from public.affiliate_networks where code = 'direct'),
  true,
  '3) direct AG DEGIL, agin yoklugu olarak isaretli'
);

/*
 * ASIL KAZANIM: yeni ag eklemek GOC degil SATIR.
 * Bu iddia duserse cok agli mimari geri kaymis demektir.
 */
select lives_ok(
  $$ insert into public.affiliate_networks (code, display_name, portal_url)
     values ('cj', 'CJ Affiliate', 'https://members.cj.com/') $$,
  '4) YENI AG eklemek tek satir -- goc gerekmiyor'
);

select lives_ok(
  $$ update public.merchants set network = 'cj'
      where slug = (select slug from public.merchants limit 1) $$,
  '5) magaza yeni aga tasinabiliyor'
);

-- Bilinmeyen ag HALA reddediliyor: koruma zayiflamadi.
select throws_ok(
  $$ insert into public.affiliate_networks (code, display_name) values ('BUYUK', 'Gecersiz') $$,
  '23514',
  null,
  '6) ag kodu bicim kisitina uymali (kucuk harf)'
);

select throws_matching(
  $$ update public.merchants set network = 'yokboyle-ag'
      where slug = (select slug from public.merchants limit 1) $$,
  'merchants_network_fkey',
  '7) taninmayan ag REDDEDILIYOR -- yabanci anahtar tutuyor'
);

-- --- B) PROGRAM ADAYLARI --------------------------------------------------

select has_table('public', 'affiliate_programs', '8) affiliate_programs tablosu var');

select lives_ok(
  $$ insert into public.affiliate_programs
       (network_code, external_id, advertiser_name, market_codes)
     values ('awin', 'A-1001', 'Ornek Magaza', array['TR','UK']) $$,
  '9) program adayi kaydedilebiliyor'
);

/*
 * YINELENME ENGELLEME VERITABANINDA, uygulamada degil. Ayni programin
 * ikinci kez kesfedilmesi satir degil CAKISMA uretmeli.
 */
select throws_ok(
  $$ insert into public.affiliate_programs
       (network_code, external_id, advertiser_name)
     values ('awin', 'A-1001', 'Ayni Program Tekrar') $$,
  '23505',
  null,
  '10) AYNI ag+kimlik ikinci kez yazilamaz (duplicate engeli)'
);

select is(
  (select state::text from public.affiliate_programs where external_id = 'A-1001'),
  'discovered',
  '11) yeni program DISCOVERED baslar -- tahmin yok'
);

select is(
  (select merchant_id from public.affiliate_programs where external_id = 'A-1001'),
  null,
  '12) aday ONAY ONCESI merchant ile baglanmaz'
);

-- Komisyon sinirlari: uydurma oran giremez.
select throws_ok(
  $$ update public.affiliate_programs set commission_rate = 1.5
      where external_id = 'A-1001' $$,
  '23514',
  null,
  '13) gercekci olmayan komisyon orani REDDEDILIYOR'
);

-- --- C) DENETİM İZİ -------------------------------------------------------

select has_table('public', 'affiliate_program_events', '14) denetim izi tablosu var');

select lives_ok(
  $$ insert into public.affiliate_program_events
       (program_id, action, previous_state, new_state, actor, result, reason)
     select id, 'qualify', 'discovered', 'qualifying', 'agent', 'ok', 'otomatik'
       from public.affiliate_programs where external_id = 'A-1001' $$,
  '15) ajan karari denetim izine yazilabiliyor'
);

/*
 * AKTOR YALNIZCA agent VEYA human OLABILIR. Bu ayrim denetimin kendisi:
 * hukuki/finansal adimlarin otomatik OLMADIGINI burada kanitlariz.
 */
select throws_ok(
  $$ insert into public.affiliate_program_events
       (program_id, action, actor, result)
     select id, 'x', 'robot', 'ok' from public.affiliate_programs limit 1 $$,
  '23514',
  null,
  '16) taninmayan aktor REDDEDILIYOR -- agent/human ayrimi korunuyor'
);

select * from finish();
rollback;
