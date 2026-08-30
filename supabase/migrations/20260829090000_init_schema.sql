-- ============================================================================
-- OHAAAA · 001 — Çekirdek Şema (Core Schema)
-- ----------------------------------------------------------------------------
-- Çok satıcılı süper-agregatör için ilişkisel model.
--
-- Tasarım kararları:
--   * Para birimleri DAİMA integer "minor unit" (kuruş) olarak saklanır.
--     Float kullanımı finansal hesaplamalarda yuvarlama hatası üretir.
--   * Katalog iki katmanlıdır:
--       product_groups -> kanonik ürün (karşılaştırma birimi)
--       products       -> bir taşeronun o ürüne verdiği teklif (offer)
--     Fiyat karşılaştırma motoru bu ikili yapı üzerinde çalışır.
--   * Bir müşteri siparişi (orders) birden fazla taşerona bölünür
--     (vendor_orders) — "split-cart" mantığının veritabanı karşılığı.
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid(), digest()
create extension if not exists "citext";     -- büyük/küçük harf duyarsız metin
create extension if not exists "pg_trgm";    -- bulanık (fuzzy) arama

-- ---------------------------------------------------------------------------
-- Enum tipleri
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('customer', 'vendor', 'admin');

create type public.vendor_status as enum ('pending', 'approved', 'rejected', 'suspended');

create type public.product_status as enum ('draft', 'active', 'out_of_stock', 'archived');

create type public.product_condition as enum ('new', 'refurbished', 'used');

create type public.order_status as enum (
  'pending_payment', 'paid', 'processing', 'shipped',
  'delivered', 'cancelled', 'refunded'
);

create type public.vendor_order_status as enum (
  'awaiting_vendor', 'accepted', 'preparing', 'shipped',
  'delivered', 'cancelled'
);

-- ---------------------------------------------------------------------------
-- normalize_search — Türkçe duyarsız arama normalizasyonu
-- ---------------------------------------------------------------------------
-- Türkiye'de kullanıcıların büyük bölümü aramayı Türkçe karakter kullanmadan
-- yazar ("kulaklik", "supurge", "bilgisayar sarj"). Katalog ise doğru yazımla
-- beslenir. Her iki tarafı da aynı ASCII uzayına indirgeyerek eşleştiriyoruz.
--
-- IMMUTABLE olması zorunlu: generated column ve indeks ifadelerinde kullanılıyor.
-- Not: 'İ' harfi özel — lower('İ') ortama bağlı davrandığı için translate()
-- lower()'dan ÖNCE uygulanır.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_search(p_input text)
returns text
language sql
immutable
parallel safe
returns null on null input
as $$
  select lower(translate(
    p_input,
    'ĞÜŞİÖÇIğüşıöçÂÎÛâîû',
    'GUSIOCIgusiocaiuaiu'
  ));
$$;

comment on function public.normalize_search(text) is
  'Türkçe karakterleri ASCII karşılığına indirger; arama indekslerinin temelidir.';

-- ---------------------------------------------------------------------------
-- Ortak yardımcı: updated_at otomatik güncelleme
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- users — auth.users tablosunun herkese açık profil izdüşümü
-- ===========================================================================
create table public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         citext      not null unique,
  full_name     text,
  avatar_url    text,
  phone         text,
  role          public.user_role not null default 'customer',
  locale        text        not null default 'tr',
  marketing_opt_in boolean  not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.users is 'Uygulama seviyesi kullanıcı profili; auth.users ile 1-1.';

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.tg_set_updated_at();

-- Yeni kayıt olan her auth kullanıcısı için otomatik profil aç.
create or replace function public.tg_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@placeholder.ohaaaa.com'),
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_handle_new_auth_user();

