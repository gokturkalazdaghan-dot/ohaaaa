-- ===========================================================================
-- Arama onerileri (yazarken tamamlama)
-- ---------------------------------------------------------------------------
-- NEDEN
-- Arama kutusu tamamen "kor"du: kullanici ne yazacagini bilmek zorundaydi.
-- Buyuk pazar yerlerinde oneri seridi bir susleme degil, aramanin kendisidir -
-- ziyaretcinin buyuk kismi yazdigini bitirmeden bir oneriye tiklar. Yazim
-- hatasi, eksik marka adi ve "ne aradigimi bilmiyorum" durumlarinin cogu
-- burada cozulur.
--
-- UC TUR ONERI, BILINCLI SIRAYLA
--   1. Marka   - "sam" -> "Samsung". En kisa yol; kullanici markayi biliyorsa
--                bir kelimeyle butun bir vitrine ulasir.
--   2. Kategori- "kula" -> "Kulaklik". Niyet genelse dogru yer burasi.
--   3. Urun    - tam urun basligi. En spesifik, en asagida.
--
-- Her oneri KAC SONUC verdigini de dondurur. Sonuc vermeyen bir oneri hic
-- gosterilmez: tikladiginda bos sayfa acan bir oneri, oneri degil tuzaktir.
-- ===========================================================================

create or replace function public.search_suggestions(
  p_query text,
  p_limit integer default 8
)
returns table (
  suggestion   text,
  kind         text,
  slug         text,
  result_count bigint
)
language sql
stable
set search_path to 'public'
as $$
  with params as (
    select public.normalize_search(nullif(trim(coalesce(p_query, '')), '')) as q
  ),
  -- --- Markalar ------------------------------------------------------------
  brands as (
    select
      g.brand as suggestion,
      'marka'::text as kind,
      null::text as slug,
      count(*)::bigint as result_count,
      -- Basta eslesen, icinde gecenden once gelir: "sam" yazan Samsung'u
      -- bekler, "Wilsam"i degil.
      case when public.normalize_search(g.brand) like pr.q || '%' then 0 else 1 end as rank
    from public.product_groups g
    cross join params pr
    where pr.q is not null
      and g.offer_count > 0
      and g.brand is not null
      and public.normalize_search(g.brand) like '%' || pr.q || '%'
    group by g.brand, pr.q
  ),
  -- --- Kategoriler ---------------------------------------------------------
  cats as (
    select
      c.name as suggestion,
      'kategori'::text as kind,
      c.slug::text as slug,
      count(g.id)::bigint as result_count,
      case when public.normalize_search(c.name) like pr.q || '%' then 0 else 1 end as rank
    from public.categories c
    cross join params pr
    left join public.product_groups g
      on (g.category_id = c.id
          or g.category_id in (select c2.id from public.categories c2 where c2.parent_id = c.id))
      and g.offer_count > 0
    where pr.q is not null
      and c.is_active
      and public.normalize_search(c.name) like '%' || pr.q || '%'
    group by c.id, c.name, c.slug, pr.q
  ),
  -- --- Urunler -------------------------------------------------------------
  -- offer_count zaten "kac magaza teklif veriyor" demek; oneri seridinde
  -- gosterilen sayi budur.
  items as (
    select
      g.title as suggestion,
      'urun'::text as kind,
      g.slug::text as slug,
      g.offer_count::bigint as result_count,
      case when g.search_text like pr.q || '%' then 0 else 1 end as rank
    from public.product_groups g
    cross join params pr
    where pr.q is not null
      and g.offer_count > 0
      and g.search_text like '%' || pr.q || '%'
  ),
  merged as (
    select *, 0 as kind_rank from brands
    union all
    select *, 1 as kind_rank from cats
    union all
    select *, 2 as kind_rank from items
  )
  select m.suggestion, m.kind, m.slug, m.result_count
  from merged m
  -- Sonuc vermeyen oneri gosterilmez.
  where m.result_count > 0
  order by m.rank, m.kind_rank, m.result_count desc, m.suggestion
  limit greatest(1, least(coalesce(p_limit, 8), 20));
$$;

comment on function public.search_suggestions(text, integer) is
  'Yazarken tamamlama: marka, kategori ve urun onerileri, her biri kac sonuc verdigiyle.';

grant execute on function public.search_suggestions(text, integer) to anon, authenticated;
