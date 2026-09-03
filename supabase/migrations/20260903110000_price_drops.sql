-- ============================================================================
-- FİYATI DÜŞENLER — kendi ölçtüğümüz düşüş
-- ----------------------------------------------------------------------------
-- "Fırsat" sayfasının dürüst tanımı budur: mağazanın üstü çizili fiyatı değil,
-- BİZİM gözlemimiz. `price_points` zaten her fiyat değişimini kaydediyor;
-- burada yapılan tek şey o gözlemi okumak.
--
-- Mağazanın `compare_at_price_cents` alanı KULLANILMAZ. O bir pazarlama
-- verisidir ve sitenin Hakkımızda sayfasında "ona güvenmiyoruz" yazıyor.
-- Fırsat listesini o alandan üretmek, yazdığımızın tersini yapmak olurdu.
--
-- VERİ YOKSA SATIR YOK
-- Yeterli gözlem yoksa (tek ölçüm, ya da referans fiyat bugünkü fiyatla aynı)
-- ürün listeye GİRMEZ. Boş bir fırsat sayfası, uydurma bir fırsattan iyidir.
-- ============================================================================

create or replace function public.price_drops(
  p_days           int     default 30,
  p_min_drop_ratio numeric default 0.05,
  p_category_id    uuid    default null,
  p_limit          int     default 24
)
returns table (
  group_id            uuid,
  slug                text,
  title               text,
  image_url           text,
  category_id         uuid,
  current_price_cents bigint,
  reference_price_cents bigint,
  drop_ratio          numeric,
  observed_days       int,
  offer_count         int
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with gozlem as (
    /*
     * Her ürün grubu için pencere içindeki EN YÜKSEK gözlenen fiyat ve
     * gözlemin kaç güne yayıldığı. Referans olarak ortalama değil azami
     * alınır: "şu fiyattan buraya düştü" cümlesinin dayanağı, gerçekten
     * görülmüş bir fiyat olmalı.
     */
    select p.group_id,
           max(pp.price_cents)                                  as ref_price,
           (max(pp.observed_at)::date - min(pp.observed_at)::date) as gun_araligi,
           count(*)                                             as olcum_sayisi
      from public.price_points pp
      join public.products p on p.id = pp.product_id
     where pp.observed_at > now() - make_interval(days => p_days)
       and p.group_id is not null
     group by p.group_id
  )
  select g.id,
         g.slug,
         g.title,
         g.image_url,
         g.category_id,
         g.min_price_cents,
         o.ref_price,
         round(1 - g.min_price_cents::numeric / o.ref_price, 4),
         o.gun_araligi::int,
         g.offer_count
    from public.product_groups g
    join gozlem o on o.group_id = g.id
   where g.min_price_cents is not null
     and o.ref_price > 0
     -- Düşüş eşiği geçmiş olmalı: bir kuruşluk oynama fırsat değildir.
     and g.min_price_cents <= o.ref_price * (1 - p_min_drop_ratio)
     /*
      * EN AZ İKİ ÖLÇÜM. Tek ölçümle "düştü" demek, hiç ölçmeden demekle
      * aynı şey: karşılaştırılacak bir önceki değer yok.
      */
     and o.olcum_sayisi >= 2
     and (p_category_id is null or g.category_id = p_category_id)
   order by (1 - g.min_price_cents::numeric / o.ref_price) desc
   limit p_limit;
$$;

comment on function public.price_drops is
  'Kendi gozlemimize gore fiyati dusen urun gruplari. Magazanin ustu cizili fiyati KULLANILMAZ.';

-- Herkese açık: fırsat listesi sitenin vitrini ve kişisel veri içermiyor.
grant execute on function public.price_drops(int, numeric, uuid, int)
  to anon, authenticated, service_role;
