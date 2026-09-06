-- ===========================================================================
-- KEŞİF ÖLÇEĞİ — tur denetimi, imleç, bayatlık ve puanlama sırası
-- ===========================================================================
--
-- MEVCUT KEŞİF TURU TEK BİR SORUYU YANITLAYAMIYOR: "ne oldu?"
--
-- `runProgramDiscovery` sonucu yalnızca bellekte döndürüyor. Bir tur
-- yarıda düşerse ya da bir ağ sessizce boşalırsa geriye HİÇBİR İZ kalmıyor.
-- Ölçekte bu, alım hattının aylarca hiç çalışmadığını kimsenin fark
-- etmemesiyle aynı hata (`source_health` göçünün ölçtüğü durum) -- yalnız
-- bu sefer program tarafında.
--
-- ÜÇ EKSİK KAPATILIYOR:
--
--   1. TUR DENETİMİ   Her keşif turu bir satır bırakıyor: hangi ağ, hangi
--                     imleçten hangi imlece, kaç sayfa, kaç program, ne
--                     sonuç. Denetlenemeyen bir tur, çalıştığı iddia
--                     edilemeyen bir turdur.
--
--   2. İMLEÇ          Milyonlarca programlı bir ağ tek turda taranamaz.
--                     İmleç ağ satırında duruyor: sonraki tur kaldığı
--                     yerden devam ediyor. Olmasaydı her tur ilk sayfayı
--                     tarar ve gerisini HİÇ görmezdi.
--
--   3. BAYATLIK       Ağ bir programı listeden çıkardığında bize bunu
--                     SÖYLEMEZ. Yalnız "gördüklerimizi" yazarsak katalog,
--                     ağda artık var olmayan programlarla sonsuza kadar
--                     dolu kalır. `last_verified_at` zaten var; eksik olan
--                     ona bakan erişim yolu ve eşik.
--
-- ---------------------------------------------------------------------------
-- İKİNCİ BİR DURUM MAKİNESİ YOK
-- ---------------------------------------------------------------------------
-- Tur durumu (`discovery_run_status`) programın durumu DEĞİLDİR.
-- `application_state` yalnız başvuru motorunun işidir ve bu göç ona
-- dokunmuyor. İkisini karıştırmak, keşfin onaylı bir programı geri
-- çekebilmesi demekti.
-- ===========================================================================

create type public.discovery_run_status as enum (
  'running',          -- tur devam ediyor
  'completed',        -- ag sonuna kadar tarandi
  'partial',          -- kota/butce doldu; imlec saklandi
  'manual_required',  -- ag otomatik kesfe izin vermiyor
  'unavailable',      -- agin sozlesmesi dogrulanmadi
  'not_implemented',  -- beyan var, kod yok
  'failed'            -- denendi, hata alindi
);

comment on type public.discovery_run_status is
  'Bir kesif turunun sonucu. TUR durumudur, PROGRAM durumu degildir: '
  'application_state yalnizca basvuru motorunun isidir.';

create table public.program_discovery_runs (
  id             uuid primary key default gen_random_uuid(),
  network        text not null references public.affiliate_networks (code),

  /*
   * Turun kimliği. Tekil: aynı tur iki kez kaydedilemez ve tekrarlanan bir
   * çağrı ikinci bir satır AÇAMAZ. Başvuru motorundaki `idempotency_key`
   * ile aynı kalıp ve aynı sebeple.
   */
  idempotency_key text not null,
  correlation_id  text,

  status         public.discovery_run_status not null,

  /** Turun başladığı ve bittiği imleç. NULL = baştan / sonuna kadar. */
  cursor_start   text,
  cursor_end     text,

  pages_fetched     integer not null default 0 check (pages_fetched >= 0),
  programs_seen     integer not null default 0 check (programs_seen >= 0),
  programs_written  integer not null default 0 check (programs_written >= 0),
  first_seen_count  integer not null default 0 check (first_seen_count >= 0),
  /** Şemaya uymadığı için ELENEN satırlar. Sessiz kayıp YASAK. */
  malformed_dropped integer not null default 0 check (malformed_dropped >= 0),

  error_category text,
  message        text,

  started_at     timestamptz not null default now(),
  finished_at    timestamptz,

  constraint program_discovery_runs_key_unique unique (idempotency_key),
  constraint program_discovery_runs_key_not_blank
    check (length(btrim(idempotency_key)) > 0),
  constraint program_discovery_runs_finished_after_start
    check (finished_at is null or finished_at >= started_at),

  /* Yazılan sayı görülenden büyük olamaz: sayaçlar birbirini denetliyor. */
  constraint program_discovery_runs_written_within_seen
    check (programs_written <= programs_seen),
  constraint program_discovery_runs_first_seen_within_written
    check (first_seen_count <= programs_written),

  constraint program_discovery_runs_error_category_known
    check (
      error_category is null
      or error_category = any (array[
        'MANUAL_REQUIRED', 'CAPABILITY_UNAVAILABLE', 'CAPABILITY_NOT_IMPLEMENTED',
        'UNKNOWN_NETWORK', 'TIMEOUT', 'RATE_LIMITED', 'NETWORK_ERROR',
        'HTTP_ERROR', 'MALFORMED_RESPONSE', 'DATABASE_ERROR',
        'SECURITY_ERROR', 'UNKNOWN_ERROR'
      ])
    ),

  /*
   * SON KAPI: kimlik bilgisi görünümlü metin reddedilir. Asıl savunma kodun
   * sırrı hiç taşımaması; bu, o savunma delinirse diye.
   */
  constraint program_discovery_runs_message_no_secret
    check (
      message is null
      or (
        message !~* '(authorization|x-api-key)[[:space:]]*[:=]'
        and message !~* 'bearer[[:space:]]+[a-z0-9._-]{8,}'
        and message !~* '(api[_-]?key|access[_-]?token|secret|password)[[:space:]]*=[[:space:]]*[^[:space:]]{4,}'
      )
    )
);

