-- ============================================================================
-- OHAAAA · 005 — Affiliate / Agregatör Modeli
-- ----------------------------------------------------------------------------
-- Platform iki gelir modelini AYNI ANDA taşır:
--
--   A) marketplace : Taşeron kendi ürününü satar, sipariş bizde oluşur,
--                    biz komisyon keseriz.  (mevcut vendors/orders akışı)
--   B) affiliate   : Ürün başka bir mağazada satılır, kullanıcıyı oraya
--                    yönlendiririz, satış gerçekleşirse komisyon alırız.
--
-- İkisi de aynı `products` tablosunda "teklif" (offer) olarak yaşar; çünkü
-- fiyat karşılaştırma motoru açısından ikisi de aynı şeydir: bir kanonik
-- ürüne verilmiş bir fiyat. Ayrım `fulfillment` kolonundadır.
--
-- Bu, iki ayrı katalog tutmaktan çok daha basittir: arama, karşılaştırma ve
-- ürün sayfası tek kod yolunu kullanmaya devam eder.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enum'lar
-- ---------------------------------------------------------------------------
create type public.fulfillment_kind as enum ('marketplace', 'affiliate');

create type public.merchant_status as enum (
  'prospect',   -- ortaklık başvurusu yapılmadı
  'pending',    -- başvuru yapıldı, onay bekleniyor
  'active',     -- onaylı, komisyon kazanılabilir
  'paused',     -- geçici durduruldu
  'terminated'  -- ortaklık sonlandırıldı
);

-- Veri kaynağının TÜRÜ. Her tür farklı bir adaptörle işlenir.
create type public.source_kind as enum (
  'feed_csv',   -- ortaklık ağının CSV ürün feed'i
  'feed_xml',   -- XML/RSS ürün feed'i (Google Merchant biçimi dahil)
  'feed_json',  -- JSON feed
  'api',        -- resmî ürün API'si (ör. Amazon PA-API)
  'sitemap',    -- yayıncının izin verdiği sitemap taraması
  'manual'      -- elle girilen ürünler
);

create type public.ingest_status as enum ('running', 'success', 'partial', 'failed');

create type public.conversion_status as enum (
  'pending',   -- ağ bildirdi, onay bekliyor (iade süresi)
  'approved',  -- onaylandı, komisyon hak edildi
  'rejected',  -- iptal/iade edildi
  'paid'       -- ödemesi yapıldı
);

