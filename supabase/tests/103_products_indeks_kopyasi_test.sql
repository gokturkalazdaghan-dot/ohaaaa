-- ============================================================================
-- products İNDEKSLERİ — KOPYA YOK, KISIT DURUYOR
-- ----------------------------------------------------------------------------
-- BU DOSYA ÖLÇÜLEN BİR ÜRETİM ARIZASINDAN DOĞDU.
--
-- Alım `upsertOffers` adımında zaman aşımına uğruyordu ve parti boyutunu
-- yarıya indirmek YETMEDİ. Ölçülen sebep yazma büyütmesiydi:
--
--   products  n_tup_upd = 146.151   n_tup_hot_upd = 3   -> HOT orani %0,0
--
-- HOT güncellemesi mümkün olmayınca bir satırın güncellenmesi tablonun
-- BÜTÜN indekslerini yazdırır. `products` üzerinde 17 indeks vardı ve
-- üçü hiç okunmuyordu -- biri de bir başkasının TAM KOPYASIYDI.
--
-- İki iddia, iki farklı sessiz arızaya karşı:
--   1) aynı tanıma sahip İKİ indeks bulunmamalı (kopya yalnızca yazma
--      maliyeti üretir, hiçbir sorguyu hızlandırmaz -- ve kimse fark etmez)
--   2) benzersizlik kısıtları yerinde olmalı (bir "kullanılmayan indeks
--      temizliği" onları da süpürürse, kayıp bir veri bütünlüğü kaybıdır
--      ve ancak ihlal olduğunda anlaşılır)
-- ============================================================================
begin;

\set ON_ERROR_STOP on

-- --------------------------------------------------------------------------
-- 1) KOPYA İNDEKS YOK
-- --------------------------------------------------------------------------
-- Karşılaştırma indeks ADINA değil TANIMINA bakıyor: ad farklı ama sütunlar
-- ve kısmi koşul aynıysa o bir kopyadır. `products_group_price_idx` ile
-- `products_group_active_idx` tam olarak böyleydi.
do $$
declare
  v_kopya text;
begin
  select string_agg(adlar, ' | ') into v_kopya
  from (
    select string_agg(indexname, ' = ' order by indexname) as adlar
      from (
        select indexname,
               -- Tanimdan indeks ADINI cikar: geriye sutunlar ve kosul kalir.
               regexp_replace(indexdef, 'INDEX [a-z0-9_]+ ON', 'INDEX ON') as sekil
          from pg_indexes
         where schemaname = 'public' and tablename = 'products'
      ) t
     group by sekil
    having count(*) > 1
  ) k;

  if v_kopya is not null then
    raise exception
      'KOPYA INDEKS: %. Ayni tanima sahip iki indeks, her satir '
      'guncellemesinde iki kez yazilir ve hicbir sorguyu hizlandirmaz.',
      v_kopya;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2) BENZERSİZLİK KISITLARI YERİNDE
-- --------------------------------------------------------------------------
-- `products_vendor_external_id_key`in taramasi SIFIR ve yine de
-- dusurulmemeli: benzersizlik indeksleri okunmaz, ihlal aninda devreye
-- girer. "Taranmiyor" ile "ise yaramiyor" ayni sey degildir.
--
-- IDDIA ADA DEGIL TANIMA BAKIYOR ve bunun somut bir sebebi var: ayni kisit
-- uretimde `products_merchant_external_unique`, depo goclerinin urettigi
-- temiz replay'de `products_merchant_external_id_key` adiyla duruyor
-- (olculdu). Ada bakan bir test, kisit YERINDE oldugu halde duserdi --
-- yani ayrismayi bulmak yerine gurultu uretirdi. Onemli olan kisitin
-- kendisi: (merchant_id, external_id) ve (vendor_id, external_id)
-- ciftleri benzersiz mi?
do $$
declare
  v_eksik text := '';
begin
  if not exists (
    select 1 from pg_index i
     where i.indrelid = 'public.products'::regclass and i.indisunique
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(i.indkey) k
              join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k)
           = array['external_id','merchant_id']
  ) then
    v_eksik := v_eksik || '(merchant_id, external_id) ';
  end if;

  if not exists (
    select 1 from pg_index i
     where i.indrelid = 'public.products'::regclass and i.indisunique
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(i.indkey) k
              join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k)
           = array['external_id','vendor_id']
  ) then
    v_eksik := v_eksik || '(vendor_id, external_id) ';
  end if;

  if v_eksik <> '' then
    raise exception
      'BENZERSIZLIK KISITI KAYIP: %. Bir "kullanilmayan indeks temizligi" '
      'bunlari suporuyorsa, kaybedilen sey performans degil veri '
      'butunlugudur.', v_eksik;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 3) DÜŞÜRÜLENLER GERİ GELMEMİŞ
-- --------------------------------------------------------------------------
do $$
declare
  v_geri text;
begin
  select string_agg(indexname, ', ') into v_geri
    from pg_indexes
   where schemaname = 'public' and tablename = 'products'
     and indexname in ('products_search_idx',
                       'products_canonical_key_idx',
                       'products_group_price_idx');

  if v_geri is not null then
    raise exception
      'DUSURULEN INDEKS GERI GELMIS: %. Uretimde olculdu: ucunun de '
      'idx_scan = 0 ve sayaclar hic sifirlanmamis.', v_geri;
  end if;

  raise notice 'products indeksleri: 3/3 iddia gecti.';
end $$;

rollback;
