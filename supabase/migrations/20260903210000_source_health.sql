-- ===========================================================================
-- KAYNAK SAĞLIĞI VE ALARMLAR
-- ---------------------------------------------------------------------------
-- ÇÖZÜLEN SOMUT PROBLEM
-- Denetimde ölçüldü: `ingest.yml` her 6 saatte bir çalışıyor ama
-- `ingest_runs` tablosunda TEK BİR SATIR yok. Yani alım hattı aylardır hiç
-- çalışmadı ve bunu kimse fark etmedi -- çünkü bakan hiçbir şey yoktu.
--
-- Sessiz başarısızlık, gürültülü başarısızlıktan pahalıdır: bozuk olduğunu
-- bilmediğin bir sistemi tamir edemezsin.
--
-- NE EKLENMİYOR
-- Yeni bir alım mimarisi, kuyruk ya da worker EKLENMİYOR. Değerlendirilen
-- alanların hepsi zaten mevcuttu (`sources.last_run_at`, `last_status`,
-- `last_item_count`, `products.last_seen_at`). Eksik olan tek şey onlara
-- BAKIP KARAR VEREN katmandı.
--
-- NE UYDURULMUYOR
-- Webhook, kuyruk ve worker HENÜZ YOK. Bu yüzden WEBHOOK_FAILURE,
-- QUEUE_BACKLOG, WORKER_FAILURE gibi alarmlar ÜRETİLMİYOR -- var olmayan
-- bir bileşenin sağlıklı ya da sağlıksız olduğunu bildirmek, izleme değil
-- izleme taklididir.
-- ===========================================================================

create type public.source_health_state as enum (
  'saglikli',      -- HEALTHY  — zamanında ve başarılı çalıştı
  'yavas',         -- DEGRADED — çalıştı ama kısmi/uyarılı
  'bayat',         -- STALE    — beklenen süredir çalışmadı
  'basarisiz',     -- FAILED   — son çalışma hata verdi
  'hic_calismadi'  -- NEVER RUN — hiç çalışmamış (sessiz kalınmayacak durum)
);

comment on type public.source_health_state is
  'Kaynak saglik durumu. hic_calismadi ayri bir durum: "henuz veri yok" ile '
  '"aylardir bozuk" ayni sey degildir.';

-- ---------------------------------------------------------------------------
-- Kaynak başına bayatlık eşiği
-- ---------------------------------------------------------------------------
-- Eşik kaynağa göre değişir: günde bir güncellenen bir feed ile saatte bir
-- güncellenen bir API aynı ölçüyle değerlendirilemez.
--
-- Varsayılan 720 dakika (12 saat): mevcut `schedule_cron` varsayılanı 6
-- saatte bir, yani iki ardışık çalışmanın kaçırılması bayatlık sayılır.
-- Tek bir çalışmanın gecikmesi alarm üretmez -- her geçici ağ hatasında
-- alarm çalan bir sistem, kısa sürede görmezden gelinir.
alter table public.sources
  add column max_staleness_minutes integer not null default 720
    check (max_staleness_minutes between 5 and 43200);

comment on column public.sources.max_staleness_minutes is
  'Bu kaynak kac dakika calismazsa bayat sayilir. Varsayilan 720 = iki '
  'ardisik 6 saatlik calismanin kacirilmasi.';

