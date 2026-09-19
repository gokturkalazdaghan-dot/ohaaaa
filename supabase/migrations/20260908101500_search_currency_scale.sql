create table public.product_group_price_stats (
  group_id   uuid not null references public.product_groups (id) on delete cascade,
  currency   char(3) not null references public.currencies (code),

  offer_count      integer not null default 0 check (offer_count >= 0),
  min_price_cents  bigint,
  max_price_cents  bigint,
  best_offer_id    uuid references public.products (id) on delete set null,

  updated_at timestamptz not null default now(),

  primary key (group_id, currency),

  constraint product_group_price_stats_min_le_max
    check (min_price_cents is null or max_price_cents is null
           or min_price_cents <= max_price_cents)
);

comment on table public.product_group_price_stats is
  'Kanonik urun istatistigi, PARA BIRIMI BASINA. Tek bir min() iki para '
  'birimini kiyaslarsa dusuk mezhepli olan her zaman kazanir ve "en ucuz" '
  'iddiasi fiyata degil mezhebe gore karar verir.';

create index product_group_price_stats_price_idx
  on public.product_group_price_stats (currency, min_price_cents)
  where offer_count > 0;

alter table public.product_groups
  add column price_currency char(3) references public.currencies (code);

comment on column public.product_groups.price_currency is
  'min/max_price_cents in para birimi (baskin para birimi). Etiketsiz bir '
  'fiyat sayisi, para birimi karisikligi hatasinin sessiz halidir.';

