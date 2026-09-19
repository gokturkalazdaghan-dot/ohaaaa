drop function if exists public.price_history(uuid, integer);

create function public.price_history(p_group_id uuid, p_days integer default 90)
returns table (day date, currency char(3), min_price_cents bigint)
language sql
stable
security definer
set search_path = 'public'
as $$
  with bounds as (
    select (current_date - (greatest(1, least(p_days, 730)) - 1))::date as first_day
  ),
  offers as (
    select p.id
      from public.products p
     where p.group_id = p_group_id
       and p.status = 'active'
  ),
  observations as (
    select pp.product_id,
           pp.currency,
           pp.observed_at::date as day,
           pp.price_cents,
           row_number() over (
             partition by pp.product_id, pp.observed_at::date
             order by pp.observed_at desc
           ) as rn
      from public.price_points pp
      join offers o on o.id = pp.product_id
     where pp.in_stock
  ),
  daily as (
    select product_id, currency, day, price_cents
      from observations
     where rn = 1
  ),
  calendar as (
    select generate_series((select first_day from bounds), current_date, interval '1 day')::date as day
  ),
  filled as (
    select c.day,
           o.id as product_id,
           (select d.price_cents
              from daily d
             where d.product_id = o.id and d.day <= c.day
             order by d.day desc limit 1) as price_cents,
           (select d.currency
              from daily d
             where d.product_id = o.id and d.day <= c.day
             order by d.day desc limit 1) as currency
      from calendar c
      cross join offers o
  )
  select f.day, f.currency, min(f.price_cents)::bigint
    from filled f
   where f.price_cents is not null and f.currency is not null
   group by f.day, f.currency
   order by f.day, f.currency;
$$;

comment on function public.price_history is
  'Gunluk en dusuk fiyat, PARA BIRIMI BASINA. Para birimini yok sayan bir '
  'min() 10 USD ile 10 TRY yi esit sayar ve "en dusuk fiyat" grafigi iki '
  'farkli seyi tek cizgide gosterir -- sessiz ve yanlis.';

create or replace function public.product_offer_breakdown(p_group_id uuid)
returns table (
  product_id uuid,
  merchant_id uuid,
  merchant_slug text,
  merchant_name text,
  fulfillment public.fulfillment_kind,
  price_cents bigint,
  shipping_fee_cents bigint,
  total_cents bigint,
  currency char(3),
  in_stock boolean,
  estimated_delivery_days integer,
  last_seen_at timestamptz,
  price_age_hours numeric
)
language sql
stable
set search_path = ''
as $$
  select
    p.id,
    p.merchant_id,
    m.slug::text,
    coalesce(m.display_name, v.display_name),
    p.fulfillment,
    p.price_cents,
    p.shipping_fee_cents,
    p.price_cents + p.shipping_fee_cents,
    p.currency,
    p.stock > 0,
    p.estimated_delivery_days,
    p.last_seen_at,
    case when p.last_seen_at is null then null
         else round(extract(epoch from (now() - p.last_seen_at)) / 3600.0, 1)
    end
  from public.products p
  left join public.merchants m on m.id = p.merchant_id
  left join public.vendors   v on v.id = p.vendor_id
  where p.group_id = p_group_id
    and p.status = 'active'
  order by p.currency, (p.price_cents + p.shipping_fee_cents), p.estimated_delivery_days;
$$;

comment on function public.product_offer_breakdown is
  'Magaza magaza teklifler. min() ile tek satira indirmek, kullanicinin '
  'asil sorusunu (hangi magaza, ne kadar, ne kadar surede) cevapsiz '
  'birakir. Kargo ve stok fiyattan AYRI doner.';

create or replace function public.price_anomaly(
  p_product_id uuid,
  p_days integer default 90,
  p_drop_ratio numeric default 0.80,
  p_spike_ratio numeric default 5.00
)
returns table (
  product_id uuid,
  currency char(3),
  current_price_cents bigint,
  median_price_cents bigint,
  observed_points integer,
  verdict text
)
language sql
stable
security definer
set search_path = ''
as $$
  with son as (
    select p.id, p.currency, p.price_cents
      from public.products p
     where p.id = p_product_id
  ),
  gecmis as (
    select pp.price_cents
      from public.price_points pp
      join son s on s.id = pp.product_id and s.currency = pp.currency
     where pp.observed_at >= now() - make_interval(days => greatest(1, least(p_days, 730)))
       and pp.in_stock
  ),
  ozet as (
    select
      count(*)::int as n,
      percentile_cont(0.5) within group (order by price_cents)::bigint as ortanca
    from gecmis
  )
  select
    s.id, s.currency, s.price_cents, o.ortanca, o.n,
    case
      when o.n < 5 then 'insufficient_history'
      when o.ortanca is null or o.ortanca = 0 then 'insufficient_history'
      when s.price_cents <= o.ortanca * (1 - p_drop_ratio) then 'suspicious_drop'
      when s.price_cents >= o.ortanca * p_spike_ratio then 'suspicious_spike'
      else 'normal'
    end
  from son s cross join ozet o;
