-- ===========================================================================
-- OTOMATİK ONBOARDING — onaylı programdan operasyonel merchant'a
-- ===========================================================================
--
-- ONAY BİR MAĞAZA KAYDI DEĞİLDİR
--
-- Ağın bizi kabul etmesi, o mağazaya trafik gönderebileceğimiz anlamına
-- gelmez. `merchants` kanıtlı kayıt tablosudur ve `/git/:offerId`
-- yönlendirmesi ile dönüşüm hattı onun alanlarına bakar: ana sayfası
-- bilinmeyen bir mağaza için deeplink üretilemez, çerez penceresi
-- bilinmeyen bir program için dönüşüm ilişkilendirilemez. İkisi de çalışma
-- anında, GERÇEK TRAFİKTE patlar.
--
-- `evaluateOnboardingHandoff` (Aşama 5) neyin eksik olduğunu ÖLÇÜYOR. Bu
-- göç, ölçüm tamamsa devri YAPIYOR -- ve ölçüm tam değilse YAPMIYOR.
--
-- ---------------------------------------------------------------------------
-- İDEMPOTENCY VERİTABANINDA
-- ---------------------------------------------------------------------------
-- Aynı program iki kez devredilirse ikinci çağrı YENİ MAĞAZA AÇMAMALI.
-- Kod tarafında "önce ara, yoksa oluştur" yapılabilirdi ama o kalıp iki
-- eşzamanlı onboarding turunda iki mağaza üretir ve o andan itibaren aynı
-- mağazanın iki kaydı, iki deeplink'i, iki gelir kalemi olur.
--
-- Üç dayanak:
--   1. `programs.merchant_id` doluysa devir ZATEN yapılmış -> aynı id döner.
--   2. `merchant_network_links (network, network_program_id)` TEKİL.
--   3. `merchants.slug` TEKİL ve slug programdan DETERMİNİSTİK türetiliyor.
--
-- ---------------------------------------------------------------------------
-- MAĞAZA "active" YAPILMIYOR
-- ---------------------------------------------------------------------------
-- Onboarding mağazayı `prospect` olarak açıyor. `active` yapmak ayrı bir
-- karardır ve şemadaki kapılar (`merchants_active_needs_template`,
-- `merchants_active_needs_verified_terms`) onu zaten koruyor. Devir anında
-- aktifleştirmek, kapıları devir turuna delegе etmek olurdu.
-- ===========================================================================

/**
 * Programdan deterministik mağaza slug'ı.
 *
 * Ağ + program kimliğinden türüyor, mağaza ADINDAN değil: iki ağdaki iki
 * farklı program aynı adı taşıyabilir ("Nike", "Nike US") ve ad tabanlı bir
 * slug ikisini aynı satıra çökertirdi. Ad değişirse slug DEĞİŞMEZ -- slug
 * bir kimliktir, bir etiket değil.
 */
