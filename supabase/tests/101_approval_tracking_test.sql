-- ===========================================================================
-- 101 — onay takibi: yoklama sütunları, sıra indeksi ve sınırlar
-- ===========================================================================
--
-- Bu dosyanın merkezindeki tehlike: yoklamanın onboarding sanılması.
--
-- Ağın "onaylandı" demesi bir mağaza kaydı açmak için yeterli değildir.
-- Yoklama turu yalnızca durumu ve yoklama anını yazar; `merchant_id`ye
-- dokunmaz ve dokunamaz. Bunu kanıtlamak, bu dosyanın asıl işi.
begin;
select plan(14);

-- --- 1-3: şema ------------------------------------------------------------
select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='programs'
      and column_name in ('network_application_id','approval_checked_at')),
  2, '1) iki onay takip sutunu eklendi');

select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='programs'
      and column_name in ('network_application_id','approval_checked_at')
      and is_nullable='NO'),
  0, '2) ikisi de nullable -- hic yoklanmamis program bir deger UYDURMAK zorunda degil');

select has_column('public', 'program_application_attempts', 'network_application_id',
  '3) denetim izi de basvuru kimligini tasiyor -- program silinse de kalir');

-- --- Zemin ----------------------------------------------------------------
insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
values ('awin', 'ONAY-1', 'Onay Testi', now());

-- --- 4-5: boş kimlik bir DEĞER gibi davranır ------------------------------
select throws_ok(
  $$ update public.programs set network_application_id = '   '
      where network_program_id = 'ONAY-1' $$,
  '23514', null,
  '4) bos basvuru kimligi reddediliyor -- aga anlamsiz istek giderdi');

select lives_ok(
  $$ update public.programs
        set network_application_id = 'AG-BASVURU-9', approval_checked_at = now()
      where network_program_id = 'ONAY-1' $$,
  '5) gercek kimlik ve yoklama ani yazilabiliyor');

-- --- 6: YOKLAMA DURUM DEĞİŞTİRMİYOR ---------------------------------------
-- Yoklama sütunlarına yazmak geçiş kapısını hiç çalıştırmamalı; aksi hâlde
-- her yoklama turu başvuru mantığına takılırdı.
select is(
  (select application_state::text from public.programs where network_program_id = 'ONAY-1'),
  'DISCOVERED', '6) yoklama sutunlarina yazmak basvuru durumunu DEGISTIRMIYOR');

-- --- 7: YOKLAMA merchant BAĞI KURMUYOR ------------------------------------
select is(
  (select merchant_id from public.programs where network_program_id = 'ONAY-1'),
  null::uuid, '7) yoklama merchant bagi KURMUYOR -- onay takibi onboarding degildir');

-- --- 8-9: onay sonrası bile kanıt kısıtı yerinde --------------------------
-- Ağ onayladı diye merchant bağlanmıyor; kısıt onayı ŞART koşuyor ama
-- yeterli saymıyor: kalan kanıtı `evaluateOnboardingHandoff` ölçüyor.
select throws_ok(
  format(
    $$ update public.programs set merchant_id = %L where network_program_id = 'ONAY-1' $$,
    (select id from public.merchants order by slug limit 1)),
  '23514', null,
  '8) PENDING/DISCOVERED programa merchant baglanamiyor');

select lives_ok(
  format(
    $$ update public.programs set application_state = 'APPROVED' where network_program_id = 'ONAY-1';
       update public.programs set merchant_id = %L where network_program_id = 'ONAY-1' $$,
    (select id from public.merchants order by slug limit 1)),
  '9) ONAY sonrasi baglanabiliyor -- kapatma fazla kapatmamis');

-- --- 10-11: ONAY GERİ ALINAMAZ (Aşama 4 regresyonu) -----------------------
select throws_ok(
  $$ update public.programs set application_state = 'PENDING' where network_program_id = 'ONAY-1' $$,
  '23514', null,
  '10) APPROVED -> PENDING hala reddediliyor');

select lives_ok(
  $$ update public.programs set application_state = 'REJECTED' where network_program_id = 'ONAY-1' $$,
  '11) APPROVED -> REJECTED hala serbest -- ag onayi geri alabilir');

-- --- 12: YOKLAMA SIRASI İNDEKSİ -------------------------------------------
-- Kısmi indeks: yalnızca yoklanmaya değer durumlar. APPROVED de listede
-- cunku ag onayi GERI ALABILIR ve bunu ogrenmenin tek yolu sormaktir.
select ok(
  (select indexdef like '%approval_checked_at%'
      and indexdef like '%APPLIED%'
      and indexdef like '%APPROVED%'
     from pg_indexes
    where schemaname='public' and tablename='programs' and indexname='programs_approval_poll_idx'),
  '12) yoklama sirasi kismi indeksi APPROVED i de kapsiyor');

-- --- 13: NULL ÖNCE — hiç yoklanmamış olan en acil -------------------------
select ok(
  (select indexdef like '%NULLS FIRST%' from pg_indexes
    where schemaname='public' and tablename='programs' and indexname='programs_approval_poll_idx'),
  '13) hic yoklanmamis program siranin BASINDA -- beklemek onu hic yoklamamaktir');

-- --- 14: denetim izi hala istemciye kapalı --------------------------------
select is(
  (select count(*)::int from (values ('anon'), ('authenticated')) as r(rol)
    where has_table_privilege(r.rol, 'public.program_application_attempts', 'select')),
  0, '14) denetim izi istemciye kapali kaldi');

select * from finish();
rollback;
