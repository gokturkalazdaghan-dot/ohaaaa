-- =============================================================================
-- search_products: satıcı adı yalnızca DÖNEN satırlar için okunuyor
-- =============================================================================
-- Üretimde products_pkey 27 günde 333 milyon kez okunmuştu (saniyede ~140).
-- Kaynağı bu fonksiyondu: eşleşen HER grubun en iyi teklifi, satıcısı ve
-- mağazası okunup ANCAK SONRA 24 satıra kesiliyordu. Filtresiz bir kategori
-- sayfası ~38 bin gereksiz birincil anahtar okuması demekti.
--
-- Anlam aynı: birleşimler 1:1 (birincil anahtar), sıralama ifadesi birebir
-- aynı, `count(*) over ()` LIMIT'ten önce hesaplanıyor. Üretimde eski ve yeni
-- fonksiyonun çıktıları çeşitli parametre kombinasyonlarında karşılaştırıldı.
--
-- Ayrıca facet için dar kapsayan indeks (kategori sayfası, arama metinsiz yol).
-- =============================================================================

create index if not exists product_groups_facet_covering_idx
  on public.product_groups (category_id)
  include (id, min_price_cents, brand, price_currency)
  where offer_count > 0;

create or replace function public.search_products(
  p_query         text default null,
  p_category_id   uuid default null,
  p_min_price     bigint default null,
  p_max_price     bigint default null,
  p_sort          text default 'relevance',
  p_limit         integer default 24,
  p_offset        integer default 0,
  p_brands        text[] default null,
  p_free_shipping boolean default false,
  p_currency      char(3) default null
)
returns table (
  group_id        uuid,
  slug            citext,
  title           text,
  brand           text,
  image_url       text,
  offer_count     integer,
  min_price_cents bigint,
  max_price_cents bigint,
  best_offer_id   uuid,
  best_vendor_id  uuid,
  best_vendor_name text,
  relevance       real,
  total_count     bigint
)
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
  kapsam as (
    select k.category_id from public.kategori_kapsami(p_category_id) k
     where p_category_id is not null
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
        or g.category_id in (select category_id from kapsam)
      )
      and (p_currency is null or g.price_currency = p_currency)
      -- Fiyat filtresi PARA BIRIMI ICINDE: farkli mezhepleri tek araliga
      -- sokmak "en ucuz"u fiyata degil mezhebe gore secerdi.
      and (p_currency is null or p_min_price is null or g.min_price_cents >= p_min_price)
      and (p_currency is null or p_max_price is null or g.min_price_cents <= p_max_price)
      -- Marka karsilastirmasi BUYUK/KUCUK HARFTEN bagimsiz: besleme
      -- "Sony", "SONY" ve "sony" gonderebilir.
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
  ),
  /*
   * ÖNCE SIRALA VE KES, SONRA ZENGİNLEŞTİR.
   *
   * Önceki hâl satıcı adını (products -> vendors/merchants) eşleşen HER grup
   * için okuyup sonra 24'e kesiyordu: filtresiz bir çağrıda ~38 bin birincil
   * anahtar okuması, döndürülen 24 satır için. Üretimde products_pkey 27
   * günde 333 milyon kez okunmuştu. Birleşimler birincil anahtar üzerinden
   * 1:1 olduğu için satır kümesi ve sırası değişmez; `count(*) over ()`
   * pencere fonksiyonu LIMIT'ten önce hesaplandığı için toplam da aynıdır.
   */
  sayfa as (
    select m.*, count(*) over ()::bigint as toplam
      from matched m
     order by
      case when p_sort = 'price_asc'  then m.min_price_cents end asc nulls last,
      case when p_sort = 'price_desc' then m.min_price_cents end desc nulls last,
      case when p_sort = 'offers'     then m.offer_count end desc nulls last,
      case when p_sort = 'relevance'  then m.relevance end desc nulls last,
      m.title asc
     limit greatest(1, least(coalesce(p_limit, 24), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    m.id, m.slug, m.title, m.brand, m.image_url, m.offer_count,
    m.min_price_cents, m.max_price_cents, m.best_offer_id,
    coalesce(v.id, mer.id),
    coalesce(v.display_name, mer.display_name),
    m.relevance,
    m.toplam
  from sayfa m
  left join public.products  bp  on bp.id = m.best_offer_id
  left join public.vendors   v   on v.id = bp.vendor_id
  left join public.merchants mer on mer.id = bp.merchant_id
  order by
    case when p_sort = 'price_asc'  then m.min_price_cents end asc nulls last,
    case when p_sort = 'price_desc' then m.min_price_cents end desc nulls last,
    case when p_sort = 'offers'     then m.offer_count end desc nulls last,
    case when p_sort = 'relevance'  then m.relevance end desc nulls last,
    m.title asc;
$function$;
