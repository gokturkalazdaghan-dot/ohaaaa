-- ============================================================================
-- OHAAAA · 006 — Tıklama Takibi, Dönüşüm ve Fiyat Geçmişi
-- ----------------------------------------------------------------------------
-- Affiliate gelirinin tamamı tek bir zincire bağlıdır:
--
--   tıklama (subid üretilir)  →  mağazada satış  →  ağ postback'i (subid ile)
--        clicks                                        conversions
--
-- `subid` bu zincirin tek bağıdır. Kaybolursa satış gerçekleşse bile hangi
-- ürünün/kanalın kazandırdığını bilemeyiz — yani neyi büyüteceğimizi de.
-- ============================================================================

-- ===========================================================================
-- clicks — giden her yönlendirme
-- ---------------------------------------------------------------------------
-- KVKK notu: IP ve user-agent HAM olarak saklanmaz. Sahtecilik tespiti ve
-- tekilleştirme için özet (hash) yeterlidir; ham değer kişisel veridir ve
-- saklanması ek yükümlülük doğurur. Özet, günlük dönen bir tuzla (salt)
-- alınır, böylece uzun vadeli kullanıcı takibi mümkün olmaz.
-- ===========================================================================
create table public.clicks (
  id            uuid primary key default gen_random_uuid(),

  -- Ağa gönderdiğimiz izleme kimliği. Dönüşüm bununla eşleşir.
  subid         text not null unique,

  product_id    uuid references public.products (id) on delete set null,
  merchant_id   uuid not null references public.merchants (id) on delete cascade,
  group_id      uuid references public.product_groups (id) on delete set null,

  -- Tıklama anındaki fiyat. Sonradan değişse bile dönüşüm analizinde
  -- "hangi fiyattan gitti" sorusu cevaplanabilmelidir.
  price_cents_at_click bigint,

  user_id       uuid references public.users (id) on delete set null,
  session_id    text,

  ip_hash       text,
  user_agent_hash text,
  referrer      text,
  placement     text,   -- 'product_page' | 'search' | 'flash_deal' | 'api'
  device        text,   -- 'mobile' | 'desktop' | 'tablet'

  created_at    timestamptz not null default now(),

  constraint clicks_subid_format check (subid ~ '^[A-Za-z0-9_-]{16,64}$')
);

comment on column public.clicks.subid is
  'Ağa iletilen izleme kimliği; dönüşüm eşleştirmesinin tek bağıdır.';

create index clicks_merchant_time_idx on public.clicks (merchant_id, created_at desc);
create index clicks_product_idx       on public.clicks (product_id);
create index clicks_created_idx       on public.clicks (created_at desc);

-- ===========================================================================
-- conversions — ağdan bildirilen satışlar
-- ===========================================================================
create table public.conversions (
  id            uuid primary key default gen_random_uuid(),

  -- Tıklama bulunamayabilir (çerez penceresi aşımı, subid kaybı). Bu durumda
  -- kayıt yine tutulur — ciro gerçektir, yalnızca atfedilemez.
  click_id      uuid references public.clicks (id) on delete set null,
  subid         text,

  merchant_id   uuid not null references public.merchants (id) on delete cascade,

  -- Ağın kendi sipariş kimliği. Mükerrer postback'leri engelleyen anahtar.
  network_order_id text not null,

  status        public.conversion_status not null default 'pending',
  currency      char(3) not null default 'TRY',
  order_total_cents bigint not null default 0 check (order_total_cents >= 0),
  commission_cents  bigint not null default 0 check (commission_cents >= 0),

  occurred_at   timestamptz not null default now(),
  reported_at   timestamptz not null default now(),
  status_changed_at timestamptz,

  -- Ağın gönderdiği ham gövde. Uyuşmazlık halinde tek kanıt budur.
  raw           jsonb not null default '{}'::jsonb,

  -- Aynı satış iki kez bildirilirse ciro iki katına çıkardı.
  constraint conversions_network_order_key unique (merchant_id, network_order_id)
);

create index conversions_subid_idx    on public.conversions (subid);
create index conversions_status_idx   on public.conversions (status, occurred_at desc);
create index conversions_merchant_idx on public.conversions (merchant_id, occurred_at desc);

-- Durum değişimini damgala: "ne zaman onaylandı" sorusu ödeme takibinin özü.
create or replace function public.tg_conversions_stamp_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger conversions_stamp_status
  before update on public.conversions
  for each row execute function public.tg_conversions_stamp_status();

-- ===========================================================================
-- price_points — fiyat geçmişi
-- ---------------------------------------------------------------------------
-- "Yüksek indirim odaklı" bir sitenin güvenilirliği buna bağlıdır. Mağazanın
-- kendi "üstü çizili" fiyatı pazarlama verisidir; gerçek indirim ancak KENDİ
-- gözlemimizle kanıtlanabilir: "bu ürün 90 gündür bu fiyatın altını görmedi".
--
-- Her alımda değil, yalnızca DEĞİŞİMDE kayıt atılır (trigger). Aksi halde
-- 6 saatte bir çalışan bir feed, tek üründe yılda 1.460 gereksiz satır üretir.
-- ===========================================================================
create table public.price_points (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products (id) on delete cascade,
  price_cents bigint not null check (price_cents >= 0),
  in_stock    boolean not null default true,
  observed_at timestamptz not null default now()
);

