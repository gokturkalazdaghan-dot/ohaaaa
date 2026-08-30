-- ============================================================================
-- Fiyat geçmişi — grup seviyesinde
-- ----------------------------------------------------------------------------
-- NEDEN
-- price_points her teklifin her fiyat değişimini kaydediyor ama arayüz bunu
-- hiç göstermiyordu. Oysa bir fiyat karşılaştırma sitesinde en değerli veri
-- budur: "%16 indirim" etiketi ancak fiyatın gerçekten düştüğü gösterilirse
-- bir anlam taşır. Aksi hâlde satıcının kendi beyanını tekrarlamış oluruz.
--
-- Türkiye'de bu aynı zamanda bir mevzuat konusu: Ticari Reklam ve Haksız
-- Ticari Uygulamalar Yönetmeliği, indirimli satışlarda indirimden önceki
-- fiyatın son 30 gün içindeki EN DÜŞÜK fiyat olmasını arar. Geçmişi
-- göstermek bu iddiayı denetlenebilir kılar.
--
-- KULLANICI ÜRÜN GRUBU ARAR, TEKLİF DEĞİL
-- Ziyaretçi "iPhone 15 128GB ucuzladı mı" diye sorar; hangi mağazanın
-- teklifinin ucuzladığını değil. Bu yüzden geçmiş, gruptaki TÜM tekliflerin
-- o günkü EN DÜŞÜĞÜ üzerinden hesaplanır — sitenin sıralama ölçütüyle aynı.
-- ============================================================================

create or replace function public.price_history(
  p_group_id uuid,
  p_days     integer default 90
)
returns table (
  day             date,
  min_price_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select (current_date - (greatest(1, least(p_days, 730)) - 1))::date as first_day
  ),
  -- Gruptaki teklifler
  offers as (
    select p.id
      from public.products p
     where p.group_id = p_group_id
       and p.status = 'active'
  ),
  -- Her teklifin her gün için BİLİNEN son fiyatı.
  -- price_points yalnızca DEĞİŞİMDE satır yazar (tabloyu şişirmemek için);
  -- bu yüzden "o gün gözlem yoksa fiyat yok" demek yanlış olur — fiyat
  -- değişmediği için gözlem yoktur. Son bilinen fiyat ileriye taşınır.
  observations as (
    select pp.product_id,
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
    select product_id, day, price_cents
      from observations
     where rn = 1
  ),
  calendar as (
    select generate_series((select first_day from bounds), current_date, interval '1 day')::date as day
  ),
  -- Takvim x teklif: her gün için o teklifin son bilinen fiyatı
  filled as (
    select c.day,
           o.id as product_id,
           (select d.price_cents
              from daily d
             where d.product_id = o.id
               and d.day <= c.day
             order by d.day desc
             limit 1) as price_cents
      from calendar c
      cross join offers o
  )
  select f.day, min(f.price_cents)::bigint as min_price_cents
    from filled f
   where f.price_cents is not null
   group by f.day
   order by f.day;
$$;

comment on function public.price_history(uuid, integer) is
  'Ürün grubunun günlük en düşük fiyatı. Gözlem olmayan günlerde son bilinen fiyat taşınır.';

grant execute on function public.price_history(uuid, integer) to anon, authenticated;
