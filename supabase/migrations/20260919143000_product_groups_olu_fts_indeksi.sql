-- ===========================================================================
-- product_groups: YAPISAL OLARAK KULLANILAMAZ FTS İNDEKSİ DÜŞÜRÜLÜYOR
-- ---------------------------------------------------------------------------
-- BU İNDEKS "AZ KULLANILIYOR" DEĞİL, "KULLANILAMAZ".
--
-- `products` üzerindeki üç indeksi (20260919110000) `idx_scan = 0` olduğu
-- için düşürmüştük. Bu farklı ve daha güçlü bir iddia: bu indeksi bir
-- sorgunun kullanması MÜMKÜN DEĞİL.
--
--   product_groups_search_fts_idx  GIN (to_tsvector('simple', search_text))
--                                  9.616 kB · idx_scan = 2
--
-- Bir `to_tsvector` GIN indeksini planlayıcının kullanabilmesi için WHERE
-- içinde `@@` (tsquery eşleşme) işlecinin bulunması ŞART. Depoda `@@` işleci
-- HİÇ YOK -- ne göçlerde, ne SQL fonksiyonlarında, ne uygulama kodunda
-- (arandı, sıfır sonuç).
--
-- `to_tsvector` depoda yalnızca TEK bir yerde geçiyor:
--
--     ts_rank(to_tsvector('simple', g.search_text), ...)
--
-- ve bu bir ORDER BY ifadesi -- yani ADAY SATIRLAR BULUNDUKTAN SONRA, her
-- satır için ayrı ayrı hesaplanan bir SIRALAMA skoru. Sıralama ifadesi
-- indeks kullanmaz: `ts_rank` zaten elde olan satırı puanlar, satır
-- ARAMAZ. Dolayısıyla indeks yalnızca YAZILIYOR, hiç okunmuyor.
--
-- ---------------------------------------------------------------------------
-- TRGM İNDEKSİ DÜŞÜRÜLMÜYOR -- ÖLÇÜLDÜ, YÜK TAŞIYOR
-- ---------------------------------------------------------------------------
-- Aynı tabloda `product_groups_search_trgm_idx` (29 MB) duruyor ve o çok
-- daha büyük. Boyuta bakıp onu da düşürmek cazipti; ÖLÇÜM bunu reddetti:
--
--   explain analyze ... where 'ergonomik' <% g.search_text
--     -> Bitmap Index Scan on product_groups_search_trgm_idx (rows=211)
--
-- Arama fonksiyonlarının bulanık kolu (`<%`, `word_similarity(...) >= 0.45`)
-- doğrudan bu indeksten geçiyor. Düşürmek aramayı 36 bin satırlık sıralı
-- taramaya indirirdi. BOYUT BİR KANIT DEĞİLDİR: büyük olan kullanılıyor,
-- küçük olan kullanılamıyor.
--
-- ---------------------------------------------------------------------------
-- NEDEN ŞİMDİ: YAZMA MALİYETİ, YER DEĞİL
-- ---------------------------------------------------------------------------
-- Kazanılan 9.616 kB tek başına 500 MB'lik sınır karşısında küçük. Asıl
-- kazanç YAZMADA: `search_text` üretilmiş bir sütun ve
-- `tg_products_sync_group_stats` HER ürün yazmasında `product_groups`
-- satırını güncelliyor. GIN bakımı indeks türleri içinde en pahalısıdır;
-- bu, her alım turunda on binlerce kez ödenen ve karşılığında HİÇBİR
-- okuma üretmeyen bir maliyet.
--
-- GERİ ALMAK: indeks tanımı yukarıda birebir duruyor; `create index` ile
-- geri kurulabilir. Veri kaybı yok -- indeks türetilmiş bir yapıdır.
-- ===========================================================================

do $$
declare
  v_boyut bigint;
begin
  select pg_relation_size('public.product_groups_search_fts_idx'::regclass)
    into v_boyut;

  raise notice 'product_groups_search_fts_idx dusuruluyor (% bayt)', v_boyut;
exception
  when undefined_table then
    raise notice 'product_groups_search_fts_idx zaten yok -- gec';
end $$;

drop index if exists public.product_groups_search_fts_idx;

-- ---------------------------------------------------------------------------
-- DOĞRULAMA: düşen düştü, taşıyan durdu
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'product_groups_search_fts_idx'
  ) then
    raise exception 'FTS indeksi hala duruyor';
  end if;

  -- Bulanık aramanın dayanağı YERİNDE kalmalı. Bu göç yanlışlıkla onu da
  -- alırsa arama sıralı taramaya duser ve bunu kimse fark etmezdi.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'product_groups_search_trgm_idx'
  ) then
    raise exception
      'trgm indeksi kayip: bulanik arama (<%%, word_similarity) bu indekse '
      'dayaniyor -- dusurulmesi aramayi sirali taramaya indirirdi.';
  end if;

  raise notice 'product_groups: olu FTS indeksi dusuruldu, trgm indeksi korundu';
end $$;
