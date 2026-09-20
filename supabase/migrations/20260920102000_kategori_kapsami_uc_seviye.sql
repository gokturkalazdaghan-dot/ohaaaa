-- ===========================================================================
-- ARAMA VE SAYIM KAPSAMI ÜÇ SEVİYEYE ÇIKIYOR
-- ===========================================================================
--
-- ÇÖZÜLEN ARIZA
-- Kategori kapsamı bugün TEK SEVİYE iniyor:
--
--     or g.category_id in (select c.id from categories c where c.parent_id = p_category_id)
--
-- İki seviyeli ağaçta doğruydu. Üç seviyeli ağaçta DEĞİL: "Bilgisayar &
-- Teknoloji" (L1) sayfası "Bilgisayar Bileşenleri"ni (L2) görür ama onun
-- altındaki "Ekran Kartı"nı (L3) GÖRMEZ. Yani ana kategori sayfası, o dalın
-- ürünlerinin bir kısmını sessizce gizler; sayaç da o kısmı saymaz.
--
-- Bu arızanın en kötü yanı görünmemesi: sayfa açılır, ürün listeler, hata
-- düşmez. Yalnızca katalog eksiktir ve hangi ürünün eksik olduğu ekrandan
-- anlaşılmaz.
--
-- ---------------------------------------------------------------------------
-- ÖLÇÜLDÜ — ÜRETİMDE, GÖÇTEN ÖNCE
-- ---------------------------------------------------------------------------
-- Üretim kataloğu: 43.160 ürün grubu (35.876'sı teklifli), 283 kategori.
--
--   search_facets()  →  4.097 ms
--   anon rolünün statement_timeout  →  3.000 ms
--
-- Yani filtre sayaçları ŞU ANDA her anonim ziyaretçi için DÜŞÜYOR. Bu göç
-- yalnızca üç seviyeyi görünür kılmıyor; bugün kırık olan bir şeyi tamir
-- ediyor. Yeni sayaç şekli aynı üretim verisinde 46 ms (ölçüldü, plan
-- `product_groups_kategori_sayim_idx` indeksinden karşılıyor).
--
-- Not: L3 kategoriler üretimde bugün BOŞ, dolayısıyla özyinelemeli kapsam
-- şu an sıfır ek ürün getiriyor. Değeri iki yerde: (1) sayaç sorgusunun
-- zaman aşımından kurtulması, (2) ürünler L3'e sınıflandırılmaya
-- başladığında sessiz bir eksik oluşmaması.
--
-- ---------------------------------------------------------------------------
-- İMZA: `p_currency` KORUNUYOR — YENİ AŞIRI YÜKLEME AÇMIYORUZ
-- ---------------------------------------------------------------------------
-- ÖLÇÜLEN TUZAK: üretimdeki `search_products` ve `search_facets`,
-- `search_currency_filter` göçüyle fazladan bir `p_currency` parametresi
-- aldı. O göç DEPODA YOK (üretimde var, depoda olmayan 14 göçten biri).
--
-- `create or replace` yalnızca AYNI imzayı değiştirir. Dar imzayla
-- yazsaydık üretimde ikinci bir aşırı yükleme oluşurdu ve PostgREST
-- "Could not choose the best candidate function" diyerek ARAMAYI TAMAMEN
-- düşürürdü -- göç "başarılı" görünürken.
--
-- Bu yüzden:
--   1. Dar imza VARSA düşürülüyor (temiz replay'de var, üretimde yok).
--   2. Kanonik sürüm GENİŞ imzayla yazılıyor (üretimdekiyle birebir).
--   3. Yetkiler açıkça yeniden veriliyor: `drop` onları da götürür.
--
-- Para birimi semantiği ÜRETİMDEN alındı, depodan değil: fiyat filtresi
-- yalnızca `p_currency` verildiğinde uygulanıyor ve fiyat sınırları tek
-- para birimi varsa hesaplanıyor. Bunlar bilerek verilmiş kararlar;
-- kapsam düzeltmesi onları ezmemeli.
--
-- ---------------------------------------------------------------------------
-- NEDEN ÖZYİNELEMELİ FONKSİYON, NEDEN İKİNCİ BİR `in` DEĞİL
-- ---------------------------------------------------------------------------
-- İkinci bir seviye elle eklenebilirdi (`parent_id in (select ...)`) ama o,
-- aynı hatayı bir seviye ileri taşımaktan başka bir şey olmazdı: dördüncü
-- seviye açıldığı gün aynı sessiz eksik geri gelirdi. Özyinelemeli çözüm
-- derinlikten bağımsız; `tree_level` kısıtı zaten üçte durduruyor.
--
-- ---------------------------------------------------------------------------
-- BİRLEŞTİRİLMİŞ KATEGORİ KAPSAMA GİRMEZ
-- ---------------------------------------------------------------------------
-- Pasif bir kategoride ürün kalmamalı (birleştirme göçü bunu doğruluyor)
-- ama kapsam yine de yalnızca ETKİN dalları geziyor: yarın bilerek
-- pasifleştirilmiş bir kategori (gıda gibi) açılırsa, ürünleri üst
-- kategorinin sayfasından SIZMASIN.
-- ===========================================================================

create or replace function public.kategori_kapsami(p_category_id uuid)
returns table (category_id uuid)
language sql
stable
set search_path = ''
as $$
  with recursive dal as (
    -- Kökün KENDİSİ her zaman kapsamda: pasifleştirilmiş bir kategorinin
    -- sayfasına doğrudan gelindiğinde de ürünleri görünsün.
    select c.id, 1 as derinlik
      from public.categories c
     where c.id = p_category_id
    union all
    select c.id, d.derinlik + 1
      from dal d
      join public.categories c on c.parent_id = d.id
     where c.is_active
       and d.derinlik < 8      -- bozuk bir dongu fonksiyonu kilitlemesin
  )
  select id from dal;
$$;

comment on function public.kategori_kapsami is
  'Kategorinin KENDISI + butun etkin alt agaci (L2 ve L3). Tek seviye inen '
  'eski kapsam uc seviyeli agacta L3 urunlerini sessizce gizliyordu: sayfa '
  'acilir, urun listeler, hata dusmez -- yalnizca katalog eksiktir.';

grant execute on function public.kategori_kapsami(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- DAR İMZALAR DÜŞÜRÜLÜYOR (varsa)
-- ---------------------------------------------------------------------------
-- Temiz replay'de `p_currency`'siz sürümler var; üretimde yok. İkisini yan
-- yana bırakmak PostgREST'te aşırı yükleme belirsizliği demekti.
drop function if exists public.search_products(
  text, uuid, bigint, bigint, text, integer, integer, text[], boolean);
drop function if exists public.search_facets(
  text, uuid, text[], boolean);

-- ---------------------------------------------------------------------------
-- ARAMA: kapsam özyinelemeli, para birimi semantiği korunmuş
-- ---------------------------------------------------------------------------
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
-- FİLTRE SAYAÇLARI: hem seçili kategori kapsamı hem ana kategori sayaçları
-- ---------------------------------------------------------------------------
-- `by_category` ana kategorileri sayıyor ve tek seviye iniyordu. Ölçülen
-- bedeli yalnızca eksik sayı değil, 4.097 ms: `anon` bütçesinin üstünde,
-- yani sayaçlar zaten düşüyordu.
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

-- ---------------------------------------------------------------------------
-- ÖNERİ ŞERİDİ: kategori önerisinin yanındaki sayı da üç seviyeyi görsün
-- ---------------------------------------------------------------------------
-- İmza değişmiyor, bu yüzden `create or replace` yeterli ve yetkiler korunur.
-- Sonuç vermeyen öneri gösterilmiyor (`result_count > 0`); tek seviye sayan
-- eski hâl, yalnızca L3'te ürünü olan bir kategoriyi "sonuçsuz" sayıp öneri
-- şeridinden TAMAMEN düşürürdü.
create or replace function public.search_suggestions(
  p_query text,
  p_limit integer default 8
)
returns table (suggestion text, kind text, slug text, result_count bigint)
language sql
stable
set search_path to 'public'
as $function$
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
    left join lateral (select category_id from public.kategori_kapsami(c.id)) k on true
    left join public.product_groups g
      on g.category_id = k.category_id
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
$function$;

-- ---------------------------------------------------------------------------
-- YETKİLER YENİDEN VERİLİYOR
-- ---------------------------------------------------------------------------
-- `drop function` yetkileri de götürür. Vermeseydik vitrin (anon) arama
-- yapamaz, site sessizce "sonuç yok" gösterirdi.
grant execute on function public.search_products(
  text, uuid, bigint, bigint, text, integer, integer, text[], boolean, char)
  to anon, authenticated, service_role;
grant execute on function public.search_facets(
  text, uuid, text[], boolean, char)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_grup uuid; v_n bigint;
begin
  -- 0) AŞIRI YÜKLEME YOK. Bu kontrol olmasaydı göç "başarılı" görünürken
  --    PostgREST aramayı tamamen düşürebilirdi.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'search_products';
  if v_n <> 1 then
    raise exception
      'DOGRULAMA 0: search_products % surumlu -- asiri yukleme PostgREST te '
      '"could not choose the best candidate function" hatasi uretir ve arama '
      'tamamen durur.', v_n;
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'search_facets';
  if v_n <> 1 then
    raise exception 'DOGRULAMA 0b: search_facets % surumlu -- asiri yukleme var.', v_n;
  end if;

  -- 0c) VITRIN (anon) HALA CAGIRABILIYOR. `drop` yetkileri goturur.
  if not has_function_privilege('anon',
        'public.search_products(text,uuid,bigint,bigint,text,integer,integer,text[],boolean,char)',
        'execute') then
    raise exception
      'DOGRULAMA 0c: anon search_products u cagiramiyor -- site sessizce '
      '"sonuc yok" gosterirdi.';
  end if;
  if not has_function_privilege('anon', 'public.search_facets(text,uuid,text[],boolean,char)',
        'execute') then
    raise exception 'DOGRULAMA 0d: anon search_facets i cagiramiyor.';
  end if;

  select id into v_l1 from public.categories where slug::text = 'bilgisayar-tablet';
  select id into v_l2 from public.categories where slug::text = 'bilgisayar-bilesenleri';
  select id into v_l3 from public.categories where slug::text = 'ram';

  -- 1) KAPSAM ÜÇ SEVİYE İNİYOR.
  select count(*) into v_n from public.kategori_kapsami(v_l1) where category_id = v_l3;
  if v_n <> 1 then
    raise exception
      'DOGRULAMA 1: L1 kapsami L3 kategoriyi gormuyor -- ana kategori sayfasi '
      'urun kategorilerindeki urunleri sessizce gizlerdi.';
  end if;
  select count(*) into v_n from public.kategori_kapsami(v_l2) where category_id = v_l3;
  if v_n <> 1 then
    raise exception 'DOGRULAMA 1b: L2 kapsami kendi L3 cocugunu gormuyor.';
  end if;

  -- 2) KAPSAM YUKARI SIZMIYOR: L3 yalnızca kendini görür.
  select count(*) into v_n from public.kategori_kapsami(v_l3);
  if v_n <> 1 then
    raise exception
      'DOGRULAMA 2: L3 kapsami % satir dondurdu -- urun kategorisi sayfasi '
      'kendi disinda urun gosterirdi.', v_n;
  end if;

  -- 3) ARAMA GERÇEKTEN L3'Ü GÖRÜYOR. İddiayı sorguyla kanıtlamak şart:
  --    kapsam fonksiyonu doğru olup arama onu kullanmıyor olabilirdi.
  insert into public.product_groups (slug, title, category_id, offer_count, min_price_cents)
  values ('goc-l3-kapsam-denemesi', 'Goc L3 Kapsam Denemesi', v_l3, 1, 1000)
  returning id into v_grup;

  select count(*) into v_n
    from public.search_products(null, v_l1, null, null, 'relevance', 100, 0)
   where group_id = v_grup;
  if v_n <> 1 then
    raise exception
      'DOGRULAMA 3: L3 kategorideki urun, ANA kategori aramasinda cikmadi.';
  end if;

  select count(*) into v_n
    from public.search_products(null, v_l2, null, null, 'relevance', 100, 0)
   where group_id = v_grup;
  if v_n <> 1 then
    raise exception 'DOGRULAMA 3b: L3 kategorideki urun, ALT kategori aramasinda cikmadi.';
  end if;

  -- 4) BAŞKA BİR DALIN SAYFASI O ÜRÜNÜ GÖRMÜYOR. Kapsamı genişletirken
  --    sızdırmak, her kategori sayfasını "her şey" sayfasına çevirirdi.
  select count(*) into v_n
    from public.search_products(
           null,
           (select id from public.categories where slug::text = 'telefon'),
           null, null, 'relevance', 100, 0)
   where group_id = v_grup;
  if v_n <> 0 then
    raise exception 'DOGRULAMA 4: urun baska bir ana kategoride de gorundu.';
  end if;

  -- 5) FİLTRE SAYACI DA ÜÇ SEVİYEYİ SAYIYOR.
  if coalesce((
        select (e ->> 'count')::bigint
          from jsonb_array_elements(public.search_facets() -> 'categories') e
         where e ->> 'slug' = 'bilgisayar-tablet'
      ), 0) < 1 then
    raise exception
      'DOGRULAMA 5: ana kategori sayaci L3 urununu saymadi -- kullanici dolu '
      'bir kategoriyi sifir sanip hic tiklamazdi.';
  end if;

  -- 6) PARA BİRİMİ PARAMETRESİ HALA ÇALIŞIYOR. Kapsam düzeltmesi onu
  --    ezseydi fiyat filtresi mezhepleri karıştırırdı.
  select count(*) into v_n
    from public.search_products(null, v_l1, null, null, 'relevance', 100, 0, null, false, 'XTS');
  if v_n <> 0 then
    raise exception
      'DOGRULAMA 6: var olmayan para biriminde sonuc dondu -- p_currency '
      'suzgeci calismiyor.';
  end if;

  delete from public.product_groups where id = v_grup;

  raise notice
    'Kategori kapsami uc seviyeye cikti: arama, filtre sayaclari ve oneri '
    'seridi L3 urunlerini artik goruyor. Imza tek, yetkiler yerinde.';
end $$;