-- ===========================================================================
-- merchants — komisyon kazandığımız mağazalar
-- ---------------------------------------------------------------------------
-- Bir "merchant", ürünlerini listelediğimiz dış mağazadır (Trendyol,
-- Hepsiburada, Amazon…). `vendors` tablosundan farkıdır: vendor bizim
-- panelimize kayıt olur ve siparişi biz yönetiriz; merchant ise dışarıdadır
-- ve biz yalnızca trafik gönderiririz.
-- ===========================================================================
create table public.merchants (
  id            uuid primary key default gen_random_uuid(),
  slug          citext not null unique,
  display_name  text not null,
  homepage_url  text not null,
  logo_url      text,
  country_code  char(2) not null default 'TR',

  -- --- Ortaklık programı bilgileri -----------------------------------------
  -- `network`: komisyonun ödendiği ağ. Doğrudan program ise mağazanın kendisi.
  network       text not null default 'direct',
  status        public.merchant_status not null default 'prospect',

  -- Ağdan aldığımız yayıncı kimliği (Amazon'da "associate tag" gibi).
  -- Gizli değildir — zaten her giden linkte görünür.
  tracking_id   text,

  /*
   * Yönlendirme (deeplink) şablonu.
   *
   * Desteklenen yer tutucular:
   *   {url}          — hedef ürün adresi (ham)
   *   {url_encoded}  — hedef ürün adresi (URL-encoded)
   *   {tracking_id}  — yukarıdaki tracking_id
   *   {subid}        — bizim ürettiğimiz tıklama kimliği (dönüşüm eşleştirme)
   *
   * Örnekler:
   *   Amazon   : {url}?tag={tracking_id}&ascsubtag={subid}
   *   Ağ üzeri : https://ag.example/c?pub={tracking_id}&sub={subid}&url={url_encoded}
   *
   * Şablon boşsa link üretilmez ve ürün "yönlendirilemez" sayılır — sessizce
   * takipsiz link üretmektense hiç link üretmemek doğrudur, aksi halde
   * trafiği bedavaya göndeririz.
   */
  deeplink_template text,

  -- Varsayılan komisyon oranı (0.0400 = %4). Kategori bazlı oranlar
  -- teklif seviyesinde `products.commission_rate` ile ezilir.
  default_commission_rate numeric(5, 4) not null default 0.0300
    check (default_commission_rate >= 0 and default_commission_rate <= 0.9),

  -- Çerez penceresi: tıklamadan kaç gün sonrasına kadar satış bize yazılır.
  cookie_window_days integer not null default 1 check (cookie_window_days > 0),

  -- Dönüşüm bildirimlerini (postback) doğrulamak için paylaşılan sır.
  -- Ağdan alınır; imza doğrulaması olmadan sahte dönüşüm yazılabilirdi.
  postback_secret text,

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint merchants_slug_format
    check (slug ~ '^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$'),

  -- Aktif bir mağazanın link üretebilmesi ŞARTTIR.
  constraint merchants_active_needs_template
    check (status <> 'active' or deeplink_template is not null)
);

comment on table public.merchants is
  'Komisyon karşılığı trafik gönderdiğimiz dış mağazalar (affiliate ortakları).';

create index merchants_status_idx on public.merchants (status) where status = 'active';

create trigger merchants_set_updated_at
  before update on public.merchants
  for each row execute function public.tg_set_updated_at();

-- ===========================================================================
-- sources — bir mağazadan veriyi HANGİ yolla aldığımız
-- ---------------------------------------------------------------------------
-- Bir mağazanın birden çok kaynağı olabilir (ör. elektronik feed'i + moda
-- feed'i). Alım mantığı kaynağın türüne göre seçilir; böylece yeni bir ağ
-- eklemek yeni kod değil, yeni bir SATIR demektir.
-- ===========================================================================
create table public.sources (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references public.merchants (id) on delete cascade,
  slug          citext not null unique,
  name          text not null,
  kind          public.source_kind not null,

  endpoint_url  text,

  /*
   * Feed kolonlarını kanonik alanlarımıza eşleyen harita.
   * Her ağ farklı isimler kullanır; kodu değil yapılandırmayı değiştiririz.
   *
   *   {"external_id": "id", "title": "product_name", "price": "sale_price",
   *    "gtin": "ean", "url": "link", "image": "image_link"}
   */
  field_mapping jsonb not null default '{}'::jsonb,

  -- Feed'deki fiyat biçimi: "1.299,90 TL" gibi metinleri kuruşa çevirmek için.
  price_locale  text not null default 'tr-TR',
  currency      char(3) not null default 'TRY',

  -- --- Nezaket (politeness) ayarları ---------------------------------------
  -- Yalnızca 'sitemap'/'api' türlerinde anlamlıdır. Bu değerler kodda ÜST
  -- SINIR olarak uygulanır; robots.txt daha yavaş bir hız isterse o kazanır.
  requests_per_minute integer not null default 20
    check (requests_per_minute between 1 and 600),
  request_delay_ms integer not null default 3000
    check (request_delay_ms >= 0),

  -- Alım sıklığı. Fiyat odaklı bir site için 15 dk altı nadiren anlamlıdır:
  -- feed'ler zaten o sıklıkta güncellenmez.
  schedule_cron text not null default '0 */6 * * *',

  is_enabled    boolean not null default true,

  -- --- Son çalışma özeti (panelde göstermek için denormalize) --------------
  last_run_at   timestamptz,
  last_status   public.ingest_status,
  last_error    text,
  last_item_count integer,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Uzaktan veri çeken her kaynağın adresi olmak zorundadır.
  constraint sources_remote_needs_endpoint
    check (kind = 'manual' or endpoint_url is not null)
);

create index sources_merchant_idx on public.sources (merchant_id);
create index sources_due_idx on public.sources (last_run_at) where is_enabled;

create trigger sources_set_updated_at
  before update on public.sources
  for each row execute function public.tg_set_updated_at();

-- ===========================================================================
-- ingest_runs — her alım denemesinin kaydı
-- ---------------------------------------------------------------------------
-- Bir feed sessizce boşalırsa (ağ tarafında bir şey bozulduysa) kataloğun
-- yarısı kaybolur. Çalışma geçmişi olmadan bunu fark etmek günler alır.
-- ===========================================================================
create table public.ingest_runs (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.sources (id) on delete cascade,
  status        public.ingest_status not null default 'running',

  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   integer,

  items_seen    integer not null default 0,
  items_created integer not null default 0,
  items_updated integer not null default 0,
  items_skipped integer not null default 0,
  items_failed  integer not null default 0,

  -- Atlanan kalemlerin ilk N tanesi ve sebebi — hata ayıklamanın çekirdeği.
  sample_errors jsonb not null default '[]'::jsonb,
  error         text
);

create index ingest_runs_source_time_idx
  on public.ingest_runs (source_id, started_at desc);

-- ===========================================================================
-- products tablosunun affiliate için genişletilmesi
-- ===========================================================================

-- Affiliate tekliflerinin bir "taşeronu" yoktur; vendor_id artık boş olabilir.
alter table public.products alter column vendor_id drop not null;

alter table public.products
  add column fulfillment public.fulfillment_kind not null default 'marketplace',
  add column merchant_id uuid references public.merchants (id) on delete cascade,
  add column source_id   uuid references public.sources (id) on delete set null,

  -- Mağazadaki ürün sayfası. Yönlendirme linki BUNDAN türetilir.
  add column product_url text,

  -- Teklif bazlı komisyon oranı; boşsa merchant'ın varsayılanı kullanılır.
  add column commission_rate numeric(5, 4)
    check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 0.9)),

  -- Feed'de en son ne zaman görüldü? Feed'den düşen ürünler bununla ayıklanır.
  add column last_seen_at timestamptz not null default now();