create or replace function public.program_merchant_slug(
  p_network text,
  p_network_program_id text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select left(
    regexp_replace(
      lower(p_network || '-' || p_network_program_id),
      '[^a-z0-9]+', '-', 'g'
    ),
    40
  ) || '-' || left(md5(p_network || ':' || p_network_program_id), 6);
$$;

comment on function public.program_merchant_slug is
  'Ag + program kimliginden deterministik slug. Magaza ADINDAN turemiyor: '
  'iki agdaki iki program ayni adi tasiyabilir ve ad tabanli slug ikisini '
  'ayni satira cokertirdi.';

/** Devir sonucunun neden reddedildiği. */
create type public.onboarding_refusal as enum (
  'not_approved',       -- program APPROVED degil
  'missing_homepage',
  'missing_country',
  'missing_commission',
  'missing_cookie_window',
  'missing_terms',      -- sartlar dogrulanmamis
  'network_taken'       -- ag programi baska bir magazaya bagli
);

comment on type public.onboarding_refusal is
  'Devrin neden yapilmadigi. Tek bir "basarisiz" degeri, eksik ana sayfa ile '
  'onaysiz programi ayni kefeye koyar ve operator ne yapacagini bilemez.';

/**
 * Onaylı bir programı operasyonel merchant'a devreder.
 *
 * KAPALI BAŞARISIZ: eksik tek kanıt varsa mağaza AÇILMAZ ve gerekçe döner.
 * Kısmi bir mağaza açmak, `merchants`ın kanıt kuralını sessizce delmek
 * olurdu.
 *
 * İDEMPOTENT: aynı program ikinci kez devredilirse mevcut mağaza döner,
 * yenisi açılmaz.
 */
create or replace function public.onboard_approved_program(p_program_id uuid)
returns table (
  merchant_id uuid,
  created boolean,
  refusal public.onboarding_refusal
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p       public.programs%rowtype;
  v_slug    text;
  v_mid     uuid;
  v_created boolean := false;
  v_terms   timestamptz;
begin
  select * into v_p from public.programs where id = p_program_id;
  if not found then
    return;  -- program yok: satir donmez, cagiran bunu ayirt eder
  end if;

  -- --- 1) ONAY ŞART ------------------------------------------------------
  -- PENDING "yakinda onaylanacak" degildir; ag hala degerlendiriyor demektir
  -- ve uzerine magaza kaydi acmak, hic gelmeyecek bir onayi varsaymaktir.
  if v_p.application_state <> 'APPROVED' then
    return query select null::uuid, false, 'not_approved'::public.onboarding_refusal;
    return;
  end if;

  -- --- 2) ZATEN DEVREDİLMİŞ Mİ -------------------------------------------
  if v_p.merchant_id is not null then
    return query select v_p.merchant_id, false, null::public.onboarding_refusal;
    return;
  end if;

  -- --- 3) KANIT TAM MI (fail-closed) -------------------------------------
  if nullif(btrim(coalesce(v_p.homepage_url, '')), '') is null then
    return query select null::uuid, false, 'missing_homepage'::public.onboarding_refusal;
    return;
  end if;
  if v_p.country_code is null then
    return query select null::uuid, false, 'missing_country'::public.onboarding_refusal;
    return;
  end if;
  if v_p.commission_rate is null then
    return query select null::uuid, false, 'missing_commission'::public.onboarding_refusal;
    return;
  end if;
  if v_p.cookie_window_days is null or v_p.cookie_window_days <= 0 then
    return query select null::uuid, false, 'missing_cookie_window'::public.onboarding_refusal;
    return;
  end if;

  /*
   * ŞARTLAR DOĞRULANMIŞ OLMALI.
   *
   * `programs.terms` ağın SÖYLEDİĞİDİR; doğrulanmış olması ayrı bir
   * insanın işidir. Doğrulanmamış şartla açılan bir mağaza,
   * `merchants_active_needs_verified_terms` kapısına zaten takılırdı --
   * ama o noktada mağaza kaydı çoktan açılmış olurdu.
   */
  if nullif(btrim(coalesce(v_p.terms, '')), '') is null then
    return query select null::uuid, false, 'missing_terms'::public.onboarding_refusal;
    return;
  end if;
  v_terms := v_p.last_verified_at;

  -- --- 4) AĞ PROGRAMI BAŞKASINA BAĞLI MI ---------------------------------
  if exists (
    select 1 from public.merchant_network_links l
     where l.network = v_p.network and l.network_program_id = v_p.network_program_id
  ) then
    -- Baglı olan magazayı programa bagla; YENI magaza ACMA.
    select l.merchant_id into v_mid
      from public.merchant_network_links l
     where l.network = v_p.network and l.network_program_id = v_p.network_program_id;

    update public.programs set merchant_id = v_mid where id = p_program_id;
    return query select v_mid, false, null::public.onboarding_refusal;
    return;
  end if;

  -- --- 5) MAĞAZAYI AÇ (prospect) -----------------------------------------
  v_slug := public.program_merchant_slug(v_p.network, v_p.network_program_id);

  insert into public.merchants (
    slug, display_name, homepage_url, country_code, network, status,
    network_advertiser_id, default_commission_rate, cookie_window_days,
    terms_verified_at, application_status, approved_at
  )
  values (
    v_slug, v_p.merchant_name, v_p.homepage_url, v_p.country_code, v_p.network,
    -- prospect: aktiflestirme AYRI bir karar ve semadaki kapilar onu koruyor.
    'prospect',
    /*
     * Awin advertiser kimligi SAYISALDIR (`merchants_advertiser_id_numeric`).
     * Sayisal olmayan bir program kimligi Awin MID'i DEGILDIR; onu MID
     * hucresine yazmak, dogrulanmamis bir kimligi dogrulanmis gibi
     * gostermek olurdu. Sayisal degilse NULL kalir ve operator doldurur.
     */
    case when v_p.network = 'awin' and v_p.network_program_id ~ '^[0-9]+$'
         then v_p.network_program_id else null end,
    v_p.commission_rate, v_p.cookie_window_days,
    v_terms, 'approved', v_terms
  )
  on conflict (slug) do update set display_name = public.merchants.display_name
  returning id into v_mid;

  v_created := true;

  -- --- 6) AĞ BAĞI --------------------------------------------------------
  insert into public.merchant_network_links (
    merchant_id, network, network_program_id, program_id,
    commission_rate, cookie_window_days, is_primary
  )
  values (
    v_mid, v_p.network, v_p.network_program_id, p_program_id,
    v_p.commission_rate, v_p.cookie_window_days, true
  )
  on conflict (network, network_program_id) do nothing;

  -- --- 7) PROGRAMI BAĞLA -------------------------------------------------
  update public.programs set merchant_id = v_mid where id = p_program_id;

  return query select v_mid, v_created, null::public.onboarding_refusal;
end;
$$;

comment on function public.onboard_approved_program is
  'Onayli programi operasyonel merchant a devreder. KAPALI BASARISIZ: eksik '
  'tek kanit varsa magaza ACILMAZ. IDEMPOTENT: ikinci cagri mevcut magazayi '
  'dondurur. Magazayi active YAPMAZ -- o ayri bir karar.';