comment on table public.program_discovery_runs is
  'Her kesif turunun denetim izi. Denetlenemeyen bir tur, calistigi iddia '
  'edilemeyen bir turdur.';

create index program_discovery_runs_network_idx
  on public.program_discovery_runs (network, started_at desc);

-- --- Ağ başına imleç ve son tarama anı -------------------------------------
alter table public.affiliate_networks
  /*
   * Milyonlarca programlı bir ağ tek turda taranamaz. İmleç burada duruyor:
   * sonraki tur kaldığı yerden devam eder. Olmasaydı her tur yalnız ilk
   * sayfayı tarar ve gerisini HİÇ görmezdi.
   */
  add column discovery_cursor text,
  add column discovery_checked_at timestamptz,
  /* Bir turda bu ağdan en fazla kaç sayfa çekilir. */
  add column discovery_page_limit integer not null default 50
    check (discovery_page_limit between 1 and 10000);

comment on column public.affiliate_networks.discovery_cursor is
  'Kesifte kalinan yer. Opak: ayristirilmaz. NULL = bastan baslanacak.';

-- Tarama sırası: en uzun süredir bakılmayan önce. NULL en başta --
-- hiç taranmamış bir ağı beklemek onu hiç taramamaktır.
create index affiliate_networks_discovery_idx
  on public.affiliate_networks (discovery_checked_at nulls first)
  where is_enabled;

