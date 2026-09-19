-- ============================================================================
-- product_groups ARAMA İNDEKSLERİ: HANGİSİ TAŞIYOR, HANGİSİ ÖLÜ
-- ----------------------------------------------------------------------------
-- Göç (20260919143000) FTS indeksini düşürdü, trgm indeksini bıraktı. İkisi
-- de "arama indeksi" adını taşıyor ve boyutça yanıltıcılar: düşen 9.616 kB,
-- kalan 29 MB. Ayrımı yapan şey boyut değil, KULLANILABİLİRLİK.
--
-- Bu testin işi, o ayrımın zamanla sessizce bozulmasını engellemek. İki ayrı
-- bozulma yolu var ve test ikisini de yakalar:
--
--   1) Biri `@@` kullanan bir arama yazar. O anda FTS indeksi ANLAMLI hale
--      gelir ama ARTIK YOK -- sorgu 36 bin satırı sıralı tarar ve bunu
--      kimse fark etmez. Test bu durumda düşer ve indeksi geri istemeyi
--      söyler.
--
--   2) Biri "iki büyük GIN indeksi var, temizleyelim" diyip trgm'i düşürür.
--      Bulanık arama (`<%`, `word_similarity`) sıralı taramaya iner.
--
-- Dört iddia:
--   1) ölü FTS indeksi GERÇEKTEN yok
--   2) trgm indeksi YERİNDE
--   3) depoda `@@` yok  -- FTS indeksinin ölü olma GEREKÇESİ hâlâ geçerli
--   4) bulanık arama planı trgm indeksini KULLANIYOR
-- ============================================================================
begin;

\set ON_ERROR_STOP on

-- --------------------------------------------------------------------------
-- 1) ÖLÜ FTS İNDEKSİ YOK
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'product_groups_search_fts_idx'
  ) then
    raise exception
      'product_groups_search_fts_idx geri gelmis: WHERE icinde `@@` olmadan '
      'bu indeksi hicbir sorgu kullanamaz, yalnizca her yazmada bakim '
      'maliyeti uretir.';
  end if;

  raise notice 'olu FTS indeksi yok.';
end $$;

-- --------------------------------------------------------------------------
-- 2) TRGM İNDEKSİ YERİNDE
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'product_groups_search_trgm_idx'
  ) then
    raise exception
      'product_groups_search_trgm_idx dusurulmus: bulanik aramanin (<%%, '
      'word_similarity >= 0.45) tek dayanagi bu indeks.';
  end if;

  raise notice 'trgm indeksi yerinde.';
end $$;

-- --------------------------------------------------------------------------
-- 3) FTS İNDEKSİNİN ÖLÜ OLMA GEREKÇESİ HÂLÂ GEÇERLİ Mİ
-- --------------------------------------------------------------------------
-- Gerekce: hicbir sorgu `@@` kullanmiyor. Bunu depo genelinde degil, VERITABANI
-- icindeki fonksiyon govdelerinde olcuyoruz -- arama SQL fonksiyonlarinda
-- yasiyor, yani `@@` geri gelirse once burada gorunur.
do $$
declare
  v_ad text;
begin
  select p.proname into v_ad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~ '@@'
   limit 1;

  if v_ad is not null then
    raise exception
      'Bir fonksiyon (%) artik `@@` kullaniyor: FTS indeksinin "kullanilamaz" '
      'gerekcesi COKTU. Ya sorguyu trgm/LIKE koluna cevirin ya da '
      'product_groups_search_fts_idx indeksini GERI KURUN -- aksi halde bu '
      'sorgu 36 bin satiri sirali tarar.', v_ad;
  end if;

  raise notice 'depoda `@@` yok: FTS indeksi olu kalmaya devam ediyor.';
end $$;

-- --------------------------------------------------------------------------
-- 4) BULANIK ARAMA PLANI TRGM İNDEKSİNİ KULLANIYOR
-- --------------------------------------------------------------------------
-- (2) yalnizca indeksin VAR oldugunu soyluyor. Var olup KULLANILMAMASI da
-- mumkun -- ornegin operator sinifi degisirse. Burada gercek PLANA bakiyoruz.
do $$
declare
  v_plan text;
  v_satir record;
begin
  -- Planlayicinin indeksi secmesi icin yeterli satir gerekiyor; test
  -- veritabani bos oldugundan once kucuk bir kume yaziyoruz.
  insert into public.product_groups (slug, title)
  select 'trgm-test-' || i, 'Ergonomik ofis koltugu model ' || i
    from generate_series(1, 500) i;

  analyze public.product_groups;

  -- Sirali tarama daha ucuzsa planlayici onu secer; bu testte olcmek
  -- istedigimiz sey indeksin SECILEBILIR olmasi.
  set local enable_seqscan = off;

  v_plan := '';
  for v_satir in
    execute 'explain (costs off) select count(*) from public.product_groups g '
         || 'where ''ergonomik'' <% g.search_text'
  loop
    v_plan := v_plan || v_satir."QUERY PLAN" || E'\n';
  end loop;

  if v_plan not like '%product_groups_search_trgm_idx%' then
    raise exception
      'Bulanik arama plani trgm indeksini KULLANMIYOR. Plan:% %',
      E'\n', v_plan;
  end if;

  raise notice 'bulanik arama plani trgm indeksinden geciyor.';
end $$;

rollback;
