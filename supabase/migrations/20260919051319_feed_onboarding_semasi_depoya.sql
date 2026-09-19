-- ============================================================================
-- FEED ONBOARDING ŞEMASI — üretimde vardı, depoda yoktu
-- ============================================================================
-- ÖLÇÜLEN AYRIŞMA
-- Üretim ile temiz bir replay karşılaştırıldı: 645'e karşı 618 sütun. Fark
-- dağınık değildi, TEK bir konuda toplanıyordu:
--   * `program_feeds` tablosunun tamamı (18 sütun)
--   * `programs` üzerindeki 7 feed sütunu
--
-- Bu şema üretime birleştirilmemiş bir dalın göçleriyle girmiş; o dal main'e
-- hiç ulaşmadı. Sonuç: canlıda duran ama depoda karşılığı olmayan yapı.
--
-- NEDEN ÖNEMLİ
-- Depo üretimi anlatmıyorsa, "temiz kurulum canlıyla aynı mı" sorusu
-- cevapsız kalır ve sürüklenme ancak bir şey kırıldığında fark edilir. Bu
-- oturumda tam olarak bu yaşandı: elle tazelenmiş 5 eşleme kuralı depoda
-- yoktu ve fark yalnızca ölçüldüğü için görüldü.
--
-- NEDEN O DALDAN ALINMADI
-- O dalın dosyaları üretimin kayıtlı metniyle md5 bakımından TUTMUYOR (11/11
-- farklı) ve dal, depodaki 16 göçün farklı zaman damgalı kopyalarını da
-- taşıyor. Birleştirilseydi aynı DDL iki kez uygulanırdı. Bu yüzden şema
-- ÜRETİMİN CANLI KATALOĞUNDAN okunarak yeniden yazıldı -- tek yetkili kaynak.
--
-- ----------------------------------------------------------------------------
-- BU GÖÇ ÜRETİMDE HİÇBİR ŞEY DEĞİŞTİRMEZ
-- ----------------------------------------------------------------------------
-- Hepsi `if not exists`. Üretimde nesnelerin tamamı zaten var, göç no-op.
-- Temiz bir veritabanında ise eksik yapıyı kurar ve iki taraf eşitlenir.
-- ============================================================================

alter table public.programs
  add column if not exists network_feed_id       text,
  add column if not exists feed_url              text,
  add column if not exists feed_access           text default 'unverified',
  add column if not exists feed_last_updated_at  timestamptz,
  add column if not exists network_item_count    integer,
  add column if not exists feed_ingestable_count integer,
  add column if not exists feed_checked_at       timestamptz;

/*
 * KISITLAR AYRI EKLENİYOR: `add constraint if not exists` PostgreSQL'de yok,
 * bu yüzden katalog sorgulanıp yalnızca eksik olan ekleniyor. Kısıtsız
 * bırakmak, sırrı olan bir feed adresinin sessizce kaydedilebilmesi demekti.
 */
do $$
declare
  k record;
begin
  for k in
    select * from (values
      ('programs_feed_access_vocab',
       $ck$check (feed_access = any (array['unverified','credentials_required','unsupported_transport','manual_required','verified']))$ck$),
      ('programs_feed_count_needs_check_time',
       $ck$check ((feed_ingestable_count is null) = (feed_checked_at is null))$ck$),
      ('programs_feed_ingestable_non_negative',
       $ck$check (feed_ingestable_count is null or feed_ingestable_count >= 0)$ck$),
      -- Sır sızıntısı kapısı: uzun onaltılık dizi bir anahtar olabilir.
      ('programs_feed_url_no_secret',
       $ck$check (feed_url is null or feed_url !~ '[0-9a-f]{24,}')$ck$),
      ('programs_feed_url_placeholder',
       $ck$check (feed_url is null or feed_url !~ '/apikey/(?!\$\{)')$ck$),
      ('programs_network_feed_id_not_blank',
       $ck$check (network_feed_id is null or length(btrim(network_feed_id)) > 0)$ck$),
      -- "verified" demek, adresin gerçekten HTTPS olduğunu görmüş olmak demek.
      ('programs_verified_feed_needs_https',
       $ck$check (feed_access <> 'verified' or (feed_url is not null and feed_url like 'https://%'))$ck$)
    ) as t(ad, tanim)
  loop
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.programs'::regclass and conname = k.ad
    ) then
      execute format('alter table public.programs add constraint %I %s', k.ad, k.tanim);
    end if;
  end loop;
end $$;

