-- ============================================================================
-- ARAMA FİLTRELERİ — marka ve ücretsiz kargo
-- ----------------------------------------------------------------------------
-- Arama yalnızca kategori ve fiyat aralığıyla daraltılabiliyordu. Bir fiyat
-- karşılaştırma sitesinde en çok kullanılan iki filtre eksikti:
--
--   • MARKA — "kulaklık" arayan biri neredeyse her zaman bir markayı süzer.
--   • ÜCRETSİZ KARGO — sitenin kendi vaadi "kargo dahil fiyat"; kargosuz
--     teklifi ayrıca görebilmek bu vaadin doğal uzantısı.
--
-- İMZA GENİŞLETİLİYOR, ESKİSİ DE DURUYOR
-- Yeni parametreler varsayılan değer taşır, yani eski çağrı biçimi aynen
-- çalışır. Web tarafı da göç uygulanmadan önce yeni parametreleri
-- göndermeyi denerse hatayı yakalayıp eski imzayla tekrar dener; böylece
-- göç ile dağıtım arasındaki pencerede arama HİÇ bozulmaz.
--
-- ÜCRETSİZ KARGO NEDEN EXISTS İLE
-- Kargo ücreti TEKLİF bazındadır (products.shipping_fee_cents), kanonik
-- ürün bazında değil. "Ücretsiz kargosu olan" bir ürün grubu = en az bir
-- aktif teklifi kargosuz olan grup. Grup tablosuna türetilmiş bir sütun
-- koymak daha hızlı olurdu ama her fiyat güncellemesinde bayatlar; doğru
-- cevap, bayat olmayan cevaptır.
-- ============================================================================

-- Ücretsiz kargolu aktif teklifin hızlı bulunması için kısmi indeks.
-- Kısmi: yalnızca aradığımız satırları kapsar, indeks küçük kalır.
create index if not exists products_free_shipping_idx
  on public.products (group_id)
  where status = 'active' and shipping_fee_cents = 0;

drop function if exists public.search_products(text, uuid, bigint, bigint, text, integer, integer);
drop function if exists public.search_products(text, uuid, bigint, bigint, text, integer, integer, text[], boolean);

