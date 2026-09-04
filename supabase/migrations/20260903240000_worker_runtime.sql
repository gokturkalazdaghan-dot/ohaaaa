-- ===========================================================================
-- WORKER ÇALIŞMA ZAMANI — kiralama, yetim kurtarma, kalıcı devre kesici
-- ---------------------------------------------------------------------------
-- ÇÖZÜLEN PROBLEM 1: YETİM İŞ
-- Bir worker işi alıp (status='calisiyor') sonra ölürse -- süreç çöker,
-- konteyner yeniden başlar, GitHub Actions çalışması iptal edilir -- iş
-- SONSUZA DEK "calisiyor" kalır. Kimse onu almaz, kimse yeniden denemez,
-- ve kuyruk sessizce sızdırır.
--
-- Çözüm kiralama (lease): alınan iş bir süre için kiralanır. Kira dolarsa
-- iş yeniden alınabilir hâle gelir. Worker canlıysa kirayı uzatır.
--
-- ÇÖZÜLEN PROBLEM 2: SÜREÇ İÇİ DEVRE KESİCİ
-- politeClient.ts'teki devre kesici süreç içi. İki ayrı worker aynı çöken
-- kaynağa aynı anda yüklenir, çünkü birbirlerinin gördüğü hatalardan
-- haberleri yok. Süreç yeniden başlayınca da devre sıfırlanır ve kaynak
-- yeniden dövülür.
--
-- Kalıcı durum, tüm worker'ların AYNI devreyi görmesi demek.
-- ===========================================================================

alter table public.jobs
  -- Kira bitiş anı. NULL = alınmamış iş.
  add column lease_until timestamptz,
  -- Hangi worker aldı. Hata ayıklama ve yetim tespiti için.
  add column claimed_by text,
  -- SLO ölçümü: iş kuyrukta ne kadar bekledi, ne kadar sürdü?
  add column enqueued_at timestamptz not null default now();

comment on column public.jobs.lease_until is
  'Kira bitis ani. Worker olurse kira dolar ve is yeniden alinabilir hale gelir.';
comment on column public.jobs.enqueued_at is
  'Isin kuyruga girdigi an. queue_wait_ms = started_at - enqueued_at.';

create index jobs_lease_idx on public.jobs (lease_until)
  where status = 'calisiyor';

-- ---------------------------------------------------------------------------
-- claim_jobs(): kiralama eklendi
-- ---------------------------------------------------------------------------
create or replace function public.claim_jobs(
  p_limit integer default 10,
  p_kind  text default null,
  p_lease_seconds integer default 300,
  p_worker_id text default null
)
returns setof public.jobs
language sql
security definer
set search_path = ''
as $$
  with alinan as (
    update public.jobs j
       set status = 'calisiyor',
           started_at = now(),
           attempt = j.attempt + 1,
           lease_until = now() + make_interval(secs => greatest(10, p_lease_seconds)),
           claimed_by = p_worker_id
     where j.id in (
       select k.id
         from public.jobs k
        where k.status in ('bekliyor', 'yeniden')
          and k.available_at <= now()
          and (p_kind is null or k.kind = p_kind)
        order by k.priority, k.available_at, k.created_at
        limit greatest(1, least(p_limit, 100))
        for update skip locked
     )
    returning j.*
  )
  select * from alinan
   order by priority, available_at, created_at;
$$;

