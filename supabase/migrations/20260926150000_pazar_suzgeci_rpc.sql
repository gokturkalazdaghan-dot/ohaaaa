-- =============================================================================
-- search_products / search_facets: `p_market` parametresi
-- =============================================================================
-- 20260926140000 `product_groups.market_code` sütununu yazdı ve pazar önekli
-- indeksleri kurdu. Bu göç o sütunu RPC'lerin üzerinden erişilebilir yapıyor.
--
-- ÖLÇÜLEN KAZANÇ (canlı, AT pazarı, `title asc`, limit 24)
--   `products` üzerinden yarı-birleşim   12.160 ms  (indeks yok, iç içe döngü)
--   `market_code` + pazar önekli indeks      10,2 ms  (indeks taraması)
-- Yani süzgeç, denormalize sütun OLMADAN üretimde kullanılamazdı.
--
-- GEÇMİŞ İMZA DÜŞÜRÜLÜYOR
-- `create or replace function` parametre listesi değişince YERİNE KOYMAZ,
-- AŞIRI YÜKLEME yaratır. Eski ve yeni imza bir arada dururken `p_market`
-- göndermeyen bir çağrı İKİSİNE de uyar ve PostgREST belirsizlik hatası
-- verir -- yani arama tamamen kırılır. Bu yüzden eski imza aynı işlemin
-- içinde düşürülüyor (20260831110000 aynı şeyi yapmıştı). Tek işlem olduğu
-- için dışarıdan hiçbir çağrı ara durumu görmez.
--
-- YETKİLER AÇIKÇA YENİDEN VERİLİYOR: yeni imza yeni bir nesne, eskisinin
-- ACL'ini miras almaz. Verilmezse katalog anon rolü için sessizce kapanır.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- search_products
-- ---------------------------------------------------------------------------
-- `p_market` EN SONA eklendi; öncesindeki sıra birebir korunuyor, böylece
-- konumsal çağrı yapan bir yer varsa kırılmıyor.
--
-- Süzgeç `p_market is null or g.market_code = p_market` -- yani pazar
-- verilmediğinde davranış BUGÜNKÜNÜN AYNISI. Bu bilinçli: geçiş sırasında
-- pazar göndermeyen bir sayfa kalırsa boş katalog değil, bugünkü katalogu
-- gösterir.
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
  p_currency      char(3) default null,
  p_market        text default null
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
      -- PAZAR SÜZGECİ. Grubun pazarı `market_code` sütununda denormalize;
      -- teklifleri birden fazla pazara yayılan grup NULL taşır ve pazar
      -- verildiğinde listeden DÜŞER (bkz. 20260926140000: uydurma pazar
      -- seçmemenin bedeli, görünür bir eksiklik).
      and (p_market is null or g.market_code = p_market)
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

drop function if exists public.search_products(
  text, uuid, bigint, bigint, text, integer, integer, text[], boolean, char
);

grant execute on function public.search_products(
  text, uuid, bigint, bigint, text, integer, integer, text[], boolean, char, text
) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- search_facets
-- ---------------------------------------------------------------------------
-- Süzgeç İKİ DALIN İKİSİNE de eklendi. Yalnızca birine eklemek, arama
-- kutusu kullanıldığında filtre şeridinin sessizce bütün pazarları saymasına
-- yol açardı -- sayfada 24 Avusturya ürünü, yanında "Bilgisayar 8.214"
-- yazan bir sayaç.
create or replace function public.search_facets(
  p_query         text default null,
  p_category_id   uuid default null,
  p_brands        text[] default null,
  p_free_shipping boolean default false,
  p_currency      char(3) default null,
  p_market        text default null
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
   * okunmaz; dal yalnızca dar kısmi indeksten beslenir -- pazar verildiğinde
   * product_groups_pazar_facet_idx, verilmediğinde
   * product_groups_facet_covering_idx. Tek dal hâlinde koşulda `search_text`
   * geçtiği için planlayıcı, metin boş olsa bile ~200 MB'lık tabloyu okumak
   * zorundaydı. Dallar birbirini dışlar (q null / değil); sonuç kümesi
   * eskisiyle aynıdır.
   */
  matched as (
    select g.id, g.category_id, g.min_price_cents, g.brand, g.price_currency
    from public.product_groups g
    where (select q from params) is null
      and g.offer_count > 0
      and (p_market is null or g.market_code = p_market)
      and (p_currency is null or g.price_currency = p_currency)
    union all
    select g.id, g.category_id, g.min_price_cents, g.brand, g.price_currency
    from public.product_groups g
    cross join params pr
    where pr.q is not null
      and g.offer_count > 0
      and (p_market is null or g.market_code = p_market)
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

drop function if exists public.search_facets(text, uuid, text[], boolean, char);

grant execute on function public.search_facets(
  text, uuid, text[], boolean, char, text
) to anon, authenticated, service_role;