create function public.search_products(
  p_query         text default null,
  p_category_id   uuid default null,
  p_min_price     bigint default null,
  p_max_price     bigint default null,
  p_sort          text default 'relevance',
  p_limit         integer default 24,
  p_offset        integer default 0,
  p_brands        text[] default null,
  p_free_shipping boolean default false
)
returns table (
  group_id         uuid,
  slug             citext,
  title            text,
  brand            text,
  image_url        text,
  offer_count      integer,
  min_price_cents  bigint,
  max_price_cents  bigint,
  best_offer_id    uuid,
  best_vendor_id   uuid,
  best_vendor_name text,
  relevance        real,
  total_count      bigint
)
language sql
stable
set search_path to 'public'
as $$
  with params as (
    select public.normalize_search(nullif(trim(coalesce(p_query, '')), '')) as q
  ),
  tokens as (
    select t.tok
    from params, lateral unnest(string_to_array(params.q, ' ')) as t(tok)
    where params.q is not null and length(t.tok) > 0
  ),
  matched as (
    select
      g.id, g.slug, g.title, g.brand, g.image_url, g.offer_count,
      g.min_price_cents, g.max_price_cents, g.best_offer_id,
      case
        when pr.q is null then 1.0::real
        else
          ts_rank(to_tsvector('simple', g.search_text),
                  plainto_tsquery('simple', pr.q)) * 4.0
          + case when g.search_text like '%' || pr.q || '%' then 1.0 else 0.0 end
          + similarity(g.search_text, pr.q)
          + case when g.search_text like pr.q || '%' then 0.5 else 0.0 end
      end::real as relevance
    from public.product_groups g
    cross join params pr
    where g.offer_count > 0
      and (
        p_category_id is null
        or g.category_id = p_category_id
        or g.category_id in (
          select c.id from public.categories c where c.parent_id = p_category_id
        )
      )
      and (p_min_price is null or g.min_price_cents >= p_min_price)
      and (p_max_price is null or g.min_price_cents <= p_max_price)
      -- Marka karsilastirmasi BUYUK/KUCUK HARFTEN bagimsiz: besleme
      -- "Sony", "SONY" ve "sony" gonderebilir; kullaniciya bunlarin ayri
      -- marka gibi gorunmesi hata olurdu.
      and (
        p_brands is null
        or cardinality(p_brands) = 0
        or lower(g.brand) = any (select lower(b) from unnest(p_brands) as b)
      )
      and (
        not coalesce(p_free_shipping, false)
        or exists (
          select 1 from public.products p
          where p.group_id = g.id
            and p.status = 'active'
            and p.shipping_fee_cents = 0
        )
      )
      and (
        pr.q is null
        or not exists (
          select 1 from tokens t
          where not (
            g.search_text like '%' || t.tok || '%'
            or word_similarity(t.tok, g.search_text) >= 0.45
          )
        )
      )
  )
  select
    m.id, m.slug, m.title, m.brand, m.image_url, m.offer_count,
    m.min_price_cents, m.max_price_cents, m.best_offer_id,
    coalesce(v.id, mer.id),
    coalesce(v.display_name, mer.display_name),
    m.relevance,
    count(*) over ()::bigint
  from matched m
  left join public.products  bp  on bp.id = m.best_offer_id
  left join public.vendors   v   on v.id = bp.vendor_id
  left join public.merchants mer on mer.id = bp.merchant_id
  order by
    case when p_sort = 'price_asc'  then m.min_price_cents end asc nulls last,
    case when p_sort = 'price_desc' then m.min_price_cents end desc nulls last,
    case when p_sort = 'offers'     then m.offer_count end desc nulls last,
    case when p_sort = 'relevance'  then m.relevance end desc nulls last,
    m.title asc
  limit greatest(1, least(coalesce(p_limit, 24), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.search_products is
  'Kanonik urun grubu bazinda arama. total_count filtreye uyan toplam sonucu verir. p_brands ve p_free_shipping istege baglidir.';

grant execute on function public.search_products(
  text, uuid, bigint, bigint, text, integer, integer, text[], boolean
) to anon, authenticated;

-- ===========================================================================
-- search_facets — marka listesi ve kargo sayaci eklendi
-- ---------------------------------------------------------------------------
-- Fiyat sinirlarindaki kural marka icin de gecerli: BIR FILTRE, KENDI
-- sayacini daraltmaz. Kullanici "Sony" sectiginde diger markalarin sayilari
-- gorunur kalmali, yoksa secimini genisletemez -- filtreyi kaldirip tekrar
-- denemek zorunda kalir.
-- ===========================================================================
drop function if exists public.search_facets(text, uuid);
drop function if exists public.search_facets(text, uuid, text[], boolean);

create function public.search_facets(
  p_query         text default null,
  p_category_id   uuid default null,
  p_brands        text[] default null,
  p_free_shipping boolean default false
)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with params as (
    select public.normalize_search(nullif(trim(coalesce(p_query, '')), '')) as q
  ),
  tokens as (
    select t.tok
    from params, lateral unnest(string_to_array(params.q, ' ')) as t(tok)
    where params.q is not null and length(t.tok) > 0
  ),
  -- Metin eslesmesi: butun sayaclarin ortak tabani.
  matched as (
    select g.id, g.category_id, g.min_price_cents, g.brand
    from public.product_groups g
    cross join params pr
    where g.offer_count > 0
      and (
        pr.q is null
        or not exists (
          select 1 from tokens t
          where not (
            g.search_text like '%' || t.tok || '%'
            or word_similarity(t.tok, g.search_text) >= 0.45
          )
        )
      )
  ),
  free_shipping_groups as (
    select distinct p.group_id
    from public.products p
    where p.status = 'active' and p.shipping_fee_cents = 0
  ),
  -- Kategori kapsami: kategori secimi disindaki filtreler uygulanir.
  in_category as (
    select m.*
    from matched m
    where p_category_id is null
       or m.category_id = p_category_id
       or m.category_id in (select c.id from public.categories c where c.parent_id = p_category_id)
  ),
  by_category as (
    select c.id, c.slug, c.name, count(m.id) as n
    from public.categories c
    left join matched m
      on (m.category_id = c.id
          or m.category_id in (select c2.id from public.categories c2 where c2.parent_id = c.id))
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
    select m.min_price_cents
    from in_category m
    where (
        p_brands is null or cardinality(p_brands) = 0
        or lower(m.brand) = any (select lower(b) from unnest(p_brands) as b)
      )
      and (
        not coalesce(p_free_shipping, false)
        or m.id in (select group_id from free_shipping_groups)
      )
  )
  select jsonb_build_object(
    'min_price_cents', (select min(min_price_cents) from price_scope),
    'max_price_cents', (select max(min_price_cents) from price_scope),
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
$$;

comment on function public.search_facets is
  'Arama filtre seridi: fiyat sinirlari, kategori sayaclari, marka sayaclari ve ucretsiz kargo sayisi. Her filtre KENDI sayacini daraltmaz.';

grant execute on function public.search_facets(text, uuid, text[], boolean)
  to anon, authenticated;
