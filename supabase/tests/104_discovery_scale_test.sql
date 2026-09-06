-- ===========================================================================
-- 104 — keşif ölçeği: tur denetimi, imleç, bayatlık, puanlama sırası
-- ===========================================================================
--
-- Merkezdeki tehlike: "ne oldu?" sorusunun cevapsız kalması. Keşif turu
-- sonucu yalnız bellekte dönerse, bir ağ sessizce boşaldığında geriye
-- HİÇBİR İZ kalmaz -- alım hattının aylarca hiç çalışmadığının fark
-- edilmemesiyle aynı hata.
begin;
select plan(16);

select has_table('public', 'program_discovery_runs', '1) tur denetim izi tablosu var');

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.program_discovery_runs'::regclass
      and conname = 'program_discovery_runs_key_unique'),
  1, '2) tur anahtari TEKIL -- iki zamanlayici ayni anda ayni aga gidemez');

-- --- 3-4: TUR İDEMPOTENCY -------------------------------------------------
insert into public.program_discovery_runs (network, idempotency_key, status)
values ('awin', 'discover:awin:bas:2026-09-07T12', 'running');

select throws_ok(
  $$ insert into public.program_discovery_runs (network, idempotency_key, status)
     values ('awin', 'discover:awin:bas:2026-09-07T12', 'running') $$,
  '23505', null,
  '3) ayni tur ikinci kez kaydedilemiyor');

select lives_ok(
  $$ insert into public.program_discovery_runs (network, idempotency_key, status)
     values ('cj', 'discover:cj:bas:2026-09-07T12', 'unavailable') $$,
  '4) farkli ag ayri tur -- anahtar agi tasiyor');

-- --- 5-6: SAYAÇLAR BİRBİRİNİ DENETLİYOR -----------------------------------
select throws_ok(
  $$ update public.program_discovery_runs set programs_seen = 5, programs_written = 9
      where idempotency_key = 'discover:awin:bas:2026-09-07T12' $$,
  '23514', null,
  '5) gorulenden fazla program yazildigi iddia edilemiyor');

select throws_ok(
  $$ update public.program_discovery_runs
        set programs_seen = 10, programs_written = 5, first_seen_count = 8
      where idempotency_key = 'discover:awin:bas:2026-09-07T12' $$,
  '23514', null,
  '6) yazilandan fazla "ilk kez goruldu" iddia edilemiyor');

select lives_ok(
  $$ update public.program_discovery_runs
        set status = 'completed', programs_seen = 10, programs_written = 8,
            first_seen_count = 3, malformed_dropped = 2, pages_fetched = 4,
            finished_at = now()
      where idempotency_key = 'discover:awin:bas:2026-09-07T12' $$,
  '7) tutarli sayaclar yazilabiliyor -- kapatma fazla kapatmamis');

-- --- 8: SIR SIZINTISI SON KAPIDA ------------------------------------------
select throws_ok(
  $$ update public.program_discovery_runs set message = 'x-api-key: gizli-deger-123'
      where idempotency_key = 'discover:awin:bas:2026-09-07T12' $$,
  '23514', null,
  '8) kimlik bilgisi gorunumlu metin denetim izine yazilamiyor');

-- --- 9-10: AĞ İMLECİ ------------------------------------------------------
select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='affiliate_networks'
      and column_name in ('discovery_cursor','discovery_checked_at','discovery_page_limit')),
  3, '9) ag imleci ve tarama sirasi sutunlari var');

select is(
  (select discovery_cursor from public.affiliate_networks where code = 'awin'),
  null, '10) imlec NULL basliyor -- bastan taranacak');

-- --- 11-13: BAYATLIK ------------------------------------------------------
insert into public.programs
  (network, network_program_id, merchant_name, first_seen_at, last_verified_at)
values ('awin', 'BAYAT-1', 'Bayat', now() - interval '90 days', now() - interval '60 days');

select is(
  (select count(*)::int from public.stale_programs(30) where network_program_id = 'BAYAT-1'),
  1, '11) 60 gundur gorulmeyen program BAYAT');

select is(
  (select count(*)::int from public.stale_programs(90) where network_program_id = 'BAYAT-1'),
  0, '12) esik yukselince bayat degil -- esik gercekten uygulaniyor');

-- ONAYLI program bayat sayilmaz: onay disarida gerceklesmis bir olaydir ve
-- kesif listesinden dusmesi onu gecersiz kilmaz.
update public.programs set application_state = 'APPROVED' where network_program_id = 'BAYAT-1';
select is(
  (select count(*)::int from public.stale_programs(30) where network_program_id = 'BAYAT-1'),
  0, '13) ONAYLI program bayat sayilmiyor -- calisan gelir bagi korunuyor');

-- --- 14-16: PUANLAMA SIRASI -----------------------------------------------
select is(
  (select count(*)::int from public.programs_due_for_scoring(100)
    where network_program_id = 'BAYAT-1'),
  1, '14) puanlanmamis program sirada');

update public.programs
   set score = 50, scored_at = now(), score_breakdown = '{}'::jsonb
 where network_program_id = 'BAYAT-1';

select is(
  (select count(*)::int from public.programs_due_for_scoring(100)
    where network_program_id = 'BAYAT-1'),
  0, '15) taze puanli program sirada degil');

-- Kesif programi guncelledi: eski puan BAYATLADI. Ayri bir needs_scoring
-- sutunu, kodun guncellemeyi unuttugu ilk yerde yalan soylerdi.
update public.programs
   set last_verified_at = now() + interval '1 second'
 where network_program_id = 'BAYAT-1';

select is(
  (select count(*)::int from public.programs_due_for_scoring(100)
    where network_program_id = 'BAYAT-1'),
  1, '16) kesif guncelleyince puan bayatliyor ve program yine sirada');

select * from finish();
rollback;
