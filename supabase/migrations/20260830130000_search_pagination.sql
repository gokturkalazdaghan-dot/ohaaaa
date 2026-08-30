-- ===========================================================================
-- Arama: sayfalama, fiyat aralığı ve filtre sayaçları
-- ---------------------------------------------------------------------------
-- NEDEN
-- Arayuz aramayi tek sayfada 48 sonuca sabitlemisti. 48'inci urunden sonrasi
-- ziyaretciye HIC gorunmuyordu; katalog buyudukce bu sessiz bir veri kaybi
-- olur. Sayfalama yapabilmek icin toplam sonuc sayisi lazim, ama ikinci bir
-- "count" sorgusu ayni filtreleri ikinci kez yazmak demek - iki kopya zamanla
-- ayrisir ve sayfa sayisi yanlis cikar.
--
-- Cozum: search_products ayni sorgu icinde pencere fonksiyonuyla total_count
-- dondurur. Pencere fonksiyonu LIMIT'ten ONCE hesaplanir, yani doner deger
-- "bu filtrelere uyan toplam urun" olur, "bu sayfadaki urun" degil.
--
-- Donen sutun eklendigi icin fonksiyon CREATE OR REPLACE ile guncellenemez;
-- once dusurulur. Imza aynen korunur, cagiranlarin degismesi gerekmez.
--
-- Ayrica search_facets eklendi: filtre seridinin gercek sinirlari (en ucuz /
-- en pahali) ve her kategorideki sonuc sayisi. Boylece fiyat filtresi
-- uydurma bir araliga degil, o aramanin gercek verisine dayanir; sonuc
-- vermeyecek kategoriler de kullaniciya sunulmaz.
-- ===========================================================================

drop function if exists public.search_products(text, uuid, bigint, bigint, text, integer, integer);

create function public.search_products(
  p_query       text default null,
  p_category_id uuid default null,
  p_min_price   bigint default null,
  p_max_price   bigint default null,
  p_sort        text default 'relevance',
  p_limit       integer default 24,
  p_offset      integer default 0
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
      -- Ust kategori secildiginde alt kategorilerdeki urunler de dahil olur;
      -- "Elektronik" diyen kullanici "Telefon"u da gormeyi bekler.
      and (
        p_category_id is null
        or g.category_id = p_category_id
        or g.category_id in (
          select c.id from public.categories c where c.parent_id = p_category_id
        )
      )
      and (p_min_price is null or g.min_price_cents >= p_min_price)
      and (p_max_price is null or g.min_price_cents <= p_max_price)
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
    -- LIMIT'ten once hesaplanir: filtreye uyan TOPLAM sonuc.
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
  'Kanonik urun grubu bazinda arama + fiyat karsilastirma sonucu. total_count filtreye uyan toplam sonucu verir (sayfalama icin).';

grant execute on function public.search_products(text, uuid, bigint, bigint, text, integer, integer)
  to anon, authenticated;

-- ===========================================================================
-- search_facets — filtre seridinin gercek sinirlari
-- ---------------------------------------------------------------------------
-- Fiyat filtresini uydurma bir aralikla ("0 - 100.000 TL") sunmak kullaniciyi
-- bos sonuca goturur. Bu fonksiyon o aramanin GERCEK en ucuz/en pahali
-- degerini ve kategori basina sonuc sayisini dondurur.
--
-- Onemli: fiyat sinirlari hesaplanirken p_min_price/p_max_price UYGULANMAZ.
-- Uygulansaydi kullanici araligi daralttikca kaydirici da daralir, geri
-- genisletmek imkansiz hale gelirdi.
-- ===========================================================================
create or replace function public.search_facets(
  p_query       text default null,
  p_category_id uuid default null
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
  matched as (
    select g.id, g.category_id, g.min_price_cents
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
  -- Kategori sayaclari: kategori filtresi UYGULANMADAN, boylece kullanici
  -- baska bir kategoride kac sonuc oldugunu secmeden once gorur.
  by_category as (
    select c.id, c.slug, c.name, count(m.id) as n
    from public.categories c
    left join matched m
      on m.category_id = c.id
      or m.category_id in (select c2.id from public.categories c2 where c2.parent_id = c.id)
    where c.is_active and c.parent_id is null
    group by c.id, c.slug, c.name, c.sort_order
    order by c.sort_order
  ),
  -- Fiyat sinirlari: secili kategori uygulanir (o kategorinin araligi
  -- gosterilmeli), fiyat filtresi uygulanmaz.
  price_scope as (
    select m.min_price_cents
    from matched m
    where p_category_id is null
       or m.category_id = p_category_id
       or m.category_id in (select c.id from public.categories c where c.parent_id = p_category_id)
  )
  select jsonb_build_object(
    'min_price_cents', (select min(min_price_cents) from price_scope),
    'max_price_cents', (select max(min_price_cents) from price_scope),
    'categories', coalesce(
      (select jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'count', n))
         from by_category),
      '[]'::jsonb
    )
  );
$$;

comment on function public.search_facets(text, uuid) is
  'Arama filtre seridi icin gercek fiyat sinirlari ve kategori basina sonuc sayisi.';

grant execute on function public.search_facets(text, uuid) to anon, authenticated;
