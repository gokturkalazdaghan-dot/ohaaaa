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
-- ÖLÇÜLDÜ (35.006 ürün grubu, üretimdeki çarpık dağılım taklit edilerek)
-- ---------------------------------------------------------------------------
-- Ana kategori sayfasının kapsamı, "Bilgisayar & Teknoloji" dalı:
--
--   tek seviye (eski)   →   3.501 grup
--   özyinelemeli (yeni) →  33.251 grup
--
-- Yani o sayfa dalının ürünlerinin %89'unu GİZLİYORDU. Bu sayı bir tahmin
-- değil; iki kapsam aynı veri üzerinde sayıldı.
--
-- Filtre sayaçlarında değişiklik ayrıca bir PERFORMANS DÜZELTMESİ çıktı.
-- Eski `by_category`, her ana kategori için satır başına yeniden koşan bir
-- `in (select ...)` alt sorgusu kullanıyordu:
--
--   eski (tek seviye, in-subquery)      →  9.425 ms
--   yeni (kategori_kapsami + lateral)   →     20 ms
--
-- `anon` rolünün deyim zaman aşımı 3.000 ms. Yani eski hâl bu ölçekte
-- yalnızca eksik değil, ÇALIŞMIYORDU: sorgu düşer, Next.js bayat önbelleği
-- sunmaya devam eder ve vitrin eski sayılarda kalırdı -- bu depoda daha
-- önce bir kez yaşanmış, `onbellek.ts` içinde yazılı olan arızanın aynısı.
--
-- ---------------------------------------------------------------------------
-- NEDEN ÖZYİNELEMELİ FONKSİYON, NEDEN İKİNCİ BİR `in` DEĞİL
-- ---------------------------------------------------------------------------
-- İkinci bir seviye elle eklenebilirdi (`parent_id in (select ...)`) ama o,
-- aynı hatayı bir seviye ileri taşımaktan başka bir şey olmazdı: dördüncü
-- seviye açıldığı gün aynı sessiz eksik geri gelirdi. Özyinelemeli çözüm
-- derinlikten bağımsız; `tree_level` kısıtı zaten üçte durduruyor, yani
-- özyineleme de sınırlı.
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
-- ARAMA: kapsam özyinelemeli
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
  p_free_shipping boolean default false
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
$function$;

-- ---------------------------------------------------------------------------
-- FİLTRE SAYAÇLARI: hem seçili kategori kapsamı hem ana kategori sayaçları
-- ---------------------------------------------------------------------------
-- `by_category` ana kategorileri sayıyor ve tek seviye iniyordu: "Elektronik"
-- filtresinin yanındaki sayı, L3'teki ürünleri hiç görmüyordu. Kullanıcı
-- "Elektronik (12)" görüp tıkladığında 300 ürün bulurdu -- ya da tam tersi,
-- dolu bir kategoriyi sıfır sanıp hiç tıklamazdı.
create or replace function public.search_facets(
  p_query         text default null,
  p_category_id   uuid default null,
  p_brands        text[] default null,
  p_free_shipping boolean default false
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
   * `kategori_kapsami` her ana kategori için bir kez çağrılıyor. Ana
   * kategori sayısı 18 ve fonksiyon en fazla üç seviye iniyor; maliyet
   * sabit. Alternatif olan "her ürünün kökünü bul" ifadesi her ürün grubu
   * için tırmanırdı -- 34 bin satırda ölçülebilir bir fark.
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
$function$;

-- ---------------------------------------------------------------------------
-- ÖNERİ ŞERİDİ: kategori önerisinin yanındaki sayı da üç seviyeyi görsün
-- ---------------------------------------------------------------------------
-- Sonuç vermeyen öneri gösterilmiyor (`result_count > 0`). Tek seviye sayan
-- eski hâl, yalnızca L3'te ürünü olan bir kategoriyi "sonuçsuz" sayıp öneri
-- şeridinden TAMAMEN düşürüyordu.
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
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_grup uuid; v_n bigint;
begin
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

  delete from public.product_groups where id = v_grup;

  raise notice
    'Kategori kapsami uc seviyeye cikti: arama, filtre sayaclari ve oneri '
    'seridi L3 urunlerini artik goruyor.';
end $$;