revoke all on function public.onboard_approved_program(uuid) from public;
revoke all on function public.onboard_approved_program(uuid) from anon, authenticated;
grant execute on function public.onboard_approved_program(uuid) to service_role;

revoke all on function public.program_merchant_slug(text, text) from public;
revoke all on function public.program_merchant_slug(text, text) from anon, authenticated;
grant execute on function public.program_merchant_slug(text, text) to service_role;

-- Devre HAZIR programlar: onaylı, kanıtı tam, henüz devredilmemiş.
create index programs_onboarding_ready_idx
  on public.programs (last_verified_at)
  where application_state = 'APPROVED' and merchant_id is null;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_p uuid; v_p2 uuid; v_r record; v_r2 record; v_m uuid;
begin
  -- Kanıtı TAM, onaylı bir program.
  insert into public.programs (
    network, network_program_id, merchant_name, homepage_url, country_code,
    commission_rate, cookie_window_days, terms, last_verified_at
  ) values (
    'awin', '900000001', 'Goc Onboarding', 'https://goc-onb.example', 'US',
    0.1000, 30, 'Standart sartlar.', now()
  ) returning id into v_p;

  -- 1) ONAYSIZ devir REDDEDILIYOR.
  select * into v_r from public.onboard_approved_program(v_p);
  if v_r.refusal is distinct from 'not_approved' then
    raise exception 'DOGRULAMA 1: onaysiz program devredildi.';
  end if;
  if exists (select 1 from public.merchants where slug like 'awin-900000001%') then
    raise exception 'DOGRULAMA 1b: onaysiz programa magaza acildi.';
  end if;

  update public.programs set application_state = 'APPROVED' where id = v_p;

  -- 2) DEVIR YAPILIYOR ve magaza PROSPECT aciliyor.
  select * into v_r from public.onboard_approved_program(v_p);
  if v_r.merchant_id is null or not v_r.created then
    raise exception 'DOGRULAMA 2: kaniti tam onayli program devredilemedi.';
  end if;
  v_m := v_r.merchant_id;

  if (select status from public.merchants where id = v_m) <> 'prospect' then
    raise exception
      'DOGRULAMA 2b: magaza dogrudan aktiflestirildi -- semadaki kapilar '
      'devir turuna delege edilmis olurdu.';
  end if;

  -- 3) IDEMPOTENT: ikinci cagri YENI magaza acmiyor.
  select * into v_r2 from public.onboard_approved_program(v_p);
  if v_r2.merchant_id <> v_m or v_r2.created then
    raise exception
      'DOGRULAMA 3: ikinci devir yeni magaza acti -- ayni magazanin iki '
      'kaydi, iki deeplink i ve iki gelir kalemi olurdu.';
  end if;

  -- 4) AG BAGI kuruldu ve TEKIL.
  if (select count(*) from public.merchant_network_links
       where network = 'awin' and network_program_id = '900000001') <> 1 then
    raise exception 'DOGRULAMA 4: ag bagi kurulmadi ya da tekil degil.';
  end if;

  -- 5) EKSIK KANIT: fail-closed ve GEREKCE donuyor.
  insert into public.programs (
    network, network_program_id, merchant_name, country_code,
    commission_rate, cookie_window_days, terms, last_verified_at, application_state
  ) values (
    'awin', '900000002', 'Eksik Kanit', 'US', 0.1000, 30, 'Sartlar.', now(), 'APPROVED'
  ) returning id into v_p2;

  select * into v_r from public.onboard_approved_program(v_p2);
  if v_r.refusal is distinct from 'missing_homepage' then
    raise exception 'DOGRULAMA 5: ana sayfasi olmayan program devredildi (%).', v_r.refusal;
  end if;
  if (select merchant_id from public.programs where id = v_p2) is not null then
    raise exception 'DOGRULAMA 5b: eksik kanitli programa merchant baglandi.';
  end if;

  -- 6) SLUG DETERMINISTIK ve ADDAN bagimsiz.
  if public.program_merchant_slug('awin', '900000001')
     is distinct from public.program_merchant_slug('awin', '900000001') then
    raise exception 'DOGRULAMA 6: slug belirlenimci degil.';
  end if;
  if public.program_merchant_slug('awin', 'X') = public.program_merchant_slug('cj', 'X') then
    raise exception 'DOGRULAMA 6b: iki agdaki ayni kimlik ayni sluga cokuyor.';
  end if;

  -- Temizlik
  delete from public.merchant_network_links where network_program_id in ('900000001','900000002');
  delete from public.programs where id in (v_p, v_p2);
  delete from public.merchants where id = v_m;

  raise notice
    'Onboarding kuruldu: onaysiz devir reddediliyor, eksik kanit fail-closed, '
    'ikinci devir yeni magaza acmiyor, magaza prospect aciliyor.';
end $$;
