-- ============================================================================
-- METİNLİ ARAMA: indeks ön filtresi SONUCU DEĞİŞTİRMEMELİ
-- ----------------------------------------------------------------------------
-- 20260926130000 metinli aramayı trigram indeksinden alınan bir aday kümeyle
-- sınırlandırdı. Aday küme asıl kuraldan gevşek (0.4 < 0.45) seçildiği için
-- sonuç aynı kalmalı. Bu test, asıl kuralı DOĞRUDAN (indekssiz, bütün
-- tabloda) uygulayan bir referansla iki fonksiyonun sonucunu karşılaştırır:
--   * search_products: dönen toplam (total_count) ve kimlik kümesi
--   * search_facets:   kategori sayaçlarının toplamı
-- Yazım hatalı (yalnızca benzerlikle eşleşen), çok kelimeli ve kısa
-- kelimeli sorgular dahil; ön filtre eşiği bozulursa test düşer.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

do $$
declare
  v_sorgu    text;
  v_ref      bigint;
  v_toplam   bigint;
  v_eksik    bigint;
  v_facet    bigint;
  v_denenen  int := 0;
begin
  foreach v_sorgu in array array[
    'iphone', 'iphon', 'ipone 15', 'kulaklik', 'sony kulaklik', 'dyson',
    'lenovo ideapad', 'xyzqw', 'a', 'pro',
    -- YAZIM HATALARI: alt metin değil, yalnızca word_similarity (0.45-0.6)
    -- ile eşleşen sorgular. İndeks ön filtresi bunları kaçırırsa test düşer.
    'kulaklk', 'lenvo', 'iphne', 'dysn', 'idepad', 'lenvo idepad'
  ] loop
    -- Referans: asıl kural, bütün tablo, indeks yok.
    with params as (select public.normalize_search(v_sorgu) as q),
    tokens as (
      select t.tok from params, lateral unnest(string_to_array(params.q, ' ')) as t(tok)
       where length(t.tok) > 0
    )
    select count(*) into v_ref
      from public.product_groups g
     where g.offer_count > 0
       and not exists (
         select 1 from tokens t
          where not (g.search_text like '%' || t.tok || '%'
                     or word_similarity(t.tok, g.search_text) >= 0.45));

    select coalesce(max(total_count), 0) into v_toplam
      from public.search_products(v_sorgu, null, null, null, 'relevance', 100, 0);

    if v_toplam <> v_ref then
      raise exception 'ESDEGER DEGIL (search_products, "%"): referans %, fonksiyon %',
        v_sorgu, v_ref, v_toplam;
    end if;

    -- Kimlik kümesi: fonksiyonun döndürdüğü her grup referansta olmalı.
    with params as (select public.normalize_search(v_sorgu) as q),
    tokens as (
      select t.tok from params, lateral unnest(string_to_array(params.q, ' ')) as t(tok)
       where length(t.tok) > 0
    ),
    ref as (
      select g.id from public.product_groups g
       where g.offer_count > 0
         and not exists (
           select 1 from tokens t
            where not (g.search_text like '%' || t.tok || '%'
                       or word_similarity(t.tok, g.search_text) >= 0.45))
    )
    select count(*) into v_eksik
      from public.search_products(v_sorgu, null, null, null, 'relevance', 100, 0) s
     where s.group_id not in (select id from ref);
    if v_eksik > 0 then
      raise exception 'ESDEGER DEGIL (search_products, "%"): referansta olmayan % grup',
        v_sorgu, v_eksik;
    end if;

    -- Facet: ücretsiz kargo sayacı referans kümesi üzerinden aynı olmalı;
    -- toplam grup sayısı fiyat aralığı dolu/boş oluşuyla tutarlı olmalı.
    select coalesce(sum((c ->> 'count')::bigint), 0) into v_facet
      from jsonb_array_elements(
             public.search_facets(v_sorgu, null, null, false, null) -> 'categories') c;
    if v_facet > v_ref then
      raise exception 'ESDEGER DEGIL (search_facets, "%"): kategori sayaci % > referans %',
        v_sorgu, v_facet, v_ref;
    end if;

    v_denenen := v_denenen + 1;
  end loop;

  raise notice '✓ metinli arama: % sorguda indeksli aday kume referansla ayni', v_denenen;
end $$;

-- Eşik fonksiyona bağlı: oturumun eşiğini değiştirmek sonucu değiştirmemeli.
do $$
declare
  v_a bigint;
  v_b bigint;
begin
  select coalesce(max(total_count), 0) into v_a
    from public.search_products('iphon', null, null, null, 'relevance', 100, 0);
  perform set_config('pg_trgm.word_similarity_threshold', '0.9', true);
  select coalesce(max(total_count), 0) into v_b
    from public.search_products('iphon', null, null, null, 'relevance', 100, 0);
  if v_a <> v_b then
    raise exception 'ESIK SIZIYOR: oturum esigi 0.9 iken sonuc % -> %', v_a, v_b;
  end if;
  -- Fonksiyon kendi eşiğini çağrı bitince geri almalı.
  if current_setting('pg_trgm.word_similarity_threshold') <> '0.9' then
    raise exception 'ESIK GERI ALINMADI: oturum esigi % oldu',
      current_setting('pg_trgm.word_similarity_threshold');
  end if;
  perform public.search_facets('iphon', null, null, false, null);
  if current_setting('pg_trgm.word_similarity_threshold') <> '0.9' then
    raise exception 'ESIK GERI ALINMADI (facet): oturum esigi % oldu',
      current_setting('pg_trgm.word_similarity_threshold');
  end if;
  raise notice '✓ metinli arama: oturum esigi sonucu degistirmiyor ve cagri sonrasi geri aliniyor';
end $$;

rollback;