$$;

comment on function public.price_anomaly is
  'Fiyat gecmisine gore supheli mi. KARAR VERMEZ, OLCER: esik disi fiyat '
  'silinmez -- otomatik silme gercek bir kampanyayi da yok ederdi. Yetersiz '
  'gozlem bir hukum degildir.';

revoke all on function public.price_history(uuid, integer) from public;
grant execute on function public.price_history(uuid, integer) to anon, authenticated, service_role;

revoke all on function public.product_offer_breakdown(uuid) from public;
grant execute on function public.product_offer_breakdown(uuid) to anon, authenticated, service_role;

revoke all on function public.price_anomaly(uuid, integer, numeric, numeric) from public;
revoke all on function public.price_anomaly(uuid, integer, numeric, numeric) from anon, authenticated;
grant execute on function public.price_anomaly(uuid, integer, numeric, numeric) to service_role;

do $$
declare
  v_g uuid; v_v uuid; v_p1 uuid; v_p2 uuid; v_say integer;
begin
  select id into v_v from public.vendors limit 1;
  if v_v is null then
    raise notice 'Dogrulama atlandi: vendor yok.';
    return;
  end if;

  insert into public.product_groups (slug, title) values ('goc-fiyat-zeka', 'Goc Fiyat')
    returning id into v_g;

  insert into public.products
    (vendor_id, group_id, external_id, title, price_cents, currency, stock, market_code)
       values (v_v, v_g, 'GOC-USD', 'Goc USD', 1000, 'USD', 5,
               (select code from public.markets order by code limit 1))
    returning id into v_p1;
  insert into public.products
    (vendor_id, group_id, external_id, title, price_cents, currency, stock, market_code)
       values (v_v, v_g, 'GOC-TRY', 'Goc TRY', 1000, 'TRY', 5,
               (select code from public.markets order by code limit 1))
    returning id into v_p2;

  select count(*) into v_say
    from public.price_history(v_g, 7)
   where day = current_date;
  if v_say <> 2 then
    raise exception
      'DOGRULAMA 1: gunluk % satir dondu, 2 bekleniyordu -- para birimleri '
      'karisti ve 10 USD ile 10 TRY esit sayildi.', v_say;
  end if;

  if not exists (select 1 from public.price_history(v_g, 7) where currency = 'USD')
     or not exists (select 1 from public.price_history(v_g, 7) where currency = 'TRY') then
    raise exception 'DOGRULAMA 2: para birimi sutunu dolmadi.';
  end if;

  select count(*) into v_say from public.product_offer_breakdown(v_g);
  if v_say <> 2 then
    raise exception
      'DOGRULAMA 3: kirilimda % teklif var, 2 bekleniyordu -- min() ile tek '
      'satira indirilmis olurdu.', v_say;
  end if;

  update public.products set shipping_fee_cents = 300 where id = v_p1;
  if not exists (
    select 1 from public.product_offer_breakdown(v_g)
     where product_id = v_p1 and price_cents = 1000
       and shipping_fee_cents = 300 and total_cents = 1300
  ) then
    raise exception 'DOGRULAMA 4: kargo fiyattan ayrilmadi ya da toplam yanlis.';
  end if;

  if (select verdict from public.price_anomaly(v_p1)) <> 'insufficient_history' then
    raise exception
      'DOGRULAMA 5: uc gozlemle hukum verildi -- yeni eklenen her urun '
      'supheli ilan edilirdi.';
  end if;

  delete from public.products where id in (v_p1, v_p2);
  delete from public.product_groups where id = v_g;

  raise notice
    'Fiyat zekasi kuruldu: gecmis para birimlerini karistirmiyor, magaza '
    'kirilimi teklif kaybetmiyor, kargo fiyattan ayri, yetersiz gozlem hukum degil.';
end $$;