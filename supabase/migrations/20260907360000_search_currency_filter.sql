-- ===========================================================================
-- Arama fiyat filtresi PARA BIRIMI ICINDE calisir
-- ===========================================================================
--
-- 20260907330000 (Asama 13) `search_products_page` icin dogru kurali koydu:
-- "Fiyat filtresi PARA BIRIMI ICINDE. p_currency verilmediyse filtre
-- uygulanmiyor." Ama SAYFANIN GERCEKTE KULLANDIGI iki fonksiyon --
-- `search_products` ve `search_facets` -- o turda dokunulmadan kaldi ve
-- hâlâ ciplak sayilari karsilastiriyor.
--
-- Sonuc: "5000'e kadar" filtresi, grubun para birimine BAKMADAN
-- min_price_cents <= 5000 diye eleniyor. 5000, ₺50,00 da olabilir $50.00 da
-- 5000 HUF (~13 USD) da. Bugun katalog tek para birimindeyken bu gorunmez;
-- Alison ve Mooncool (US/CA) gibi kayitlardan gelen ilk USD teklifle
-- birlikte SESSIZCE yanlis sonuc uretmeye baslar -- hata mesaji yok, bos
-- ya da alakasiz liste var.
--
-- ---------------------------------------------------------------------------
-- TEK KURAL, IKI UYGULAMA
-- ---------------------------------------------------------------------------
--
-- Kural: FIYATLAR PARA BIRIMLERI ARASINDA KARSILASTIRILMAZ.
--
--   FILTRE (search_products)
--     p_currency verilmisse fiyat suzgeci yalnizca o para birimindeki
--     gruplara uygulanir; verilmemisse fiyat suzgeci HIC uygulanmaz.
--     `search_products_page`'in kuralinin aynisi -- iki fonksiyonun ayni
--     soruya farkli cevap vermesi, ikisinden birinin yanlis olmasi demektir.
--
--   SINIRLAR (search_facets)
--     Filtre seridinin "en dusuk / en yuksek" degerleri bir SUZGEC degil,
--     bir OZETTIR; sessizce kaybolmasi da bilgi kaybidir. Bu yuzden
--     p_currency verilmediginde sinirlar, kapsam TEK para birimindeyse
--     hesaplanir; birden fazla para birimi varsa NULL doner.
--
--     NULL burada "fiyat yok" demek degil, "tek bir aralikla ifade
--     edilemez" demektir; arayuz zaten NULL sinirda seridi cizmiyor. Iki
--     para biriminin sayilarindan min/max almak ise "en dusuk 100 (HUF),
--     en yuksek 9.000.000 (kurus)" gibi anlamsiz bir aralik uretirdi.
--
-- ---------------------------------------------------------------------------
-- PARA BIRIMI NEREDEN OKUNUYOR
-- ---------------------------------------------------------------------------
--
-- `product_groups.price_currency`den. 20260907330000 `min_price_cents` /
-- `max_price_cents` sutunlarini BASKIN para birimine gore hesapliyor
-- (`refresh_product_group_stats`), yani o iki sayi zaten TEK bir para
-- biriminin sayisi ve hangisi oldugu ayni satirda yaziyor. Ikinci bir
-- kaynak (product_group_price_stats'a katilim) acmak, ayni degeri iki
-- yerden okumak olurdu.
--
-- ---------------------------------------------------------------------------
-- DROP + CREATE, VE ACL'IN GERI VERILMESI
-- ---------------------------------------------------------------------------
--
-- Yeni parametre varsayilanli oldugu icin ESKI CAGRILAR (p_currency
-- gondermeyenler) aynen calismaya devam eder; PostgREST de adli argumanlarla
-- ayni fonksiyonu bulur. Yine de `create or replace` YETMEZ: donus tipi ve
-- arguman listesi degistiginde PostgreSQL replace'i reddeder.
--
-- DROP, fonksiyonun ACL'INI DE dusurur ve yeniden yaratilan fonksiyon
-- PUBLIC'e acik dogar. Bu depoda daha once tam olarak bu sebeple bir
-- ayricalik sessizce genislemisti; asagida grant'lar ACIKCA yeniden
-- veriliyor ve gocun dogrulama blogu ACL'i sinamadan bitmiyor.
-- ===========================================================================

-- ESKI imza dusuruluyor...
drop function if exists public.search_products(text, uuid, bigint, bigint, text, integer, integer, text[], boolean);
drop function if exists public.search_facets(text, uuid, text[], boolean);

/*
 * ...ve YENI imza da. Boylece goc yeniden uygulanabilir: yarida kalmis bir
 * apply'in tekrari "function already exists" ile dusmez. Grant'lar asagida
 * her turda aciktan veriliyor, yani bu ikinci DROP bir ayricalik kaybi
 * BIRAKMAZ -- birakiyor olsaydi dogrulama blogu 1. iddiada duserdi.
 */
drop function if exists public.search_products(text, uuid, bigint, bigint, text, integer, integer, text[], boolean, char(3));
drop function if exists public.search_facets(text, uuid, text[], boolean, char(3));

-- ---------------------------------------------------------------------------
-- search_products
-- ---------------------------------------------------------------------------
create function public.search_products(
  p_query         text    default null,
  p_category_id   uuid    default null,
  p_min_price     bigint  default null,
  p_max_price     bigint  default null,
  p_sort          text    default 'relevance',
  p_limit         integer default 24,
  p_offset        integer default 0,
  p_brands        text[]  default null,
  p_free_shipping boolean default false,
  -- SONA eklendi: mevcut konumsal cagrilar (pgTAP dosyalari dahil) bozulmasin.
  p_currency      char(3) default null
)
returns table (
  group_id uuid, slug citext, title text, brand text, image_url text,
  offer_count integer, min_price_cents bigint, max_price_cents bigint,
  best_offer_id uuid, best_vendor_id uuid, best_vendor_name text,
  relevance real, total_count bigint
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
      -- PARA BIRIMI SUZGECI: istenen para birimindeki gruplar.
      and (p_currency is null or g.price_currency = p_currency)
      /*
       * FIYAT SUZGECI PARA BIRIMI ICINDE.
       *
       * p_currency yoksa fiyat suzgeci UYGULANMAZ: 5000'i hem kurusa hem
       * cente hem forinte uygulamak, tam olarak duzeltilen hatanin kendisi.
       * `search_products_page` ile ayni kural.
       */
      and (p_currency is null or p_min_price is null or g.min_price_cents >= p_min_price)
      and (p_currency is null or p_max_price is null or g.min_price_cents <= p_max_price)
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
$function$;

-- ---------------------------------------------------------------------------
-- search_facets
-- ---------------------------------------------------------------------------
create function public.search_facets(
  p_query         text    default null,
  p_category_id   uuid    default null,
  p_brands        text[]  default null,
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
  matched as (
    select g.id, g.category_id, g.min_price_cents, g.brand, g.price_currency
    from public.product_groups g
    cross join params pr
    where g.offer_count > 0
      and (p_currency is null or g.price_currency = p_currency)
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
  /*
   * SINIRLAR TEK PARA BIRIMINDEN OKUNUR.
   *
   * p_currency verilmisse kapsam zaten tek para birimindedir. Verilmemisse
   * sinir ancak kapsamin TAMAMI tek para birimindeyse anlamlidir; iki para
   * birimi varsa min/max almak "en dusuk 100 (HUF), en yuksek 9.000.000
   * (kurus)" gibi anlamsiz bir aralik uretirdi. O durumda NULL doner --
   * "fiyat yok" degil, "tek bir aralikla ifade edilemez" demektir.
   */
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

-- ---------------------------------------------------------------------------
-- ACL GERI VERILIYOR
-- ---------------------------------------------------------------------------
-- DROP, iki fonksiyonun grant'larini da dusurdu. Yeniden verilmezse arama
-- anon icin 403 doner: ozellik degil, SITENIN KENDISI kirilir.
grant execute on function
  public.search_products(text, uuid, bigint, bigint, text, integer, integer, text[], boolean, char(3))
  to anon, authenticated;
grant execute on function
  public.search_facets(text, uuid, text[], boolean, char(3))
  to anon, authenticated;

comment on function public.search_products(text, uuid, bigint, bigint, text, integer, integer, text[], boolean, char(3)) is
  'Urun aramasi. p_currency verilmezse FIYAT SUZGECI UYGULANMAZ -- fiyatlar '
  'para birimleri arasinda karsilastirilmaz.';
comment on function public.search_facets(text, uuid, text[], boolean, char(3)) is
  'Filtre seridi verisi. Fiyat sinirlari yalnizca kapsam tek para '
  'birimindeyse doner; aksi hâlde NULL ("tek aralikla ifade edilemez").';

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_grup uuid;
  v_kat  uuid;
  v_sayi integer;
  v_f    jsonb;
begin
  -- 1) ACL geri verildi mi? Verilmemis olsaydi arama anon icin 403 dondururdu.
  if not has_function_privilege('anon',
       'public.search_products(text, uuid, bigint, bigint, text, integer, integer, text[], boolean, char(3))',
       'execute')
     or not has_function_privilege('anon',
       'public.search_facets(text, uuid, text[], boolean, char(3))', 'execute') then
    raise exception 'DOGRULAMA 1: DROP sonrasi grant geri verilmedi -- arama anon icin kirilirdi.';
  end if;

  -- 2) ESKI KONUMSAL CAGRILAR CALISIYOR: p_currency varsayilanli ve SONDA.
  perform * from public.search_products(null, null, null, null, 'relevance', 1, 0);
  perform public.search_facets(null, null);

  -- 3) DAVRANIS SINAMASI. Ayni fiyat sayisi (5000) iki para biriminde.
  select id into v_kat from public.categories where is_active limit 1;
  if v_kat is null then
    raise notice 'Dogrulama atlandi: kategori yok.';
    return;
  end if;

  insert into public.product_groups (slug, title, brand, category_id, offer_count,
                                     min_price_cents, max_price_cents, price_currency)
  values ('pb-suzgec-try', 'PB Suzgec TRY', 'PBTest', v_kat, 1, 5000, 5000, 'TRY'),
         ('pb-suzgec-usd', 'PB Suzgec USD', 'PBTest', v_kat, 1, 5000, 5000, 'USD');

  -- 3a) TRY istenince yalnizca TRY grubu gelir. Eski davranista IKISI de
  --     gelirdi: 5000 kurus ile 5000 cent ayni sayi.
  select count(*) into v_sayi
    from public.search_products('PB Suzgec', null, 0, 6000, 'relevance', 50, 0,
                                null, false, 'TRY');
  if v_sayi <> 1 then
    raise exception 'DOGRULAMA 3a: TRY suzgeci % grup dondurdu, 1 bekleniyordu '
      '-- fiyat suzgeci para birimini gormuyor.', v_sayi;
  end if;

  -- 3b) USD istenince yalnizca USD grubu.
  select count(*) into v_sayi
    from public.search_products('PB Suzgec', null, 0, 6000, 'relevance', 50, 0,
                                null, false, 'USD');
  if v_sayi <> 1 then
    raise exception 'DOGRULAMA 3b: USD suzgeci % grup dondurdu, 1 bekleniyordu.', v_sayi;
  end if;

  -- 3c) PARA BIRIMI YOKSA FIYAT SUZGECI UYGULANMAZ: iki grup da gelir.
  --     Sessizce birini elemek, hangi para biriminde oldugunu bilmeden
  --     karar vermek olurdu.
  select count(*) into v_sayi
    from public.search_products('PB Suzgec', null, 0, 1, 'relevance', 50, 0);
  if v_sayi <> 2 then
    raise exception 'DOGRULAMA 3c: para birimi yokken fiyat suzgeci uygulanmis '
      '(% grup dondu, 2 bekleniyordu).', v_sayi;
  end if;

  -- 4) FACET SINIRLARI: iki para birimi varken NULL.
  v_f := public.search_facets('PB Suzgec');
  if v_f->'min_price_cents' <> 'null'::jsonb then
    raise exception 'DOGRULAMA 4: iki para birimi karisikken fiyat siniri uretilmis (%).',
      v_f->>'min_price_cents';
  end if;

  -- 5) ...ama para birimi verilince sinir GERI GELIR. 4. iddia tek basina
  --    "sinirlari hep NULL dondur" gibi bozuk bir uygulamayla da gecerdi.
  v_f := public.search_facets('PB Suzgec', null, null, false, 'USD');
  if (v_f->>'min_price_cents')::bigint <> 5000 then
    raise exception 'DOGRULAMA 5: tek para biriminde sinir dondurulmedi (%).',
      v_f->>'min_price_cents';
  end if;

  delete from public.product_groups where slug in ('pb-suzgec-try', 'pb-suzgec-usd');

  raise notice
    'Arama fiyat suzgeci artik para birimi icinde: p_currency verilmezse '
    'fiyat suzgeci uygulanmiyor, facet sinirlari yalnizca tek para biriminde '
    'donuyor. ACL geri verildi.';
end $$;