create index price_points_product_time_idx
  on public.price_points (product_id, observed_at desc);

create or replace function public.tg_products_record_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Yalnızca fiyat veya stok DURUMU değiştiyse yaz.
  if tg_op = 'INSERT'
     or new.price_cents is distinct from old.price_cents
     or (new.stock > 0) is distinct from (old.stock > 0) then

    insert into public.price_points (product_id, price_cents, in_stock)
    values (new.id, new.price_cents, new.stock > 0);
  end if;

  return new;
end;
$$;

create trigger products_record_price
  after insert or update of price_cents, stock on public.products
  for each row execute function public.tg_products_record_price();

-- ---------------------------------------------------------------------------
-- deal_score — bir teklifin gerçekten fırsat olup olmadığı
-- ---------------------------------------------------------------------------
-- Kendi gözlem geçmişimize göre puanlar. Mağazanın iddia ettiği indirime
-- DEĞİL, ölçtüğümüz fiyata bakar.
--
-- Dönen alanlar:
--   window_min/max/avg : pencere içindeki gözlemlerimiz
--   discount_percent   : ortalamaya göre şu anki indirim
--   is_lowest_ever     : gözlem penceresinin en düşüğü mü
--   confidence         : kaç gündür gözlemliyoruz (az veri = zayıf iddia)
-- ---------------------------------------------------------------------------
create or replace function public.deal_score(
  p_product_id uuid,
  p_days       integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since   timestamptz := now() - make_interval(days => greatest(1, least(p_days, 730)));
  v_current bigint;
  v_min     bigint;
  v_max     bigint;
  v_avg     bigint;
  v_first   timestamptz;
  v_days    integer;
begin
  select price_cents into v_current from public.products where id = p_product_id;

  if v_current is null then
    return jsonb_build_object('available', false);
  end if;

  select min(price_cents), max(price_cents), round(avg(price_cents))::bigint, min(observed_at)
    into v_min, v_max, v_avg, v_first
  from public.price_points
  where product_id = p_product_id
    and observed_at >= v_since;

  if v_min is null then
    return jsonb_build_object('available', false, 'current_price_cents', v_current);
  end if;

  v_days := greatest(0, extract(day from now() - v_first)::integer);

  return jsonb_build_object(
    'available',           true,
    'current_price_cents', v_current,
    'window_days',         greatest(1, least(p_days, 730)),
    'observed_days',       v_days,
    'min_price_cents',     v_min,
    'max_price_cents',     v_max,
    'avg_price_cents',     v_avg,
    'is_lowest_ever',      v_current <= v_min,
    'discount_percent',
      case when v_avg > 0 and v_current < v_avg
           then round(((v_avg - v_current)::numeric / v_avg) * 100)::integer
           else 0 end,
    -- 30 günden az gözlemde "en düşük fiyat" iddiası zayıftır; arayüz bu
    -- alana bakarak rozeti göstermeyebilir.
    'confidence',
      case when v_days >= 30 then 'high'
           when v_days >= 7  then 'medium'
           else 'low' end
  );
end;
$$;

-- ===========================================================================
-- record_click — yönlendirme kaydı (tek çağrı, atomik)
-- ===========================================================================
create or replace function public.record_click(
  p_product_id  uuid,
  p_subid       text,
  p_session_id  text default null,
  p_ip_hash     text default null,
  p_ua_hash     text default null,
  p_referrer    text default null,
  p_placement   text default null,
  p_device      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_click_id uuid;
  v_product  public.products;
begin
  select * into v_product from public.products where id = p_product_id;

  if not found then
    raise exception 'OHAAAA_PRODUCT_NOT_FOUND: ürün bulunamadı'
      using errcode = 'no_data_found';
  end if;

  if v_product.fulfillment <> 'affiliate' then
    raise exception 'OHAAAA_NOT_AFFILIATE: bu ürün yönlendirmeli değil'
      using errcode = 'check_violation';
  end if;

  insert into public.clicks (
    subid, product_id, merchant_id, group_id, price_cents_at_click,
    user_id, session_id, ip_hash, user_agent_hash, referrer, placement, device
  )
  values (
    p_subid, v_product.id, v_product.merchant_id, v_product.group_id,
    v_product.price_cents,
    auth.uid(), p_session_id, p_ip_hash, p_ua_hash,
    left(p_referrer, 500), p_placement, p_device
  )
  returning id into v_click_id;

  return v_click_id;
end;
$$;

-- ===========================================================================
-- record_conversion — ağ postback'i (yalnızca sunucu çağırır)
-- ---------------------------------------------------------------------------
-- İdempotenttir: aynı network_order_id ikinci kez gelirse yeni satır
-- açmaz, mevcut kaydın durumunu günceller. Ağlar postback'i sık sık
-- tekrarlar (onay, iptal, düzeltme) — bu yüzden upsert şarttır.
-- ===========================================================================
create or replace function public.record_conversion(
  p_merchant_id       uuid,
  p_network_order_id  text,
  p_subid             text,
  p_status            public.conversion_status,
  p_order_total_cents bigint,
  p_commission_cents  bigint,
  p_currency          char(3) default 'TRY',
  p_occurred_at       timestamptz default now(),
  p_raw               jsonb default '{}'::jsonb
)
returns public.conversions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_click_id uuid;
  v_row      public.conversions;
begin
  -- subid'yi tıklamaya bağla. Bulunamazsa kayıt yine tutulur: ciro gerçektir,
  -- yalnızca hangi tıklamadan geldiği bilinemez.
  select id into v_click_id from public.clicks where subid = p_subid;

  insert into public.conversions (
    click_id, subid, merchant_id, network_order_id, status,
    currency, order_total_cents, commission_cents, occurred_at, raw
  )
  values (
    v_click_id, p_subid, p_merchant_id, p_network_order_id, p_status,
    p_currency, p_order_total_cents, p_commission_cents, p_occurred_at, p_raw
  )
  on conflict (merchant_id, network_order_id) do update
    set status            = excluded.status,
        order_total_cents = excluded.order_total_cents,
        commission_cents  = excluded.commission_cents,
        -- Tıklama bağı bir kez kurulduysa korunur: sonraki postback'te
        -- subid gelmeyebilir, atfı kaybetmemeliyiz.
        click_id          = coalesce(public.conversions.click_id, excluded.click_id),
        reported_at       = now(),
        raw               = excluded.raw
  returning * into v_row;

  return v_row;
end;
$$;

-- ===========================================================================
-- affiliate_dashboard — tek kişilik operasyonun kontrol paneli
-- ===========================================================================
create or replace function public.affiliate_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
  v_clicks bigint;
begin
  if not public.is_admin() then
    raise exception 'OHAAAA_FORBIDDEN: yönetici yetkisi gerekli'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_clicks from public.clicks where created_at >= v_since;

  return jsonb_build_object(
    'window_days', greatest(1, least(p_days, 365)),
    'clicks', v_clicks,
    'conversions', (
      select jsonb_build_object(
        'count',    count(*),
        'approved', count(*) filter (where status in ('approved', 'paid')),
        'pending',  count(*) filter (where status = 'pending'),
        'rejected', count(*) filter (where status = 'rejected'),
        'gross_cents',      coalesce(sum(order_total_cents), 0),
        'commission_cents', coalesce(sum(commission_cents)
                              filter (where status in ('approved', 'paid')), 0)
      )
      from public.conversions where occurred_at >= v_since
    ),
    -- Dönüşüm oranı ve tıklama başına kazanç (EPC): hangi kanalın
    -- gerçekten para kazandırdığını gösteren iki sayı.
    'epc_cents', case when v_clicks > 0 then
      round(coalesce((select sum(commission_cents) from public.conversions
                      where occurred_at >= v_since and status in ('approved','paid')), 0)
            / v_clicks::numeric)::bigint
      else 0 end,
    'top_merchants', coalesce((
      select jsonb_agg(row_to_json(t) order by t.commission_cents desc)
      from (
        select m.display_name,
               count(c.id)                                as conversions,
               coalesce(sum(c.commission_cents), 0)::bigint as commission_cents
        from public.merchants m
        left join public.conversions c
          on c.merchant_id = m.id
         and c.occurred_at >= v_since
         and c.status in ('approved', 'paid')
        where m.status = 'active'
        group by m.id, m.display_name
        limit 10
      ) t
    ), '[]'::jsonb),
    'catalog', (
      select jsonb_build_object(
        'affiliate_offers', count(*) filter (where fulfillment = 'affiliate'),
        'active_offers',    count(*) filter (where status = 'active'),
        'stale_offers',     count(*) filter (where last_seen_at < now() - interval '48 hours')
      )
      from public.products
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.clicks       enable row level security;
alter table public.conversions  enable row level security;
alter table public.price_points enable row level security;

-- Tıklama ve dönüşüm verisi işletme sırrıdır: yalnızca admin okur.
create policy "clicks_admin_read" on public.clicks for select
  using (public.is_admin());

create policy "conversions_admin_read" on public.conversions for select
  using (public.is_admin());

-- Fiyat geçmişi herkese açıktır — "gerçekten ucuz mu" iddiasının kanıtı odur.
create policy "price_points_public_read" on public.price_points for select
  using (true);

grant select on public.price_points to anon, authenticated;
grant execute on function public.deal_score(uuid, integer) to anon, authenticated;

-- record_click / record_conversion yalnızca sunucudan (service_role) çağrılır.
revoke execute on function
  public.record_click(uuid, text, text, text, text, text, text, text)
  from anon, authenticated;
revoke execute on function public.record_conversion(
  uuid, text, text, public.conversion_status, bigint, bigint, char, timestamptz, jsonb
) from anon, authenticated;
