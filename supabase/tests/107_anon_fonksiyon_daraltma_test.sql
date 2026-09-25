-- ============================================================================
-- ANONİM ÇAĞRILABİLEN SECURITY DEFINER FONKSİYONLAR
-- ----------------------------------------------------------------------------
-- 20260926090000_anon_fonksiyon_daraltma.sql üç şey yaptı; bu test üçünü de
-- DAVRANIŞ olarak ölçer:
--   1) ohaaaa_score, anon'a görünmeyen (taslak) ürün için "urun_yok" der;
--      sahibi aynı ürünü yine görür; ürün yayına dönünce anon yine görür.
--   2) deal_score / offer_freshness anon ve authenticated'a kapalı; vitrinin
--      kullandığı fonksiyonlar açık kaldı.
--   3) price_drops sınırsız parametreyle çağrılsa da sınırlar içinde kalır.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

-- Seed'deki taşeron A'nın ürünü (sahibi 2222...), test boyunca TASLAK.
update public.products
   set status = 'draft'
 where id = '50000000-0000-4000-8000-000000000001';

-- --------------------------------------------------------------------------
-- 1a) anon: taslak ürünün skoru SIZMAZ
-- --------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  v jsonb := public.ohaaaa_score('50000000-0000-4000-8000-000000000001', 90);
begin
  if v ->> 'reason' is distinct from 'urun_yok' or v ? 'components' then
    raise exception 'SIZINTI: anon taslak urunun skorunu okudu: %', v;
  end if;
  raise notice '✓ ohaaaa_score: taslak urun anon icin "urun_yok"';
end $$;

reset role;

-- --------------------------------------------------------------------------
-- 1b) sahibi kendi taslağını görür
-- --------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  v jsonb := public.ohaaaa_score('50000000-0000-4000-8000-000000000001', 90);
begin
  if not (v ? 'components') then
    raise exception 'BOZULDU: sahibi kendi taslaginin skorunu goremiyor: %', v;
  end if;
  raise notice '✓ ohaaaa_score: sahibi kendi taslagini goruyor';
end $$;

reset role;

-- --------------------------------------------------------------------------
-- 1c) yayına dönen ürün anon'a yine açık (vitrin kırılmadı)
-- --------------------------------------------------------------------------
update public.products
   set status = 'active'
 where id = '50000000-0000-4000-8000-000000000001';

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  v jsonb := public.ohaaaa_score('50000000-0000-4000-8000-000000000001', 90);
begin
  if not (v ? 'components') then
    raise exception 'BOZULDU: yayindaki urunun skoru anon icin kayboldu: %', v;
  end if;
  raise notice '✓ ohaaaa_score: yayindaki urun anon icin acik';
end $$;

-- --------------------------------------------------------------------------
-- 3) price_drops sınırsız parametrede de sınırlar içinde
-- --------------------------------------------------------------------------
do $$
declare
  v_say int;
begin
  -- Negatif oran önceden "fiyatı 6 katına çıkanlar dahil her şey" demekti.
  select count(*) into v_say
    from public.price_drops(100000, -5, null, 1000000)
   where drop_ratio < 0.01;
  if v_say > 0 then
    raise exception 'SINIRSIZ: negatif oran dususu olmayan % grup dondurdu', v_say;
  end if;

  select count(*) into v_say from public.price_drops(100000, 0.05, null, 1000000);
  if v_say > 100 then
    raise exception 'SINIRSIZ: p_limit 100 ile sinirlanmadi (% satir)', v_say;
  end if;
  raise notice '✓ price_drops: gun/oran/limit sinirlandi';
end $$;

reset role;

-- --------------------------------------------------------------------------
-- 2) yetkiler
-- --------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.deal_score(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.deal_score(uuid, integer)', 'execute')
     or has_function_privilege('anon', 'public.offer_freshness(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.offer_freshness(uuid, integer)', 'execute') then
    raise exception 'ACIK: deal_score / offer_freshness disariya hala acik';
  end if;

  if not (has_function_privilege('anon', 'public.ohaaaa_score(uuid, integer)', 'execute')
      and has_function_privilege('anon', 'public.price_drops(integer, numeric, uuid, integer)', 'execute')
      and has_function_privilege('anon', 'public.price_history(uuid, integer)', 'execute')
      and has_function_privilege('anon', 'public.is_admin()', 'execute')
      and has_function_privilege('anon', 'public.owns_vendor(uuid)', 'execute')) then
    raise exception 'BOZULDU: vitrinin ya da RLS''in kullandigi bir fonksiyon anon''dan kapandi';
  end if;

  raise notice '✓ yetkiler: kullanilmayanlar kapali, vitrin ve RLS yardimcilari acik';
end $$;

rollback;