-- ---------------------------------------------------------------------------
-- extend_lease() — worker "hâlâ hayattayım" der
-- ---------------------------------------------------------------------------
create or replace function public.extend_lease(
  p_job_id uuid, p_seconds integer default 300
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.jobs
     set lease_until = now() + make_interval(secs => greatest(10, p_seconds))
   where id = p_job_id and status = 'calisiyor'
  returning true;
$$;

comment on function public.extend_lease is
  'Uzun suren islerde kirayi uzatir. Worker olurse uzatma durur ve is kurtarilir.';

-- ---------------------------------------------------------------------------
-- recover_orphaned_jobs() — kirası dolmuş işleri geri al
-- ---------------------------------------------------------------------------
create or replace function public.recover_orphaned_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sayi integer;
begin
  /*
   * Yetim iş SİLİNMEZ, YENİDEN DENENİR.
   *
   * Deneme sayacı zaten alım anında artırılmıştı; bu yüzden sonsuz döngü
   * riski yok -- hak biterse normal yolla ölü mektuba düşer. Kurtarma
   * sırasında sayacı sıfırlamak, sürekli çöken bir işi sonsuza dek
   * yeniden denemek olurdu.
   */
  with kurtarilan as (
    update public.jobs
       -- CAST ZORUNLU: `case` govdesi text uretir, enum'a kendiliginden
       -- donusmez. Nitelemesiz birakinca "column status is of type
       -- job_status but expression is of type text" hatasi aliniyor.
       set status = (case when attempt >= max_attempts then 'olu_mektup'
                          else 'yeniden' end)::public.job_status,
           lease_until = null,
           claimed_by = null,
           last_error = 'Worker kirasi doldu; is kurtarildi.',
           failed_at = now(),
           available_at = now()
     where status = 'calisiyor'
       and lease_until is not null
       and lease_until < now()
    returning 1
  )
  select count(*) into v_sayi from kurtarilan;

  return v_sayi;
end;
$$;

comment on function public.recover_orphaned_jobs is
  'Kirasi dolmus isleri yeniden denenebilir yapar. Deneme sayaci SIFIRLANMAZ: '
  'surekli coken bir is sonsuza dek denenmemeli.';

-- ===========================================================================
-- KALICI DEVRE KESİCİ
-- ===========================================================================
create type public.breaker_state as enum ('kapali', 'acik', 'yari_acik');

comment on type public.breaker_state is
  'kapali = CLOSED (istek gecer), acik = OPEN (istek gecmez), '
  'yari_acik = HALF_OPEN (tek deneme).';

create table public.source_breakers (
  source_id     uuid primary key references public.sources (id) on delete cascade,
  state         public.breaker_state not null default 'kapali',
  failure_count integer not null default 0 check (failure_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  opened_at     timestamptz,
  half_open_at  timestamptz,
  last_error    text,
  updated_at    timestamptz not null default now()
);

comment on table public.source_breakers is
  'Kaynak basina devre kesici durumu. politeClient icindeki surec-ici '
  'kesiciyi DEGISTIRMEZ; tum workerlarin AYNI devreyi gormesini saglar.';

alter table public.source_breakers enable row level security;
revoke all on public.source_breakers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- breaker_allows() — bu kaynağa istek yapılabilir mi?
-- ---------------------------------------------------------------------------
create or replace function public.breaker_allows(p_source_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.source_breakers;
begin
  select * into v from public.source_breakers where source_id = p_source_id;

  -- Kaydı olmayan kaynak için devre KAPALI kabul edilir: hiç hata
  -- görmediğimiz bir kaynağı peşinen engellemek yanlış olurdu.
  if not found then return true; end if;

  if v.state = 'kapali' then return true; end if;

  /*
   * AÇIK devre süresi dolduğunda YARI AÇIK'a geçer ve TEK bir deneme
   * yapılır. Doğrudan KAPALI'ya dönmek, hâlâ çöken bir kaynağa tüm
   * kuyruğu birden salmak olurdu.
   */
  if v.state = 'acik' and v.half_open_at is not null and now() >= v.half_open_at then
    update public.source_breakers
       set state = 'yari_acik', updated_at = now()
     where source_id = p_source_id;
    return true;
  end if;

  -- Yarı açıkken deneme hakkı verilir; sonucu record_breaker_* belirler.
  if v.state = 'yari_acik' then return true; end if;

  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_breaker_failure() / record_breaker_success()
-- ---------------------------------------------------------------------------
create or replace function public.record_breaker_failure(
  p_source_id uuid,
  p_error text,
  p_threshold integer default 5,
  p_open_seconds integer default 300
)
returns public.breaker_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_yeni public.breaker_state;
  v_sayac integer;
  v_durum public.breaker_state;
begin
  insert into public.source_breakers (source_id, failure_count, last_error)
  values (p_source_id, 1, p_error)
  on conflict (source_id) do update
    set failure_count = public.source_breakers.failure_count + 1,
        last_error = p_error,
        updated_at = now()
  returning failure_count, state into v_sayac, v_durum;

  /*
   * YARI AÇIKKEN BİR HATA DEVREYİ HEMEN AÇAR.
   *
   * Deneme hakkı verilmişti ve başarısız oldu; eşiği yeniden beklemek,
   * toparlanmamış bir kaynağa eşik kadar istek daha göndermek olurdu.
   */
  if v_durum = 'yari_acik' or v_sayac >= p_threshold then
    v_yeni := 'acik';
    update public.source_breakers
       set state = 'acik',
           opened_at = now(),
           half_open_at = now() + make_interval(secs => greatest(5, p_open_seconds)),
           updated_at = now()
     where source_id = p_source_id;
  else
    v_yeni := v_durum;
  end if;

  return v_yeni;
end;
$$;

create or replace function public.record_breaker_success(p_source_id uuid)
returns public.breaker_state
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
   * BAŞARI SAYACI SIFIRLAR VE DEVREYİ KAPATIR.
   *
   * Yarı açıktan gelen tek bir başarı yeterli: kaynak yanıt veriyor.
   * Daha fazla başarı beklemek, toparlanmış bir kaynağı gereksiz yere
   * kısıtlı tutmak olurdu.
   */
  insert into public.source_breakers (source_id, state, success_count)
  values (p_source_id, 'kapali', 1)
  on conflict (source_id) do update
    set state = 'kapali',
        failure_count = 0,
        success_count = public.source_breakers.success_count + 1,
        opened_at = null,
        half_open_at = null,
        last_error = null,
        updated_at = now();

  return 'kapali'::public.breaker_state;
end;
$$;

-- --- Erişim ----------------------------------------------------------------
revoke all on function public.extend_lease(uuid, integer) from public;
revoke all on function public.recover_orphaned_jobs() from public;
revoke all on function public.breaker_allows(uuid) from public;
revoke all on function public.record_breaker_failure(uuid, text, integer, integer) from public;
revoke all on function public.record_breaker_success(uuid) from public;
revoke all on function public.claim_jobs(integer, text, integer, text) from public;

grant execute on function public.extend_lease(uuid, integer) to service_role;
grant execute on function public.recover_orphaned_jobs() to service_role;
grant execute on function public.breaker_allows(uuid) to service_role;
grant execute on function public.record_breaker_failure(uuid, text, integer, integer) to service_role;
grant execute on function public.record_breaker_success(uuid) to service_role;
grant execute on function public.claim_jobs(integer, text, integer, text) to service_role;

-- Eski 2 argümanlı imza artık yok; yenisi varsayılanlarla aynı işi görüyor.
drop function if exists public.claim_jobs(integer, text);