-- ---------------------------------------------------------------------------
-- source_health() — her etkin kaynağın durumu
-- ---------------------------------------------------------------------------
create or replace function public.source_health()
returns table (
  source_id       uuid,
  source_slug     text,
  merchant_slug   text,
  market          public.market,
  state           public.source_health_state,
  last_run_at     timestamptz,
  minutes_since_run numeric,
  max_staleness_minutes integer,
  last_item_count integer,
  last_error      text,
  run_count       bigint,
  detail          text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.slug::text,
    m.slug::text,
    s.market,
    case
      -- HİÇ ÇALIŞMADI en önce bakılır: sessiz kalınmaması gereken durum bu.
      when r.run_count = 0 then 'hic_calismadi'::public.source_health_state
      when s.last_status = 'failed' then 'basarisiz'::public.source_health_state
      when s.last_run_at is null
        or s.last_run_at < now() - make_interval(mins => s.max_staleness_minutes)
        then 'bayat'::public.source_health_state
      -- Başarılı ama BOŞ dönen bir feed sağlıklı değildir: katalog sessizce
      -- boşalır ve durum kodu bunu göstermez.
      when coalesce(s.last_item_count, 0) = 0 then 'yavas'::public.source_health_state
      when s.last_status = 'partial' then 'yavas'::public.source_health_state
      else 'saglikli'::public.source_health_state
    end,
    s.last_run_at,
    case when s.last_run_at is null then null
         else round(extract(epoch from (now() - s.last_run_at)) / 60.0, 1)
    end,
    s.max_staleness_minutes,
    s.last_item_count,
    s.last_error,
    r.run_count,
    case
      when r.run_count = 0 then 'Kaynak tanimli ama alim hatti hic calismadi.'
      when s.last_status = 'failed' then 'Son alim hata verdi.'
      when s.last_run_at is null
        or s.last_run_at < now() - make_interval(mins => s.max_staleness_minutes)
        then 'Beklenen surede calismadi.'
      when coalesce(s.last_item_count, 0) = 0 then 'Son alim bos dondu.'
      when s.last_status = 'partial' then 'Son alim kismi basarili.'
      else 'Zamaninda ve dolu.'
    end
  from public.sources s
  join public.merchants m on m.id = s.merchant_id
  cross join lateral (
    select count(*) as run_count
      from public.ingest_runs ir
     where ir.source_id = s.id
  ) r
  where s.is_enabled
  order by
    -- En kötü durum en üstte: panele bakan kişi önce bozuk olanı görsün.
    case
      when r.run_count = 0 then 0
      when s.last_status = 'failed' then 1
      when s.last_run_at is null
        or s.last_run_at < now() - make_interval(mins => s.max_staleness_minutes) then 2
      when coalesce(s.last_item_count, 0) = 0 then 3
      else 4
    end,
    s.slug;
$$;

comment on function public.source_health() is
  'Etkin kaynaklarin saglik durumu. Devre disi kaynak alarm uretmez; '
  'hic calismamis ETKIN kaynak uretir.';

-- ---------------------------------------------------------------------------
-- system_alerts() — sahibin görmesi gereken durumlar
-- ---------------------------------------------------------------------------
create or replace function public.system_alerts()
returns table (
  code      text,
  severity  text,
  subject   text,
  detail    text,
  observed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  /*
   * HİÇ ETKİN KAYNAK YOK.
   *
   * Bu, "her şey yolunda ama veri yok" değil: kaynak tanımlanmadan katalog
   * ASLA dolamaz. Sıfır ürünü bir başlangıç durumu sanıp beklemek, hiç
   * gelmeyecek bir şeyi beklemektir.
   */
  select
    'NO_ENABLED_SOURCE'::text,
    'critical'::text,
    'sources'::text,
    'Etkin kaynak yok. Kaynak tanimlanmadan katalog dolamaz.'::text,
    now()
  where not exists (select 1 from public.sources where is_enabled)

  union all

  -- Tanımlı ama hiç çalışmamış kaynak — §35'in tarif ettiği durum.
  select
    'INGESTION_NEVER_RAN'::text,
    'critical'::text,
    h.source_slug,
    h.detail,
    now()
  from public.source_health() h
  where h.state = 'hic_calismadi'

  union all

  select
    'SOURCE_FAILED'::text,
    'critical'::text,
    h.source_slug,
    coalesce(h.last_error, h.detail),
    coalesce(h.last_run_at, now())
  from public.source_health() h
  where h.state = 'basarisiz'

  union all

  select
    'SOURCE_STALE'::text,
    'warning'::text,
    h.source_slug,
    h.detail || ' (' || coalesce(h.minutes_since_run::text, '?') || ' dk once, esik '
      || h.max_staleness_minutes || ' dk)',
    coalesce(h.last_run_at, now())
  from public.source_health() h
  where h.state = 'bayat'

  union all

  select
    'EMPTY_FEED'::text,
    'warning'::text,
    h.source_slug,
    h.detail,
    coalesce(h.last_run_at, now())
  from public.source_health() h
  where h.state = 'yavas' and coalesce(h.last_item_count, 0) = 0

  union all

  /*
   * BAYAT TEKLİF ORANI.
   *
   * Teklifler var ama uzun süredir görülmediler: fiyatları artık
   * güvenilmez. Oran eşiği %25 -- birkaç teklifin kaybolması normaldir,
   * dörtte birinin kaybolması bir arıza işaretidir.
   */
  select
    'HIGH_STALE_OFFER_RATE'::text,
    'warning'::text,
    'products'::text,
    'Etkin tekliflerin %' || round(100.0 * t.bayat / nullif(t.toplam, 0))
      || '''i 48 saattir goruunmedi (' || t.bayat || '/' || t.toplam || ').',
    now()
  from (
    select
      count(*) as toplam,
      count(*) filter (where last_seen_at < now() - interval '48 hours') as bayat
    from public.products
    where status = 'active'
  ) t
  where t.toplam > 0 and (100.0 * t.bayat / t.toplam) >= 25;
$$;

comment on function public.system_alerts() is
  'Sahibin gormesi gereken durumlar. Var olmayan bilesenler (webhook, kuyruk, '
  'worker) icin alarm URETMEZ -- izleme taklidi yapilmaz.';

-- --- Erişim ----------------------------------------------------------------
-- İkisi de operasyonel iç bilgi: kaynak adları, hata metinleri ve katalog
-- sağlığı. İstemciye kapalı; sunucu tarafına açık grant.
revoke all on function public.source_health() from public;
revoke all on function public.source_health() from anon, authenticated;
grant execute on function public.source_health() to service_role;

revoke all on function public.system_alerts() from public;
revoke all on function public.system_alerts() from anon, authenticated;
grant execute on function public.system_alerts() to service_role;