-- ===========================================================================
-- vendors — "taşeron" / satıcı firmalar
-- ===========================================================================
create table public.vendors (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.users (id) on delete cascade,
  slug            citext not null unique,
  display_name    text   not null,
  legal_name      text,
  tax_id          text,
  description     text,
  logo_url        text,
  website_url     text,
  support_email   citext,
  support_phone   text,
  country_code    char(2) not null default 'TR',
  status          public.vendor_status not null default 'pending',

  -- Platformun taşerondan aldığı komisyon oranı (0.0800 = %8).
  commission_rate numeric(5, 4) not null default 0.0800
                  check (commission_rate >= 0 and commission_rate <= 0.5000),

  rating          numeric(3, 2) not null default 0
                  check (rating >= 0 and rating <= 5),
  rating_count    integer not null default 0 check (rating_count >= 0),

  -- Denormalize sayaç: panel ve liste sayfaları için (trigger ile beslenir).
  active_product_count integer not null default 0 check (active_product_count >= 0),

  rejection_reason text,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint vendors_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$')
);

comment on table public.vendors is 'Pazar yerine ürün besleyen taşeron/satıcı hesapları.';

create index vendors_owner_id_idx on public.vendors (owner_id);
create index vendors_status_idx  on public.vendors (status) where status = 'approved';

create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.tg_set_updated_at();

-- ===========================================================================
-- api_keys — taşeron entegrasyon anahtarları
-- ---------------------------------------------------------------------------
-- Ham anahtar ASLA saklanmaz. Yalnızca SHA-256 özeti tutulur; anahtar bir kez,
-- oluşturulma anında gösterilir. `key_prefix` sabit ve aranabilir olduğu için
-- doğrulama tek indeksli sorguyla O(log n) çalışır.
-- ===========================================================================
create table public.api_keys (
  id                    uuid primary key default gen_random_uuid(),
  vendor_id             uuid not null references public.vendors (id) on delete cascade,
  name                  text not null,
  environment           text not null default 'live' check (environment in ('live', 'test')),
  key_prefix            text not null unique,   -- ör. ohk_live_9f2c1a7b
  key_hash              text not null unique,   -- sha256(ham anahtar), hex
  last_four             char(4) not null,
  scopes                text[] not null default array[
                          'products:read', 'products:write', 'orders:read', 'orders:write'
                        ]::text[],
  rate_limit_per_minute integer not null default 600 check (rate_limit_per_minute > 0),
  created_by            uuid references public.users (id) on delete set null,
  last_used_at          timestamptz,
  last_used_ip          inet,
  request_count         bigint not null default 0,
  expires_at            timestamptz,
  revoked_at            timestamptz,
  created_at            timestamptz not null default now()
);

comment on column public.api_keys.key_hash is 'sha256(ham anahtar) — ham değer hiçbir yerde saklanmaz.';

create index api_keys_vendor_id_idx on public.api_keys (vendor_id);
create index api_keys_active_idx on public.api_keys (key_hash)
  where revoked_at is null;

-- ===========================================================================
-- categories — kendi kendine referans veren kategori ağacı
-- ===========================================================================
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.categories (id) on delete set null,
  slug        citext not null unique,
  name        text not null,
  icon        text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index categories_parent_id_idx on public.categories (parent_id);