create or replace function public.refresh_product_group_stats(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baskin char(3);
begin
  if p_group_id is null then
    return;
  end if;

  delete from public.product_group_price_stats where group_id = p_group_id;

  insert into public.product_group_price_stats
    (group_id, currency, offer_count, min_price_cents, max_price_cents, best_offer_id)
  select
    p_group_id,
    p.currency,
    count(*),
    min(p.price_cents),
    max(p.price_cents),
    (select p2.id
       from public.products p2
      where p2.group_id = p_group_id
        and p2.currency = p.currency
        and p2.status = 'active' and p2.stock > 0
      order by (p2.price_cents + p2.shipping_fee_cents) asc,
               p2.estimated_delivery_days asc,
               p2.created_at asc
      limit 1)
  from public.products p
  where p.group_id = p_group_id
    and p.status = 'active'
    and p.stock > 0
  group by p.currency;

  select currency into v_baskin
    from public.product_group_price_stats
   where group_id = p_group_id
   order by offer_count desc, currency asc
   limit 1;

  update public.product_groups g
     set offer_count     = coalesce(s.offer_count, 0),
         min_price_cents = s.min_price_cents,
         max_price_cents = s.max_price_cents,
         best_offer_id   = s.best_offer_id,
         price_currency  = v_baskin,
         updated_at      = now()
    from (
      select * from public.product_group_price_stats
       where group_id = p_group_id and currency = v_baskin
    ) s
   where g.id = p_group_id;

  if v_baskin is null then
    update public.product_groups
       set offer_count = 0, min_price_cents = null, max_price_cents = null,
           best_offer_id = null, price_currency = null, updated_at = now()
     where id = p_group_id;
  end if;
end;
$$;

comment on function public.refresh_product_group_stats is
  'Grup istatistiklerini PARA BIRIMI BASINA tazeler. Eski surumu tum '
  'teklifleri tek min() e sokuyordu ve dusuk mezhepli para birimi her zaman '
  'kazaniyordu -- "en ucuz" fiyata degil mezhebe gore secilirdi.';

create or replace function public.search_products_page(
  p_query      text default null,
  p_category_id uuid default null,
  p_currency   char(3) default null,
  p_min_price  bigint default null,
  p_max_price  bigint default null,
  p_limit      integer default 24,
  p_after_price bigint default null,
  p_after_id    uuid default null
)
returns table (
  group_id uuid,
  slug text,
  title text,
  brand text,
  image_url text,
  currency char(3),
  min_price_cents bigint,
  max_price_cents bigint,
  offer_count integer,
  best_offer_id uuid
)
language sql
stable
set search_path = ''
as $$
  select
    g.id, g.slug::text, g.title, g.brand, g.image_url,
    s.currency, s.min_price_cents, s.max_price_cents, s.offer_count, s.best_offer_id
  from public.product_group_price_stats s
  join public.product_groups g on g.id = s.group_id
  where s.offer_count > 0
    and (p_currency is null or s.currency = p_currency)
    and (p_category_id is null or g.category_id = p_category_id)
    and (p_currency is null or p_min_price is null or s.min_price_cents >= p_min_price)
    and (p_currency is null or p_max_price is null or s.min_price_cents <= p_max_price)
    and (
      p_query is null
      or g.search_text like '%' || public.normalize_search(p_query) || '%'
    )
    and (
      p_after_price is null or p_after_id is null
      or (s.min_price_cents, s.group_id) > (p_after_price, p_after_id)
    )
  order by s.min_price_cents asc, s.group_id asc
  limit greatest(1, least(coalesce(p_limit, 24), 100));
$$;

comment on function public.search_products_page is
  'Anahtar tabanli (keyset) sayfalama. offset 500000 veritabanina o kadar '
  'satiri okutup attirir ve son sayfalar pratikte acilmaz; keyset sabit '
  'maliyetlidir. Fiyat filtresi PARA BIRIMI ICINDE.';

alter table public.product_group_price_stats enable row level security;
create policy product_group_price_stats_public_read
  on public.product_group_price_stats for select using (true);
revoke all on public.product_group_price_stats from anon, authenticated;
grant select on public.product_group_price_stats to anon, authenticated;
grant select, insert, update, delete on public.product_group_price_stats to service_role;

revoke all on function public.search_products_page(text, uuid, char, bigint, bigint, integer, bigint, uuid) from public;
grant execute on function public.search_products_page(text, uuid, char, bigint, bigint, integer, bigint, uuid)
  to anon, authenticated, service_role;

do $$
declare r record;
begin
  for r in select id from public.product_groups loop
    perform public.refresh_product_group_stats(r.id);
  end loop;
end $$;

do $$
declare
  v_g uuid; v_v uuid; v_ucuz uuid; v_pahali uuid; v_m char(3);
begin
  select id into v_v from public.vendors limit 1;
  select code into v_m from public.markets order by code limit 1;
  if v_v is null then
    raise notice 'Dogrulama atlandi: vendor yok.';
    return;
  end if;

  insert into public.product_groups (slug, title) values ('goc-arama', 'Goc Arama')
    returning id into v_g;

  insert into public.products
    (vendor_id, group_id, external_id, title, price_cents, currency, stock, market_code)
  values (v_v, v_g, 'GOC-HUF', 'Goc HUF', 1200000, 'HUF', 5, v_m) returning id into v_pahali;

  insert into public.products
    (vendor_id, group_id, external_id, title, price_cents, currency, stock, market_code)
  values (v_v, v_g, 'GOC-USD', 'Goc USD', 9000, 'USD', 5, v_m) returning id into v_ucuz;

  if (select count(*) from public.product_group_price_stats where group_id = v_g) <> 2 then
    raise exception
      'DOGRULAMA 1: iki para birimi tek satira indi -- dusuk mezhepli olan '
      'her zaman kazanirdi.';
  end if;

  if (select best_offer_id from public.product_group_price_stats
       where group_id = v_g and currency = 'HUF') <> v_pahali
     or (select best_offer_id from public.product_group_price_stats
          where group_id = v_g and currency = 'USD') <> v_ucuz then
    raise exception 'DOGRULAMA 2: en iyi teklif para birimi icinde secilmedi.';
  end if;

  if (select price_currency from public.product_groups where id = v_g) is null then
    raise exception
      'DOGRULAMA 3: min/max fiyat etiketsiz kaldi -- ayni hatanin sessiz hali.';
  end if;

  if exists (
    select 1 from public.search_products_page(
      p_currency => 'USD', p_min_price => 100000, p_limit => 50)
     where group_id = v_g
  ) then
    raise exception
      'DOGRULAMA 4: USD filtresi HUF tutarini yakaladi -- para birimleri '
      'karisti.';
  end if;

  if not exists (
    select 1 from public.search_products_page(p_currency => 'USD', p_limit => 50)
     where group_id = v_g and min_price_cents = 9000
  ) then
    raise exception 'DOGRULAMA 4b: USD teklifi bulunamadi.';
  end if;

  update public.products set status = 'archived' where group_id = v_g;
  if (select offer_count from public.product_groups where id = v_g) <> 0
     or (select price_currency from public.product_groups where id = v_g) is not null then
    raise exception
      'DOGRULAMA 5: teklif kalmadi ama sayaclar eski degeri tasiyor -- '
      'satilmayan urun satiliyor gibi gorunurdu.';
  end if;

  delete from public.products where group_id = v_g;
  delete from public.product_groups where id = v_g;

  raise notice
    'Arama olcegi kuruldu: istatistik para birimi basina, en iyi teklif '
    'mezhebe gore secilmiyor, keyset sayfalama eklendi.';
end $$;