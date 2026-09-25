-- =============================================================================
-- price_drops: 26 sn -> 9 sn (üretimde ölçüldü), SONUÇ BİREBİR AYNI
-- =============================================================================
-- Üretim planı (Micro örnek, 30 gün / %5 / 24 satır) dört yavaş adım
-- gösteriyordu:
--   1) products TAMAMEN taranıyordu (98 MB, 8.7 sn) -- oysa yalnızca
--      id -> group_id eşlemesi gerekiyor.
--   2) price_points tarihe göre değil ürün+tarih indeksinden okunuyordu.
--   3) 13.374 aday grubun GENİŞ product_groups satırı tek tek okunuyordu
--      (13 sn); bunların yalnızca 24'ü döndürülüyor.
--   4) gruplama belleğe sığmayıp diske taşıyordu.
--
-- ÇÖZÜM, anlamı değiştirmeden:
--   * üç dar kapsayan indeks (toplam ~10 MB) -- index-only scan;
--   * iki aşamalı sorgu: önce dar indeksten ADAYLAR sıralanıp kesilir,
--     slug/başlık/görsel gibi geniş sütunlar yalnızca seçilen (<=100) satır
--     için okunur;
--   * `having` ile olcum_sayisi/ref_price elemesi gruplamada yapılır.
--
-- Sıralamaya `id` eklendi: eşit düşüş oranında sonuç artık deterministik
-- (önbellek anahtarı aynı cevabı versin diye). Eşitlik dışında sıra aynı.
--
-- Doğrulama (üretim): eski ve yeni sorgunun 24 satırlık çıktısının md5'i
-- aynı. Parametre sınırları 20260926090000'dakiyle aynı.
--
-- İndeksler üretimde `create index concurrently` ile kuruldu (yazmaları
-- kilitlemeden); burada `if not exists` olduğu için üretimde no-op, temiz
-- veritabanında normal kurulum.
-- =============================================================================

create index if not exists price_points_observed_covering_idx
  on public.price_points (observed_at) include (product_id, price_cents);

create index if not exists products_id_group_covering_idx
  on public.products (id) include (group_id);

create index if not exists product_groups_id_price_covering_idx
  on public.product_groups (id) include (min_price_cents, category_id);

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
     * Pencere içindeki EN YÜKSEK gözlenen fiyat: "şu fiyattan buraya düştü"
     * cümlesinin dayanağı gerçekten görülmüş bir fiyat olmalı. En az iki
     * ölçüm şartı gruplamada uygulanır.
     */
    select p.group_id,
           max(pp.price_cents)                                      as ref_price,
           (max(pp.observed_at)::date - min(pp.observed_at)::date)  as gun_araligi
      from public.price_points pp
      join public.products p on p.id = pp.product_id
     where pp.observed_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 730)))
       and p.group_id is not null
     group by p.group_id
    having count(*) >= 2
       and max(pp.price_cents) > 0
  ),
  aday as (
    -- Dar indeksten: yalnızca fiyat ve kategori okunur, geniş satır değil.
    select g.id,
           o.ref_price,
           o.gun_araligi,
           g.min_price_cents,
           1 - g.min_price_cents::numeric / o.ref_price as oran
      from gozlem o
      join public.product_groups g on g.id = o.group_id
     where g.min_price_cents is not null
       and g.min_price_cents <= o.ref_price * (1 - greatest(0.01, least(coalesce(p_min_drop_ratio, 0.05), 0.95)))
       and (p_category_id is null or g.category_id = p_category_id)
     order by oran desc, g.id
     limit greatest(1, least(coalesce(p_limit, 24), 100))
  )
  select g.id,
         g.slug,
         g.title,
         g.image_url,
         g.category_id,
         a.min_price_cents,
         a.ref_price,
         round(a.oran, 4),
         a.gun_araligi::int,
         g.offer_count
    from aday a
    join public.product_groups g on g.id = a.id
   order by a.oran desc, g.id;
$$;