-- ===========================================================================
-- product_groups — kanonik ürün (fiyat karşılaştırmasının birimi)
-- ---------------------------------------------------------------------------
-- Farklı taşeronların aynı fiziksel ürüne verdiği teklifler tek bir grupta
-- toplanır. min/max fiyat ve teklif sayısı trigger ile denormalize edilir;
-- liste sayfaları böylece tek sorguda render edilir.
-- ===========================================================================
create table public.product_groups (
  id             uuid primary key default gen_random_uuid(),
  slug           citext not null unique,
  title          text   not null,
  brand          text,
  gtin           text unique,          -- EAN/UPC/ISBN — varsa en güvenilir eşleştirici
  category_id    uuid references public.categories (id) on delete set null,
  description    text,
  image_url      text,
  attributes     jsonb  not null default '{}'::jsonb,

  -- Aramanın tek doğruluk kaynağı: normalize edilmiş başlık + marka.
  -- Türetilmiş kolon olduğu için başlık değiştiğinde kendiliğinden tazelenir
  -- ve indeksler ile sorgular birebir aynı ifadeyi kullanır.
  search_text text generated always as (
    public.normalize_search(title || ' ' || coalesce(brand, ''))
  ) stored,

  -- Denormalize karşılaştırma önbelleği (products trigger'ı ile beslenir).
  offer_count       integer not null default 0 check (offer_count >= 0),
  min_price_cents   bigint,
  max_price_cents   bigint,
  best_offer_id     uuid,               -- FK aşağıda, products yaratıldıktan sonra

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index product_groups_category_idx on public.product_groups (category_id);
create index product_groups_min_price_idx on public.product_groups (min_price_cents)
  where offer_count > 0;

-- Türkçe duyarsız arama yüzeyi: hem trigram (LIKE / kelime benzerliği)
-- hem de tam metin. İkisi search_products() içinde birlikte kullanılır.
create index product_groups_search_trgm_idx on public.product_groups
  using gin (search_text gin_trgm_ops);
create index product_groups_search_fts_idx on public.product_groups
  using gin (to_tsvector('simple', search_text));

create trigger product_groups_set_updated_at
  before update on public.product_groups
  for each row execute function public.tg_set_updated_at();

-- ===========================================================================
-- products — bir taşeronun bir kanonik ürüne verdiği teklif
-- ===========================================================================
create table public.products (
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid not null references public.vendors (id) on delete cascade,
  group_id          uuid references public.product_groups (id) on delete set null,

  -- Taşeronun kendi sistemindeki kimlik. Idempotent besleme (upsert) anahtarı.
  external_id       text not null,
  sku               text,

  title             text not null check (char_length(title) between 2 and 300),
  description       text,
  brand             text,
  category_id       uuid references public.categories (id) on delete set null,
  image_urls        text[] not null default '{}'::text[],

  price_cents            bigint not null check (price_cents >= 0),
  compare_at_price_cents bigint check (compare_at_price_cents >= 0),
  currency               char(3) not null default 'TRY',

  stock             integer not null default 0 check (stock >= 0),
  condition         public.product_condition not null default 'new',

  shipping_fee_cents      bigint not null default 0 check (shipping_fee_cents >= 0),
  free_shipping_threshold_cents bigint check (free_shipping_threshold_cents >= 0),
  estimated_delivery_days integer not null default 3 check (estimated_delivery_days between 0 and 90),

  status            public.product_status not null default 'active',
  attributes        jsonb not null default '{}'::jsonb,

  -- Tam metin arama vektörü. `simple` sözlüğü seçildi: Türkçe ürün adlarında
  -- marka/model kodları köklenmemeli (iPhone 15 -> "iphone", "15").
  -- normalize_search: "kulaklik" araması "Kulaklık" başlığını da bulur.
  search_vector tsvector generated always as (
    to_tsvector('simple', public.normalize_search(
      coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(sku, '')))
  ) stored,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint products_vendor_external_id_key unique (vendor_id, external_id),
  constraint products_compare_at_gt_price
    check (compare_at_price_cents is null or compare_at_price_cents >= price_cents)
);

comment on table public.products is 'Taşeron teklifleri. (vendor_id, external_id) idempotent besleme anahtarıdır.';

create index products_vendor_idx   on public.products (vendor_id);
create index products_group_idx    on public.products (group_id);
create index products_category_idx on public.products (category_id);
create index products_search_idx   on public.products using gin (search_vector);
create index products_live_price_idx on public.products (price_cents)
  where status = 'active' and stock > 0;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.tg_set_updated_at();

-- product_groups.best_offer_id -> products (döngüsel FK, tablo sonrası eklenir)
alter table public.product_groups
  add constraint product_groups_best_offer_fk
  foreign key (best_offer_id) references public.products (id) on delete set null;

-- ===========================================================================
-- flash_deals — "Günün En Oha Fiyatı"
-- ===========================================================================
create table public.flash_deals (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products (id) on delete cascade,
  headline       text not null default 'Günün En Oha Fiyatı',
  deal_price_cents bigint not null check (deal_price_cents >= 0),
  stock_limit    integer check (stock_limit > 0),
  sold_count     integer not null default 0 check (sold_count >= 0),
  priority       integer not null default 0,
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz not null,
  created_at     timestamptz not null default now(),

  constraint flash_deals_window check (ends_at > starts_at)
);

create index flash_deals_window_idx on public.flash_deals (starts_at, ends_at);

-- ===========================================================================
-- orders — müşteri siparişi (birden fazla taşeronu kapsayabilir)
-- ===========================================================================
create table public.orders (
  id                     uuid primary key default gen_random_uuid(),
  order_number           text not null unique,
  user_id                uuid references public.users (id) on delete set null,
  email                  citext not null,
  status                 public.order_status not null default 'pending_payment',
  currency               char(3) not null default 'TRY',

  items_subtotal_cents   bigint not null default 0 check (items_subtotal_cents >= 0),
  shipping_total_cents   bigint not null default 0 check (shipping_total_cents >= 0),
  discount_total_cents   bigint not null default 0 check (discount_total_cents >= 0),
  grand_total_cents      bigint not null default 0 check (grand_total_cents >= 0),
  commission_total_cents bigint not null default 0 check (commission_total_cents >= 0),

  shipping_address       jsonb not null default '{}'::jsonb,
  billing_address        jsonb,
  notes                  text,

  payment_provider       text,
  payment_reference       text,
  paid_at                timestamptz,
  cancelled_at           timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index orders_user_idx    on public.orders (user_id);
create index orders_created_idx on public.orders (created_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.tg_set_updated_at();

-- ===========================================================================
-- vendor_orders — siparişin taşeron bazında bölünmüş parçası (split-cart)
-- ===========================================================================
create table public.vendor_orders (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,
  vendor_id            uuid not null references public.vendors (id) on delete restrict,
  status               public.vendor_order_status not null default 'awaiting_vendor',

  items_subtotal_cents bigint not null default 0 check (items_subtotal_cents >= 0),
  shipping_cents       bigint not null default 0 check (shipping_cents >= 0),
  commission_cents     bigint not null default 0 check (commission_cents >= 0),
  payout_cents         bigint not null default 0 check (payout_cents >= 0),
  commission_rate      numeric(5, 4) not null,   -- sipariş anındaki oran (snapshot)

  carrier              text,
  tracking_number      text,
  shipped_at           timestamptz,
  delivered_at         timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint vendor_orders_order_vendor_key unique (order_id, vendor_id)
);

create index vendor_orders_vendor_idx on public.vendor_orders (vendor_id, created_at desc);

create trigger vendor_orders_set_updated_at
  before update on public.vendor_orders
  for each row execute function public.tg_set_updated_at();

-- ===========================================================================
-- order_items — satır kalemleri (fiyat/başlık anlık görüntüsü ile)
-- ---------------------------------------------------------------------------
-- Ürün silinse veya fiyatı değişse bile sipariş geçmişi bozulmasın diye
-- başlık, görsel ve birim fiyat sipariş anında kopyalanır (snapshot).
-- ===========================================================================
create table public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  vendor_order_id     uuid not null references public.vendor_orders (id) on delete cascade,
  vendor_id           uuid not null references public.vendors (id) on delete restrict,
  product_id          uuid references public.products (id) on delete set null,

  title_snapshot      text not null,
  image_url_snapshot  text,
  sku_snapshot        text,

  unit_price_cents    bigint not null check (unit_price_cents >= 0),
  quantity            integer not null check (quantity > 0 and quantity <= 999),
  line_total_cents    bigint not null check (line_total_cents >= 0),
  commission_cents    bigint not null default 0 check (commission_cents >= 0),

  created_at          timestamptz not null default now()
);

create index order_items_order_idx        on public.order_items (order_id);
create index order_items_vendor_order_idx on public.order_items (vendor_order_id);
create index order_items_product_idx      on public.order_items (product_id);

-- ===========================================================================
-- api_request_logs — taşeron paneli analitiği + kötüye kullanım tespiti
-- ===========================================================================
create table public.api_request_logs (
  id           bigint generated always as identity primary key,
  api_key_id   uuid references public.api_keys (id) on delete set null,
  vendor_id    uuid references public.vendors (id) on delete cascade,
  method       text not null,
  path         text not null,
  status_code  integer not null,
  duration_ms  integer not null,
  ip           inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);

create index api_request_logs_vendor_time_idx
  on public.api_request_logs (vendor_id, created_at desc);