create table if not exists public.program_feeds (
  id                   uuid primary key default gen_random_uuid(),
  program_id           uuid not null references public.programs (id) on delete cascade,
  network              text not null,
  network_feed_id      text not null,
  feed_name            text,
  region               char(2),
  language             text,
  network_item_count   integer,
  last_imported_at     timestamptz,
  measured_currency    char(3) references public.currencies (code),
  measured_item_count  integer,
  ingestable_count     integer,
  checked_at           timestamptz,
  feed_access          text not null default 'unverified',
  feed_url             text,
  is_primary           boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint program_feeds_access_vocab
    check (feed_access = any (array['unverified','credentials_required','unsupported_transport','manual_required','verified'])),
  constraint program_feeds_counts_non_negative
    check (coalesce(network_item_count,0) >= 0 and coalesce(measured_item_count,0) >= 0 and coalesce(ingestable_count,0) >= 0),
  constraint program_feeds_id_not_blank
    check (length(btrim(network_feed_id)) > 0),
  /*
   * ÖLÇÜM VARSA ZAMANI DA VAR. İkisini ayırmak, ne zaman ölçüldüğü bilinmeyen
   * bir sayıyı "güncel" sanmaya yol açardı.
   */
  constraint program_feeds_measure_needs_time
    check (((ingestable_count is null) and (measured_item_count is null)) = (checked_at is null)),
  constraint program_feeds_url_no_secret
    check (feed_url is null or feed_url !~ '[0-9a-f]{24,}'),
  constraint program_feeds_url_placeholder
    check (feed_url is null or feed_url !~ '/apikey/(?!\$\{)'),
  constraint program_feeds_verified_needs_https
    check (feed_access <> 'verified' or (feed_url is not null and feed_url like 'https://%'))
);

comment on table public.program_feeds is
  'Bir programin urun feedleri. programs uzerindeki feed_* sutunlari BIRINCIL '
  'feedin ozetidir ve tetikleyici ile senkron tutulur.';

create unique index if not exists program_feeds_unique
  on public.program_feeds (network, network_feed_id);
-- Program basina EN FAZLA bir birincil feed: ikisi olsaydi ozetin hangisini
-- yansittigi belirsiz kalirdi.
create unique index if not exists program_feeds_one_primary
  on public.program_feeds (program_id) where is_primary;
create index if not exists program_feeds_program_idx
  on public.program_feeds (program_id);

alter table public.program_feeds enable row level security;
revoke all on public.program_feeds from anon, authenticated;
grant select, insert, update, delete on public.program_feeds to service_role;

/*
 * ÖZET SENKRONU TETİKLEYİCİDE, UYGULAMADA DEĞİL.
 * Uygulamada olsaydı `programs.feed_*` ile `program_feeds` zamanla AYRIŞIRDI:
 * bir yazma yolu özeti günceller, diğeri unutur ve ikisi de "çalışıyor"
 * görünür.
 */
create or replace function public.tg_program_feeds_sync_primary()
returns trigger
language plpgsql
set search_path = 'public'
as $$
declare
  v_program uuid;
  f         record;
begin
  v_program := coalesce(new.program_id, old.program_id);

  select * into f
    from public.program_feeds
   where program_id = v_program and is_primary
   limit 1;

  if f is null then
    update public.programs
       set network_feed_id       = null,
           feed_url              = null,
           feed_access           = 'unverified',
           network_item_count    = null,
           feed_ingestable_count = null,
           feed_checked_at       = null,
           feed_last_updated_at  = null
     where id = v_program;
  else
    update public.programs
       set network_feed_id       = f.network_feed_id,
           feed_url              = f.feed_url,
           feed_access           = f.feed_access,
           network_item_count    = f.network_item_count,
           feed_ingestable_count = f.ingestable_count,
           feed_checked_at       = f.checked_at,
           feed_last_updated_at  = f.last_imported_at,
           feed_available        = true,
           currency              = coalesce(f.measured_currency, programs.currency)
     where id = v_program;
  end if;

  return null;
end;
$$;

drop trigger if exists program_feeds_set_updated_at on public.program_feeds;
create trigger program_feeds_set_updated_at
  before update on public.program_feeds
  for each row execute function public.tg_set_updated_at();

drop trigger if exists program_feeds_sync_primary on public.program_feeds;
create trigger program_feeds_sync_primary
  after insert or delete or update on public.program_feeds
  for each row execute function public.tg_program_feeds_sync_primary();

do $$
declare n int;
begin
  select count(*) into n from pg_attribute
   where attrelid='public.program_feeds'::regclass and attnum>0 and not attisdropped;
  if n <> 18 then
    raise exception 'BASARISIZ: program_feeds % sutun (18 olmaliydi)', n;
  end if;

  select count(*) into n from pg_attribute
   where attrelid='public.programs'::regclass and not attisdropped
     and attname in ('network_feed_id','feed_url','feed_access','feed_last_updated_at',
                     'network_item_count','feed_ingestable_count','feed_checked_at');
  if n <> 7 then
    raise exception 'BASARISIZ: programs uzerinde % feed sutunu (7 olmaliydi)', n;
  end if;

  -- Istemci bu tabloyu okuyamamali: feed adresleri rekabete acik bilgidir.
  if has_table_privilege('anon','public.program_feeds','select')
     or has_table_privilege('authenticated','public.program_feeds','select') then
    raise exception 'BASARISIZ: program_feeds istemciye acik';
  end if;

  raise notice 'feed onboarding semasi yerinde: program_feeds 18 sutun, programs 7 feed sutunu';
end $$;