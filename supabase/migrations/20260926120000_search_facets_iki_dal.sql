-- =============================================================================
-- search_facets: arama metinsiz yol dar indeksten okunuyor
-- =============================================================================
-- Filtresiz facet çağrısı üretimde 4,8-11,8 sn sürüyordu; maliyetin çoğu
-- `product_groups`'un tamamının (~200 MB, search_text dahil) okunmasıydı.
-- Oysa arama metni yokken yalnızca id/kategori/fiyat/marka/para birimi
-- gerekiyor. `matched` iki dala bölündü; metinsiz dal
-- product_groups_facet_covering_idx (20260926110000) üzerinden okunur.
-- Üretimde eski ve yeni çıktı karşılaştırıldı.
-- =============================================================================

create or replace function public.search_facets(
  p_query         text default null,
  p_category_id   uuid default null,
  p_brands        text[] default null,
  p_free_shipping boolean default false,
  p_currency      char(3) default null
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with params as (
    select public.normalize_search(nullif(trim(coalesce(p_query, '')), '')) as q
  ),
  tokens as (
    select t.tok
    from params, lateral unnest(string_to_array(params.q, ' ')) as t(tok)
    where params.q is not null and length(t.tok) > 0
  ),
  -- Metin eslesmesi: butun sayaclarin ortak tabani.
  /*
   * İKİ DAL. Arama metni yokken (kategori sayfası) `search_text` hiç
   * okunmaz; dal yalnızca dar kısmi indeksten
   * (product_groups_facet_covering_idx) beslenir. Tek dal hâlinde koşulda
   * `search_text` geçtiği için planlayıcı, metin boş olsa bile ~200 MB'lık
   * tabloyu okumak zorundaydı. Dallar birbirini dışlar (q null / değil);
   * sonuç kümesi eskisiyle aynıdır.
   */
  matched as (
    select g.id, g.category_id, g.min_price_cents, g.brand, g.price_currency
    from public.product_groups g
    where (select q from params) is null
      and g.offer_count > 0
      and (p_currency is null or g.price_currency = p_currency)
    union all
    select g.id, g.category_id, g.min_price_cents, g.brand, g.price_currency
    from public.product_groups g
    cross join params pr
    where pr.q is not null
      and g.offer_count > 0
      and (p_currency is null or g.price_currency = p_currency)
      and not exists (
        select 1 from tokens t
        where not (
          g.search_text like '%' || t.tok || '%'
          or word_similarity(t.tok, g.search_text) >= 0.45
        )
      )
  ),
  free_shipping_groups as (
    select distinct p.group_id
    from public.products p
    where p.status = 'active' and p.shipping_fee_cents = 0
  ),
  secili_kapsam as (
    select k.category_id from public.kategori_kapsami(p_category_id) k
     where p_category_id is not null
  ),
  -- Kategori kapsami: kategori secimi disindaki filtreler uygulanir.
  in_category as (
    select m.*
    from matched m
    where p_category_id is null
       or m.category_id in (select category_id from secili_kapsam)
  ),
  /*
   * ANA KATEGORİ SAYAÇLARI ÜÇ SEVİYEYİ TOPLAR.
   *
   * `kategori_kapsami` her ana kategori için BİR KEZ çağrılıyor ve sonuç
   * `product_groups_kategori_sayim_idx` üzerinden eşleniyor. Eski hâl her
   * ana kategori satırı için yeniden koşan bir `in (select ...)` alt
   * sorgusuydu; üretim verisinde 4.097 ms, bu şekil 46 ms (ölçüldü).
   */
  by_category as (
    select c.id, c.slug, c.name, count(m.id) as n
    from public.categories c
    left join lateral (select category_id from public.kategori_kapsami(c.id)) k on true
    left join matched m
      on m.category_id = k.category_id
      and (
        p_brands is null or cardinality(p_brands) = 0
        or lower(m.brand) = any (select lower(b) from unnest(p_brands) as b)
      )
      and (
        not coalesce(p_free_shipping, false)
        or m.id in (select group_id from free_shipping_groups)
      )
    where c.is_active and c.parent_id is null
    group by c.id, c.slug, c.name, c.sort_order
    order by c.sort_order
  ),
  -- Marka sayaci: MARKA filtresi disindaki her sey uygulanir.
  by_brand as (
    select m.brand, count(*) as n
    from in_category m
    where m.brand is not null and length(trim(m.brand)) > 0
      and (
        not coalesce(p_free_shipping, false)
        or m.id in (select group_id from free_shipping_groups)
      )
    group by m.brand
    order by count(*) desc, m.brand asc
    limit 40
  ),
  -- Kargo sayaci: KARGO filtresi disindaki her sey uygulanir.
  shipping_count as (
    select count(*) as n
    from in_category m
    where m.id in (select group_id from free_shipping_groups)
      and (
        p_brands is null or cardinality(p_brands) = 0
        or lower(m.brand) = any (select lower(b) from unnest(p_brands) as b)
      )
  ),
  -- Fiyat sinirlari: fiyat DISINDAKI filtreler uygulanir.
  price_scope as (
    select m.min_price_cents, m.price_currency
    from in_category m
    where (
        p_brands is null or cardinality(p_brands) = 0
        or lower(m.brand) = any (select lower(b) from unnest(p_brands) as b)
      )
      and (
        not coalesce(p_free_shipping, false)
        or m.id in (select group_id from free_shipping_groups)
      )
  ),
  -- Tek para birimi yoksa sinir VERILMEZ: farkli mezhepleri tek araliga
  -- sokmak kullaniciya anlamsiz bir kaydirac gosterirdi.
  price_bounds as (
    select
      case when count(distinct price_currency) <= 1 then min(min_price_cents) end as lo,
      case when count(distinct price_currency) <= 1 then max(min_price_cents) end as hi
    from price_scope
  )
  select jsonb_build_object(
    'min_price_cents', (select lo from price_bounds),
    'max_price_cents', (select hi from price_bounds),
    'free_shipping_count', (select n from shipping_count),
    'categories', coalesce(
      (select jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'count', n))
         from by_category),
      '[]'::jsonb
    ),
    'brands', coalesce(
      (select jsonb_agg(jsonb_build_object('name', brand, 'count', n)) from by_brand),
      '[]'::jsonb
    )
  );
$function$;
