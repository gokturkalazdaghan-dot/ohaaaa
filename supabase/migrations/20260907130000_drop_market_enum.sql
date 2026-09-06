-- ===========================================================================
-- M4 — public.market ENUM'U DUSURULUYOR
-- ===========================================================================
--
-- Genisleme/daralma dizisinin son adimi:
--   M1  referans tablolari              (ekleyici)
--   M2  yabanci anahtarlar + ayrisma    (ekleyici + iki kisit dusuruldu)
--   M3  market_code sutunlari + backfill (kopru: iki yol da acik)
--   KOD DAGITIMI                         (yeni yol kullaniliyor)
--   M4  eski yolun kapatilmasi           <-- bu goc
--
-- M3 bilerek geri alinabilir birakilmisti: kod dagitimi sorun cikarsaydi
-- eski enum yolu hala ayaktaydi. Dagitim yapildi; kopru artik yuk tasimiyor
-- ve iki kaynakli bir semayi acik tutmak, ikisinin ayrisması demek.
--
-- NEDEN ENUM DUSURULUYOR
-- `public.market` yalnizca TR/DE/US tasiyordu ve 'DE' bir PAZAR degil bir
-- ULKE idi -- modelin duzeltmeye calistigi kavram hatasi tipin kendisinde
-- gomuluydu. PostgreSQL enum degeri SILMEDIGI icin bu etiket, tip yasadigi
-- surece semada kalirdi.
--
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. KAPI — bu goc ILK ALIMDAN ONCE calismak zorunda
-- ---------------------------------------------------------------------------
--
-- market_code NOT NULL yapmak ve enum sutunlarini dusurmek, veri varken
-- geri donusu olmayan islemler. M3'un backfill'i olculmus ve dogrulanmis
-- OLMADAN bu goc calisirsa, yanlis pazara yazilmis bir satiri geri getirecek
-- kaynak kalmaz. Bos tablo, backfill'in dogrulanmasi gerekmeyen tek durum.
do $$
declare
  v_products     bigint;
  v_price_points bigint;
  v_sources      bigint;
begin
  select count(*) into v_products     from public.products;
  select count(*) into v_price_points from public.price_points;
  select count(*) into v_sources      from public.sources;

  if v_products <> 0 or v_price_points <> 0 or v_sources <> 0 then
    raise exception
      'M4 IPTAL: bu goc ilk alimdan ONCE calismalidir (products=%, price_points=%, sources=%).',
      v_products, v_price_points, v_sources
      using hint =
        'Veri varken market_code NOT NULL yapmak ve enum sutunlarini dusurmek '
        'geri alinamaz. Once her satirin market_code degeri tek tek dogrulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. TIPE BAGLI FONKSIYONLAR DUSURULUYOR
-- ---------------------------------------------------------------------------
--
-- `create or replace` YETMEZ: ucunun de DONUS ya da PARAMETRE tipi
-- degisiyor ve PostgreSQL bunu replace ile kabul etmez. Drop + create
-- zorunlu; ayni islemde yeniden yaratildiklari icin disariya kesinti
-- gorunmuyor.
--
-- Sira onemli: schedule_due_sources plpgsql oldugu icin due_sources'a
-- KATALOG BAGI YOK (gec baglama), ama govdesinde `v.market` geciyor --
-- yani duzeltilmezse ilk cagrida "record has no field market" ile patlardi.
-- Sessiz kalmamasi icin o da bu listede.
drop function public.schedule_due_sources(integer);
drop function public.due_sources(integer);
drop function public.source_health();
drop function public.enqueue_job(
  text, public.job_priority, jsonb, text, public.market, uuid, timestamptz, integer
);

-- market_currency() bir esleme degil bir VARSAYIMDI: "bir pazar = bir para
-- birimi". M2 o varsayimi curuttu (NORDICS bes ulkede dort, GCC alti ulkede
-- alti para birimi) ve fonksiyonu kullanan iki kisiti dusurdu. Geriye
-- cagirani olmayan bir fonksiyon kaldi; tutmak, curutulmus varsayimi
-- semada canli tutmak olurdu.
drop function public.market_currency(public.market);

