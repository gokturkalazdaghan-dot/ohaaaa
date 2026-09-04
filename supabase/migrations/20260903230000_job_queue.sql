-- ===========================================================================
-- KALICI İŞ KUYRUĞU
-- ---------------------------------------------------------------------------
-- NE ZATEN VAR, NE YOK
-- `politeClient.ts` içinde üstel geri çekilme, jitter ve devre kesici ZATEN
-- var -- ama SÜREÇ İÇİ. Süreç yeniden başlayınca hepsi sıfırlanır ve yarım
-- kalmış iş kaybolur. GitHub Actions gibi her çalışmada yeniden başlayan
-- bir ortamda bu, "işin kaybolduğunu kimsenin bilmemesi" demektir.
--
-- Eksik olan devre kesici ya da retry DEĞİL; onların KALICI hâli.
--
-- NEDEN VERİTABANI KUYRUĞU
-- Ayrı bir kuyruk servisi (Redis, SQS) bir bağımlılık daha, bir hata
-- kaynağı daha ve bir tutarlılık sınırı daha demek: iş kuyrukta ama veri
-- veritabanında olduğunda ikisi ayrışabilir. Postgres'te `for update skip
-- locked` ile kuyruk, veriyle AYNI işlemde güncellenebiliyor -- yani bir
-- işin tamamlanması ile sonucunun yazılması atomik olabiliyor.
--
-- Ölçek sınırı dürüstçe: bu tasarım saniyede binlerce iş için değil. Bu
-- ölçeğe gelindiğinde ayrı bir kuyruk gerekir; şimdi gereksiz karmaşıklık.
-- ===========================================================================

create type public.job_status as enum (
  'bekliyor',      -- PENDING
  'calisiyor',     -- RUNNING
  'yeniden',       -- RETRYING (bir sonraki denemeyi bekliyor)
  'tamamlandi',    -- COMPLETED
  'basarisiz',     -- FAILED (kalıcı hata, retry edilmeyecek)
  'olu_mektup',    -- DEAD_LETTER (deneme hakkı bitti)
  'iptal'          -- CANCELLED
);

create type public.job_priority as enum (
  'kritik',   -- CRITICAL — kullanıcı bekliyor ya da para riski var
  'yuksek',   -- HIGH     — fiyat/stok değişimi
  'normal',   -- NORMAL   — planlı katalog yenileme
  'dusuk'     -- LOW      — soğuk katalog
);

comment on type public.job_priority is
  'Is onceligi. Siralama enum sirasina gore: kritik > yuksek > normal > dusuk.';

create table public.jobs (
  id            uuid primary key default gen_random_uuid(),

  kind          text not null,
  priority      public.job_priority not null default 'normal',
  status        public.job_status not null default 'bekliyor',

  -- İşin hangi pazara ait olduğu. Pazar sızıntısı kuyrukta da olmamalı:
  -- bir Alman yenileme işi Türk kataloğunu güncellememeli.
  market        public.market,
  source_id     uuid references public.sources (id) on delete cascade,

  payload       jsonb not null default '{}'::jsonb,

  /*
   * AYNI İŞ İKİ KEZ KUYRUĞA GİRMEZ.
   *
   * Webhook'lar tekrar gönderilir, cron'lar üst üste binebilir, bir feed
   * aynı değişikliği iki kez bildirebilir. Anahtar benzersiz olmasaydı
   * aynı fiyat iki kez yazılır, aynı dönüşüm iki kez sayılırdı.
   *
   * NULL'a izin var: her işin doğal bir anahtarı olmayabilir. Postgres'te
   * NULL'lar benzersizlik kısıtını tetiklemez, bu yüzden anahtarsız işler
   * serbestçe eklenebilir.
   */
  idempotency_key text unique,

  attempt       integer not null default 0 check (attempt >= 0),
  max_attempts  integer not null default 5 check (max_attempts between 1 and 50),

  -- Bu andan ÖNCE alınamaz. Geri çekilme bununla uygulanır.
  available_at  timestamptz not null default now(),

  started_at    timestamptz,
  completed_at  timestamptz,
  failed_at     timestamptz,
  last_error    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Tamamlanan/başarısız bir işin bitiş damgası olmalı; olmayanın olmamalı.
  constraint jobs_bitis_damgasi check (
    (status = 'tamamlandi') = (completed_at is not null)
  )
);

/*
 * ALIM SIRASININ İNDEKSİ.
 *
 * `where status in ('bekliyor','yeniden')` kısmi indeksi kasıtlı: kuyruk
 * büyüdükçe tamamlanmış işler çoğunlukta olur ve onları indekste tutmak
 * hem yeri hem de tarama maliyetini boşa harcar. Alınabilir işler her
 * zaman azınlıktadır.
 */
create index jobs_alim_idx
  on public.jobs (priority, available_at, created_at)
  where status in ('bekliyor', 'yeniden');

create index jobs_source_idx on public.jobs (source_id) where source_id is not null;
create index jobs_kind_status_idx on public.jobs (kind, status);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.tg_set_updated_at();

comment on table public.jobs is
  'Kalici is kuyrugu. politeClient icindeki surec-ici retry/devre kesiciyi '
  'DEGISTIRMEZ; surec yeniden baslayinca hayatta kalan katmani ekler.';

-- ---------------------------------------------------------------------------
-- enqueue_job() — iş ekle (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_job(
  p_kind            text,
  p_priority        public.job_priority default 'normal',
  p_payload         jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_market          public.market default null,
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
    (kind, priority, payload, idempotency_key, market, source_id,
     available_at, max_attempts)
  values
    (p_kind, p_priority, p_payload, p_idempotency_key, p_market, p_source_id,
     coalesce(p_available_at, now()), p_max_attempts)
  -- Aynı anahtar yeniden gelirse SESSİZCE yok sayılır ve mevcut işin
  -- kimliği döner. Hata fırlatmak, tekrar gönderilen bir webhook'u
  -- başarısız saymak olurdu -- oysa doğru davranış "zaten kuyrukta".
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null and p_idempotency_key is not null then
    select id into v_id from public.jobs where idempotency_key = p_idempotency_key;
  end if;

  return v_id;
end;
$$;

comment on function public.enqueue_job is
  'Is ekler. Ayni idempotency_key ile ikinci cagri YENI is yaratmaz, '
  'mevcut isin kimligini doner.';

-- ---------------------------------------------------------------------------
-- claim_jobs() — çalıştırılacak işleri kilitle ve al
-- ---------------------------------------------------------------------------
create or replace function public.claim_jobs(
  p_limit integer default 10,
  p_kind  text default null
)
returns setof public.jobs
language sql
security definer
set search_path = ''
as $$
  /*
   * `for update skip locked` KUYRUĞUN KALBİ.
   *
   * İki worker aynı anda çalıştığında ikisi de aynı satırı almaya çalışır.
   * Kilitli satırı ATLAYARAK ilerlemek, beklemeden farklı işler almaları
   * demektir. `skip locked` olmasaydı ikinci worker birincinin işini
   * bitirmesini bekler ve paralellik kaybolurdu.
   */
  /*
   * DÖNÜŞ SIRASI DA ÖNCELİKLİ.
   *
   * İlk hâli düz `update ... returning` idi ve test yakaladı: doğru işler
   * alınıyordu ama DÖNÜŞ SIRASI rastgeleydi -- Postgres `returning`
   * satırlarını alt sorgunun `order by`'ına göre vermez. Sırayla işleyen
   * bir worker, aldığı parti içinde önceliği kaybederdi: kritik iş
   * düşük öncelikli işin arkasında kalabilirdi.
   *
   * CTE ile alım ve sıralama ayrılıyor.
   */
  with alinan as (
    update public.jobs j
       set status = 'calisiyor',
           started_at = now(),
           attempt = j.attempt + 1
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

comment on function public.claim_jobs is
  'Calistirilacak isleri kilitleyerek alir. skip locked ile paralel '
  'workerlar birbirini beklemez.';

-- ---------------------------------------------------------------------------
-- complete_job() / fail_job()
-- ---------------------------------------------------------------------------
create or replace function public.complete_job(p_job_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.jobs
     set status = 'tamamlandi', completed_at = now(), last_error = null
   where id = p_job_id and status = 'calisiyor'
  returning true;
$$;

create or replace function public.fail_job(
  p_job_id    uuid,
  p_error     text,
  -- Kalıcı hata YENİDEN DENENMEZ. 404 dönen bir adresi beş kez denemek,
  -- kaynağı boşuna yormak ve kuyruğu tıkamaktır.
  p_permanent boolean default false
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.jobs;
  v_gecikme interval;
  v_yeni public.job_status;
begin
  select * into v from public.jobs where id = p_job_id for update;
  if not found then return null; end if;

  if p_permanent then
    v_yeni := 'basarisiz';
  elsif v.attempt >= v.max_attempts then
    -- Deneme hakkı bitti: iş SİLİNMİYOR, ölü mektup kutusuna düşüyor.
    -- Silmek, neyin neden başarısız olduğunu sonsuza dek kaybetmek olurdu.
    v_yeni := 'olu_mektup';
  else
    v_yeni := 'yeniden';
  end if;

  /*
   * ÜSTEL GERİ ÇEKİLME + JITTER.
   *
   * 2^attempt saniye, 1 saatte sınırlı. Jitter (%0-25 rastgele ek) aynı
   * anda başarısız olan işlerin aynı anda yeniden denemesini engeller --
   * aksi halde çöken bir kaynağa toparlandığı anda hepsi birden vurur ve
   * tekrar düşürür.
   */
  v_gecikme := least(
    make_interval(secs => power(2, least(v.attempt, 12))::double precision),
    interval '1 hour'
  );
  v_gecikme := v_gecikme + (v_gecikme * (random() * 0.25));

  update public.jobs
     set status = v_yeni,
         last_error = p_error,
         failed_at = now(),
         available_at = case when v_yeni = 'yeniden' then now() + v_gecikme
                             else available_at end
   where id = p_job_id;

  return v_yeni;
end;
$$;

comment on function public.fail_job is
  'Isi basarisiz isaretler. Gecici hatada ustel geri cekilme + jitter ile '
  'yeniden planlar; kalici hatada denemez; hak bitince olu mektup.';

-- --- Erişim ----------------------------------------------------------------
-- Kuyruk tamamen sunucu tarafı: payload iç bilgi taşır (kaynak adları,
-- hata metinleri), ve istemcinin iş ekleyebilmesi kuyruk zehirleme yolu
-- olurdu.
alter table public.jobs enable row level security;
revoke all on public.jobs from anon, authenticated;

revoke all on function public.enqueue_job(text, public.job_priority, jsonb, text, public.market, uuid, timestamptz, integer) from public;
revoke all on function public.claim_jobs(integer, text) from public;
revoke all on function public.complete_job(uuid) from public;
revoke all on function public.fail_job(uuid, text, boolean) from public;

grant execute on function public.enqueue_job(text, public.job_priority, jsonb, text, public.market, uuid, timestamptz, integer) to service_role;
grant execute on function public.claim_jobs(integer, text) to service_role;
grant execute on function public.complete_job(uuid) to service_role;
grant execute on function public.fail_job(uuid, text, boolean) to service_role;
