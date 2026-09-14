-- ============================================================================
-- KEŞFEDİLEN ORTAKLIK PROGRAMLARI
--
-- ⚠️  ÜRETİMDE ÇALIŞTIRILMADI. Hazırlandı, incelemeye bırakıldı.
--
-- NEDEN AYRI TABLO
-- `merchants` bir ONAYLI ORTAK kaydıdır: tracking_id, deeplink şablonu,
-- komisyon, postback sırrı taşır. Keşfedilmiş ama henüz başvurulmamış --
-- belki hiç başvurulmayacak -- bir programı oraya yazmak iki şeyi birden
-- bozardı: katalog tarafı "mağaza" sanıp listelemeye çalışır, ve gerçek
-- ortaklarla adaylar aynı kümede karışır.
--
-- Aday ile ortak AYRI yaşam döngüleridir. Program onaylandığında
-- `merchant_id` doldurulur; bağ o anda kurulur, önce değil.
-- ============================================================================

create type public.program_state as enum (
  'discovered',     -- bulundu, henüz değerlendirilmedi
  'qualifying',     -- bilgi toplanıyor/normalize ediliyor
  'apply_ready',    -- başvuru taslağı hazır, İNSAN ONAYI bekliyor
  'applied',        -- başvuru gönderildi
  'pending',        -- ağ/mağaza tarafında inceleniyor
  'approved',       -- onaylandı (KANIT gerekir)
  'rejected',       -- reddedildi
  'integrating',    -- merchant/source kaydı kuruluyor
  'verifying',      -- tracking testi çalışıyor
  'active',         -- bütün kapılar geçti
  'blocked',        -- teknik/ticari engel
  'human_review'    -- karar insana ait
);

comment on type public.program_state is
  'Program yasam dongusu. Her deger bir KANITA karsilik gelir; '
  'tahmin icin deger yoktur -- bilinmiyorsa discovered kalir.';

create table if not exists public.affiliate_programs (
  id            uuid primary key default gen_random_uuid(),

  network_code  text not null references public.affiliate_networks (code),

  /*
   * Ağdaki program kimliği. Ağ + kimlik birlikte TEKİL: aynı programın
   * iki kez keşfedilmesi bu kısıt sayesinde satır değil çakışma üretir.
   * Yinelenme engelleme veritabanında, uygulamada değil.
   */
  external_id   text not null,

  advertiser_name text not null,
  homepage_url    text,

  /*
   * Programın geçerli olduğu pazarlar. Dizi, çünkü bir program birden çok
   * pazarda açık olabilir ve pazar başına ayrı satır, aynı programın
   * kopyalarını üretirdi.
   */
  market_codes  text[] not null default '{}',

  /* Kategoriler serbest metin DEĞİL: katalog taksonomisine bağlanır. */
  category_ids  uuid[] not null default '{}',

  commission_rate     numeric(5,4) check (commission_rate >= 0 and commission_rate <= 0.9),
  cookie_window_days  integer check (cookie_window_days > 0),

  /*
   * Ürün beslemesi var mı? NULL = BİLİNMİYOR.
   * false ile NULL ayrı: "feed yok" ile "bakmadık" aynı şey değil ve
   * ikisini karıştırmak, bakılmamış programı elemeye yol açardı.
   */
  feed_available    boolean,
  api_available     boolean,
  tracking_method   text,

  /* Başvuru için ne isteniyor -- serbest metin, normalize edilmemiş kayıt. */
  application_requirements text,

  state         public.program_state not null default 'discovered',

  /*
   * Nitelik ve risk. 0-100 arası; NULL = henüz puanlanmadı.
   * Puan bir KARAR DEĞİL girdi: eşiği insan belirler.
   */
  quality_score integer check (quality_score between 0 and 100),
  risk_notes    text,

  /* Onaylandığında kurulan bağ. Öncesinde NULL. */
  merchant_id   uuid references public.merchants (id) on delete set null,

  discovered_at timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint affiliate_programs_ag_kimlik_tekil unique (network_code, external_id)
);

comment on table public.affiliate_programs is
  'Kesfedilmis ortaklik programi ADAYI. merchants ONAYLI ortaktir; '
  'bu tablo adaydir. Bag, onay aninda merchant_id ile kurulur.';

create index if not exists affiliate_programs_state_idx
  on public.affiliate_programs (state, discovered_at desc);

create index if not exists affiliate_programs_network_idx
  on public.affiliate_programs (network_code);

alter table public.affiliate_programs enable row level security;

/*
 * TİCARİ İSTİHBARAT: herkese açık DEĞİL. Hangi programları keşfettiğimiz,
 * hangisine başvurduğumuz ve komisyon oranları rakip için doğrudan
 * değerlidir. Yalnızca yönetim.
 */
drop policy if exists affiliate_programs_admin_all on public.affiliate_programs;
create policy affiliate_programs_admin_all
  on public.affiliate_programs for all
  using (public.is_admin()) with check (public.is_admin());

grant select on public.affiliate_programs to authenticated;

create trigger affiliate_programs_set_updated_at
  before update on public.affiliate_programs
  for each row execute function public.tg_set_updated_at();


-- ---------------------------------------------------------------------------
-- DENETİM İZİ — her karar kaydedilir
-- ---------------------------------------------------------------------------
create table if not exists public.affiliate_program_events (
  id           bigint generated always as identity primary key,
  program_id   uuid not null references public.affiliate_programs (id) on delete cascade,

  action       text not null,
  previous_state public.program_state,
  new_state     public.program_state,

  /*
   * Kararı kim verdi? Otomatik mi insan mı -- bu ayrım denetimin
   * kendisidir. Hukuki/finansal adımların otomatik olmadığını burada
   * kanıtlarız.
   */
  actor        text not null check (actor in ('agent', 'human')),
  actor_id     text,

  result       text not null check (result in ('ok', 'error', 'blocked', 'needs_human')),
  reason       text,
  error_code   text,

  at           timestamptz not null default now()
);

comment on table public.affiliate_program_events is
  'Program karar izi. SIR VE PII YAZILMAZ -- yalnizca durum, gerekce ve '
  'hata kodu. Sifre, API anahtari, banka/vergi/kimlik bilgisi buraya '
  'girmemelidir.';

create index if not exists affiliate_program_events_program_idx
  on public.affiliate_program_events (program_id, at desc);

alter table public.affiliate_program_events enable row level security;

drop policy if exists affiliate_program_events_admin_all on public.affiliate_program_events;
create policy affiliate_program_events_admin_all
  on public.affiliate_program_events for all
  using (public.is_admin()) with check (public.is_admin());

grant select on public.affiliate_program_events to authenticated;

-- ---------------------------------------------------------------------------
-- GERİ ALMA
-- ---------------------------------------------------------------------------
-- drop table if exists public.affiliate_program_events;
-- drop table if exists public.affiliate_programs;
-- drop type  if exists public.program_state;