/*
 * Bir teklif ya bir taşerona ya da bir mağazaya aittir — ikisine birden değil,
 * hiçbirine değil. Bu kısıt olmadan sahipsiz teklifler oluşur ve hangi kod
 * yolunun (sipariş mi, yönlendirme mi) çalışacağı belirsizleşir.
 */
alter table public.products
  add constraint products_ownership_exclusive check (
    (fulfillment = 'marketplace' and vendor_id is not null and merchant_id is null)
    or
    (fulfillment = 'affiliate' and merchant_id is not null and vendor_id is null
     and product_url is not null)
  );

create index products_merchant_idx on public.products (merchant_id)
  where fulfillment = 'affiliate';
create index products_source_seen_idx on public.products (source_id, last_seen_at);

-- Feed beslemesinin idempotent anahtarı. (vendor_id, external_id) benzersiz
-- kısıtı affiliate tarafında NULL vendor_id yüzünden işlemez — PostgreSQL'de
-- NULL'lar birbirine eşit sayılmaz, dolayısıyla mükerrer kayıt oluşurdu.
create unique index products_merchant_external_id_key
  on public.products (merchant_id, external_id)
  where merchant_id is not null;

-- ---------------------------------------------------------------------------
-- Mevcut politika ve fonksiyonların affiliate'e uyarlanması
-- ---------------------------------------------------------------------------

-- Vitrin politikası yalnızca onaylı TAŞERON ürünlerini gösteriyordu; affiliate
-- teklifleri bu haliyle görünmez kalırdı.
drop policy if exists "products_public_read_active" on public.products;

create policy "products_public_read_active"
  on public.products for select
  using (
    status = 'active'
    and (
      -- Taşeron ürünü: taşeron onaylı olmalı.
      (fulfillment = 'marketplace' and exists (
        select 1 from public.vendors v
        where v.id = products.vendor_id and v.status = 'approved'
      ))
      or
      -- Affiliate teklifi: mağaza aktif olmalı (komisyon kazanılabilir olmalı).
      (fulfillment = 'affiliate' and exists (
        select 1 from public.merchants m
        where m.id = products.merchant_id and m.status = 'active'
      ))
    )
  );

/*
 * create_order() affiliate tekliflerini kabul ETMEMELİDİR: o ürün bizde
 * satılmıyor, stoğu bizde değil, parası bize gelmiyor.
 *
 * Kontrol, alt sipariş (vendor_order) açılmadan ÖNCE çalışmalıdır. Aksi halde
 * NULL vendor_id yüzünden anlaşılmaz bir NOT NULL ihlali alınır — kullanıcıya
 * gösterilemeyecek, hata ayıklaması zor bir mesaj.
 */
create or replace function public.assert_orderable(p_product public.products)
returns void
language plpgsql
immutable
as $$
begin
  if p_product.fulfillment = 'affiliate' then
    raise exception
      'OHAAAA_AFFILIATE_NOT_ORDERABLE: "%" ortak mağazada satılıyor; '
      'sipariş yerine yönlendirme yapılmalı', p_product.title
      using errcode = 'check_violation';
  end if;

  if p_product.status <> 'active' then
    raise exception 'OHAAAA_PRODUCT_UNAVAILABLE: % satışta değil', p_product.title
      using errcode = 'check_violation';
  end if;
end;
$$;

-- İkinci savunma katmanı: order_items'a doğrudan yazan bir kod yolu
-- create_order()'ı atlarsa yine reddedilir.
create or replace function public.tg_order_items_reject_affiliate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.products p
    where p.id = new.product_id and p.fulfillment = 'affiliate'
  ) then
    raise exception
      'OHAAAA_AFFILIATE_NOT_ORDERABLE: bu ürün ortak mağazada satılıyor, '
      'sipariş yerine yönlendirme yapılmalı'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Stok düşümünden ÖNCE çalışmalı: reddedilecek bir kalem için stok kilidi alma.
create trigger order_items_reject_affiliate
  before insert on public.order_items
  for each row execute function public.tg_order_items_reject_affiliate();

-- Merchant'lar herkese açıktır: mağaza adı ve logosu ürün kartında görünür.
alter table public.merchants enable row level security;
alter table public.sources enable row level security;
alter table public.ingest_runs enable row level security;

create policy "merchants_public_read_active"
  on public.merchants for select
  using (status = 'active');

create policy "merchants_admin_all"
  on public.merchants for all
  using (public.is_admin()) with check (public.is_admin());

-- Kaynaklar ve çalışma geçmişi işletme sırrıdır; yalnızca admin görür.
create policy "sources_admin_all"
  on public.sources for all
  using (public.is_admin()) with check (public.is_admin());

create policy "ingest_runs_admin_all"
  on public.ingest_runs for all
  using (public.is_admin()) with check (public.is_admin());

grant select on public.merchants to anon, authenticated;