-- ---------------------------------------------------------------------------
-- BAYAT PROGRAMLAR
-- ---------------------------------------------------------------------------
-- Ağ bir programı listeden çıkardığında bunu bize söylemez. Yalnız
-- gördüklerimizi yazarsak katalog, ağda artık var olmayan programlarla
-- sonsuza kadar dolu kalır.
--
-- ONAYLI PROGRAM BAYAT SAYILMAZ: onay dışarıda gerçekleşmiş bir olaydır ve
-- keşif listesinden düşmesi onu geçersiz kılmaz (ağ katalogu bazen yalnız
-- katılmadığımız programları listeler). Bayatlık bir SİLME değil bir
-- İŞARETTİR; kararı operatör verir.
create or replace function public.stale_programs(p_days integer default 30)
returns table (
  program_id uuid,
  network text,
  network_program_id text,
  merchant_name text,
  application_state public.program_application_state,
  last_verified_at timestamptz,
  days_stale numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.network, p.network_program_id, p.merchant_name,
    p.application_state, p.last_verified_at,
    round(extract(epoch from (now() - p.last_verified_at)) / 86400.0, 1)
  from public.programs p
  where p.last_verified_at < now() - make_interval(days => greatest(1, p_days))
    and p.application_state <> 'APPROVED'
  order by p.last_verified_at;
$$;

comment on function public.stale_programs is
  'Uzun suredir aglarda gorulmeyen programlar. ONAYLI olanlar haric: onay '
  'disarida gerceklesmis bir olaydir ve kesif listesinden dusmesi onu '
  'gecersiz kilmaz. Bayatlik bir SILME degil bir ISARETTIR.';

create index programs_stale_idx
  on public.programs (last_verified_at)
  where application_state <> 'APPROVED';

-- ---------------------------------------------------------------------------
-- PUANLAMA SIRASI — keşif ile puanlama arasındaki bağ
-- ---------------------------------------------------------------------------
-- Keşif bir programı güncellediğinde eski puan BAYATLAR. Ayrı bir
-- "needs_scoring" sütunu eklenebilirdi ama o sütun kodun güncellemeyi
-- unuttuğu ilk yerde yalan söylemeye başlardı. Türetilmiş bir soru
-- ayrışamaz: puan yoksa ya da puan son doğrulamadan ESKİYSE, sıradadır.
create or replace function public.programs_due_for_scoring(p_limit integer default 1000)
returns table (
  program_id uuid,
  network text,
  network_program_id text,
  last_verified_at timestamptz,
  scored_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.network, p.network_program_id, p.last_verified_at, p.scored_at
    from public.programs p
   where p.score is null
      or p.scored_at is null
      or p.scored_at < p.last_verified_at
   order by p.last_verified_at desc
   limit greatest(1, least(p_limit, 10000));
$$;

comment on function public.programs_due_for_scoring is
  'Puanlanmayi bekleyen programlar. Ayri bir needs_scoring sutunu, kodun '
  'guncellemeyi unuttugu ilk yerde yalan soylemeye baslardi; turetilmis '
  'soru ayrisamaz.';

create index programs_scoring_due_idx
  on public.programs (last_verified_at desc)
  where score is null or scored_at is null or scored_at < last_verified_at;

-- --- Erişim ----------------------------------------------------------------
alter table public.program_discovery_runs enable row level security;
revoke all on public.program_discovery_runs from anon, authenticated;
grant select, insert, update on public.program_discovery_runs to service_role;
-- Denetim izi silinemez.
revoke delete on public.program_discovery_runs from service_role;

revoke all on function public.stale_programs(integer) from public;
revoke all on function public.stale_programs(integer) from anon, authenticated;
grant execute on function public.stale_programs(integer) to service_role;

revoke all on function public.programs_due_for_scoring(integer) from public;
revoke all on function public.programs_due_for_scoring(integer) from anon, authenticated;
grant execute on function public.programs_due_for_scoring(integer) to service_role;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_p uuid;
begin
  -- 1) TUR TEKILLIGI: ayni tur iki kez kaydedilemez.
  insert into public.program_discovery_runs (network, idempotency_key, status)
       values ('awin', 'goc:kesif:1', 'completed');
  begin
    insert into public.program_discovery_runs (network, idempotency_key, status)
         values ('awin', 'goc:kesif:1', 'completed');
    raise exception 'DOGRULAMA 1: ayni tur iki kez kaydedildi.';
  exception when unique_violation then null;
  end;

  -- 2) SAYACLAR BIRBIRINI DENETLIYOR: yazilan gorulenden buyuk olamaz.
  begin
    update public.program_discovery_runs
       set programs_seen = 5, programs_written = 9
     where idempotency_key = 'goc:kesif:1';
    raise exception
      'DOGRULAMA 2: gorulenden fazla program yazildigi iddia edildi -- '
      'sayaclar denetlenemez olurdu.';
  exception when check_violation then null;
  end;

  -- 3) SIR GORUNUMLU METIN REDDEDILIYOR.
  begin
    update public.program_discovery_runs
       set message = 'hata: Authorization: Bearer abcdef0123456789'
     where idempotency_key = 'goc:kesif:1';
    raise exception 'DOGRULAMA 3: kimlik bilgisi gorunumlu metin yazildi.';
  exception when check_violation then null;
  end;

  -- 4) BAYAT PROGRAM: onayli olan haric.
  -- `first_seen_at` de geriye alınıyor: kısıt `last_verified_at >=
  -- first_seen_at` istiyor ve bir programı ilk görüldüğünden ÖNCE
  -- doğrulamış olamayız.
  insert into public.programs
    (network, network_program_id, merchant_name, first_seen_at, last_verified_at)
       values ('awin', 'GOC-BAYAT', 'Bayat Program',
               now() - interval '90 days', now() - interval '60 days')
    returning id into v_p;

  if not exists (select 1 from public.stale_programs(30) where program_id = v_p) then
    raise exception 'DOGRULAMA 4: bayat program tespit edilemedi.';
  end if;

  update public.programs set application_state = 'APPROVED' where id = v_p;
  if exists (select 1 from public.stale_programs(30) where program_id = v_p) then
    raise exception
      'DOGRULAMA 5: ONAYLI program bayat sayildi -- kesif listesinden dusmesi '
      'onu gecersiz kilmaz.';
  end if;

  -- 6) PUANLAMA SIRASI: puansiz program sirada.
  if not exists (select 1 from public.programs_due_for_scoring(100) where program_id = v_p) then
    raise exception 'DOGRULAMA 6: puanlanmamis program sirada gorunmedi.';
  end if;

  update public.programs
     set score = 50, scored_at = now(), score_breakdown = '{}'::jsonb
   where id = v_p;
  if exists (select 1 from public.programs_due_for_scoring(100) where program_id = v_p) then
    raise exception 'DOGRULAMA 7: taze puanli program sirada kaldi.';
  end if;

  -- 8) KESIF PUANI BAYATLATIYOR: last_verified_at ilerleyince yine sirada.
  update public.programs set last_verified_at = now() + interval '1 second' where id = v_p;
  if not exists (select 1 from public.programs_due_for_scoring(100) where program_id = v_p) then
    raise exception
      'DOGRULAMA 8: kesif programi guncelledi ama puan bayatlamadi -- eski '
      'puan sonsuza kadar taze sayilirdi.';
  end if;

  delete from public.programs where id = v_p;
  delete from public.program_discovery_runs where idempotency_key = 'goc:kesif:1';

  raise notice
    'Kesif olcegi kuruldu: tur denetimi tekil, sayaclar birbirini denetliyor, '
    'onayli program bayat sayilmiyor, kesif puani bayatlatiyor.';
end $$;