-- ---------------------------------------------------------------------------
-- 2. ESKI SUTUNLAR DUSURULUYOR
-- ---------------------------------------------------------------------------
--
-- Uc indeks (products_market_status_idx, products_price_freshness_idx,
-- sources_market_idx) bu sutunlara bagli ve sutunla birlikte kendiliginden
-- dusuyor. M3 ucunun de market_code karsiligini zaten yaratmisti; bu yuzden
-- arada indekssiz kalan bir an YOK.
--
-- `if exists` bilerek kullanilmadi: sutunlarin varligi bu gocun on kosulu.
-- Yoksa sema olculdugumuz sema degil demektir ve gocun sessizce basarili
-- sayilmasi, sonraki dogrulamalari yanilgiya surukler.
alter table public.sources  drop column market;
alter table public.products drop column market;
alter table public.jobs     drop column market;

-- ---------------------------------------------------------------------------
-- 3. market_code ZORUNLU HALE GETIRILIYOR
-- ---------------------------------------------------------------------------
--
-- Eski sutunlarin nullability'si birebir korunuyor:
--   sources.market   NOT NULL  ->  sources.market_code   NOT NULL
--   products.market  NOT NULL  ->  products.market_code  NOT NULL
--   jobs.market      NULL'lu   ->  jobs.market_code      NULL'lu kaliyor
--
-- jobs icin bu bir gozden kacma degil: her is bir pazara ait degildir
-- (ornegin butun katalogu tarayan bir bakim isi). enqueue_job'un
-- p_market_code varsayilani da bu yuzden null.
--
-- VARSAYILAN DEGER VERILMIYOR. Eski sutunlarin `default 'TR'` degeri vardi
-- ve tam olarak bu, M3'te duzeltilen hatanin kaynagiydi: pazarini
-- soylemeyen bir yazar sessizce Turkiye pazarina yaziliyordu. Artik
-- soylemeyen yazar HATA ALIR.
alter table public.sources  alter column market_code set not null;
alter table public.products alter column market_code set not null;

-- ---------------------------------------------------------------------------
-- 4. FONKSIYONLAR METIN IMZASIYLA YENIDEN YARATILIYOR
-- ---------------------------------------------------------------------------
--
-- Govdeler DEGISMEDI; yalnizca `market public.market` -> `market_code text`
-- ve `s.market` -> `s.market_code`. Davranis farki yok, tip farki var.

create function public.enqueue_job(
  p_kind            text,
  p_priority        public.job_priority default 'normal',
  p_payload         jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_market_code     text default null,
  p_source_id       uuid default null,
  p_available_at    timestamptz default null,
  p_max_attempts    integer default 5
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.jobs
    (kind, priority, payload, idempotency_key, market_code, source_id,
     available_at, max_attempts)
  values
    (p_kind, p_priority, p_payload, p_idempotency_key, p_market_code, p_source_id,
     coalesce(p_available_at, now()), p_max_attempts)
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  -- Idempotency: ayni anahtarla ikinci cagri YENI is acmaz, var olanin
  -- kimligini dondurur. Sessiz null donmek, cagirani "is acilmadi" sanip
  -- tekrar denemeye iterdi.
  if v_id is null and p_idempotency_key is not null then
    select id into v_id from public.jobs where idempotency_key = p_idempotency_key;
  end if;

  return v_id;
end;
$$;

create function public.source_health()
returns table (
  source_id       uuid,
  source_slug     text,
  merchant_slug   text,
  market_code     text,
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
    s.market_code,
    case
      -- HIC CALISMADI en once bakilir: sessiz kalinmamasi gereken durum bu.
      when r.run_count = 0 then 'hic_calismadi'::public.source_health_state
      when s.last_status = 'failed' then 'basarisiz'::public.source_health_state
      when s.last_run_at is null
        or s.last_run_at < now() - make_interval(mins => s.max_staleness_minutes)
        then 'bayat'::public.source_health_state
      -- Basarili ama BOS donen bir feed saglikli degildir: katalog sessizce
      -- bosalir ve durum kodu bunu gostermez.
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
    -- En kotu durum en ustte: panele bakan kisi once bozuk olani gorsun.
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

create function public.due_sources(p_limit integer default 100)
returns table (
  source_id       uuid,
  slug            text,
  market_code     text,
  next_refresh_at timestamptz,
  reason          text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.slug::text,
    s.market_code,
    s.next_refresh_at,
    case when s.next_refresh_at is null then 'plan_yok_ilk_calisma'
         else 'plan_zamani_geldi' end
  from public.sources s
  where s.is_enabled
    and (s.next_refresh_at is null or s.next_refresh_at <= now())
    /*
     * DEVRE ACIKSA KAYNAK ADAY DEGIL.
     *
     * `breaker_allows()` cagrilmiyor cunku o fonksiyon DURUM DEGISTIRIYOR
     * (acik -> yari acik). Bir secim sorgusunun yan etkisi olmamali; gecisi
     * worker yapiyor, burada yalnizca okunuyor.
     */
    and not exists (
      select 1 from public.source_breakers b
       where b.source_id = s.id
         and b.state = 'acik'
         and (b.half_open_at is null or b.half_open_at > now())
    )
  order by
    -- Hic calismamislar once: onlarin gecikmesi en gorunur olan.
    (s.next_refresh_at is null) desc,
    s.next_refresh_at nulls first
  limit greatest(1, least(p_limit, 500));
$$;

create function public.schedule_due_sources(p_limit integer default 100)
returns table (source_id uuid, job_id uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_job uuid;
begin
  for v in select * from public.due_sources(p_limit) loop
    -- Acik bir is varsa atla: ayni feed'e eszamanli iki alim, ayni satirlari
    -- iki kez yazmak ve delta'yi anlamsizlastirmak demek.
    if exists (
      select 1 from public.jobs j
       where j.kind = 'SOURCE_SYNC'
         and j.source_id = v.source_id
         and j.status in ('bekliyor', 'yeniden', 'calisiyor')
    ) then
      continue;
    end if;

    v_job := public.enqueue_job(
      'SOURCE_SYNC',
      'normal',
      jsonb_build_object('source_id', v.source_id),
      -- Anahtar plan zamanini icerir: yalnizca kaynak kimligi olsaydi, is
      -- tamamlandiktan sonra da kayitta kalir ve o kaynak BIR DAHA hic
      -- kuyruga alinamazdi.
      'source_sync:' || v.source_id::text || ':' ||
        coalesce(v.next_refresh_at::text, 'ilk'),
      v.market_code,
      v.source_id
    );

    if v_job is not null then
      source_id := v.source_id;
      job_id := v_job;
      reason := v.reason;
      return next;
    end if;
  end loop;
end;
$$;

comment on function public.source_health() is
  'Etkin kaynaklarin saglik durumu. Devre disi kaynak alarm uretmez; '
  'hic calismamis ETKIN kaynak uretir.';

comment on function public.due_sources is
  'Calismasi gereken kaynaklar. NULL next_refresh_at de due sayilir: hic '
  'calismamis bir kaynagi beklemek onu hic calistirmamaktir.';

comment on function public.schedule_due_sources is
  'Due kaynaklar icin SOURCE_SYNC isi acar. Ayni kaynak icin acik bir is '
  'varsa yenisi acilmaz; idempotency anahtari plan zamanini icerir.';

-- ---------------------------------------------------------------------------
-- 5. YETKILER — DROP ILE BIRLIKTE SILINEN ACL YENIDEN KURULUYOR
-- ---------------------------------------------------------------------------
--
-- Bir fonksiyon dusuruldugunde ACL'i de gider ve yeni fonksiyon PostgreSQL
-- varsayilaniyla dogar: `execute` HERKESE acik. Yani bu blok bir konfor
-- degil, KAPATMA islemidir -- atlanirsa anon rolu kuyruga is ekleyebilirdi.
revoke all on function public.enqueue_job(
  text, public.job_priority, jsonb, text, text, uuid, timestamptz, integer
) from public;
revoke all on function public.source_health() from public;
revoke all on function public.due_sources(integer) from public;
revoke all on function public.schedule_due_sources(integer) from public;

grant execute on function public.enqueue_job(
  text, public.job_priority, jsonb, text, text, uuid, timestamptz, integer
) to service_role;
grant execute on function public.source_health() to service_role;
grant execute on function public.due_sources(integer) to service_role;
grant execute on function public.schedule_due_sources(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. TIP DUSURULUYOR
-- ---------------------------------------------------------------------------
--
-- `restrict` (varsayilan) bilerek: geride tek bir bagimli kalmissa bu satir
-- DUSER ve tum goc geri alinir. `cascade` yazmak, gormedigimiz bir bagimliyi
-- sessizce silmek olurdu.
drop type public.market;

-- ---------------------------------------------------------------------------
-- 7. GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_sayi integer;
begin
  -- 1) Tip gercekten yok.
  if exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
              where n.nspname = 'public' and t.typname = 'market') then
    raise exception 'DOGRULAMA 1: public.market tipi hala duruyor.';
  end if;

  -- 2) Uc tabloda da eski sutun yok.
  select count(*) into v_sayi
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relname in ('sources','products','jobs')
     and a.attname = 'market' and a.attnum > 0 and not a.attisdropped;
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 2: % adet eski market sutunu kaldi.', v_sayi;
  end if;

  -- 3) market_code zorunlulugu tam olarak iki tabloda.
  select count(*) into v_sayi
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relname in ('sources','products')
     and a.attname = 'market_code' and a.attnotnull;
  if v_sayi <> 2 then
    raise exception 'DOGRULAMA 3: market_code NOT NULL beklenen 2, bulunan %.', v_sayi;
  end if;

  -- 4) jobs.market_code BILEREK null kabul ediyor -- yanlislikla
  --    sikilastirilmadigini kanitlar.
  if exists (
    select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname='jobs'
       and a.attname='market_code' and a.attnotnull
  ) then
    raise exception 'DOGRULAMA 4: jobs.market_code NOT NULL yapilmis; her is bir pazara ait degildir.';
  end if;

  -- 5) Dort fonksiyon da var ve HICBIRI public'e acik degil.
  select count(*) into v_sayi
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public'
     and p.proname in ('enqueue_job','source_health','due_sources','schedule_due_sources');
  if v_sayi <> 4 then
    raise exception 'DOGRULAMA 5a: beklenen 4 fonksiyon, bulunan %.', v_sayi;
  end if;

  -- PUBLIC bir ROL DEGIL, bir sozde-alicidir: has_function_privilege ona
  -- sorulamaz. ACL'e dogrudan bakiliyor. proacl NULL ise varsayilan ACL
  -- gecerlidir ve o varsayilan PUBLIC'e execute VERIR -- yani NULL, "yetki
  -- yok" degil "yetki herkeste" demektir.
  select count(*) into v_sayi
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public'
     and p.proname in ('enqueue_job','source_health','due_sources','schedule_due_sources')
     and (p.proacl is null
          or exists (select 1 from unnest(p.proacl) a where a::text like '=%'));
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 5b: % fonksiyon PUBLIC''e acik kalmis.', v_sayi;
  end if;

  -- 5c) Istemci rolleri (anon, authenticated) hicbirine erisemiyor.
  select count(*) into v_sayi
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) as r(rol)
   where n.nspname='public'
     and p.proname in ('enqueue_job','source_health','due_sources','schedule_due_sources')
     and has_function_privilege(r.rol, p.oid, 'execute');
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 5c: istemci rolu % fonksiyona erisebiliyor.', v_sayi;
  end if;

  -- 6) service_role dordune de erisebiliyor -- 5b'nin fazla kapatmadigini
  --    kanitlar. Kapatma dogrulamasi tek basina, her seyi kapatan bir gocu
  --    de "gecirir".
  select count(*) into v_sayi
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public'
     and p.proname in ('enqueue_job','source_health','due_sources','schedule_due_sources')
     and has_function_privilege('service_role', p.oid, 'execute');
  if v_sayi <> 4 then
    raise exception 'DOGRULAMA 6: service_role beklenen 4 fonksiyona degil % tanesine erisiyor.', v_sayi;
  end if;

  -- 7) Dordu de search_path pinli (89 numarali gocun kurdugu kural).
  select count(*) into v_sayi
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public'
     and p.proname in ('enqueue_job','source_health','due_sources','schedule_due_sources')
     and p.proconfig is not null
     and array_to_string(p.proconfig, ',') like 'search_path=%';
  if v_sayi <> 4 then
    raise exception 'DOGRULAMA 7: search_path pinli beklenen 4, bulunan %.', v_sayi;
  end if;

  raise notice 'M4 dogrulandi: public.market dusuruldu, dort fonksiyon metin imzasiyla ayakta.';
end $$;
