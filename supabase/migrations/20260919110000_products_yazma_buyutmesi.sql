-- ===========================================================================
-- products: HİÇ KULLANILMAYAN ÜÇ İNDEKS DÜŞÜRÜLÜYOR
-- ---------------------------------------------------------------------------
-- NEDEN: YAZMA BÜYÜTMESİ (write amplification)
--
-- Alım turu `upsertOffers` adımında zaman aşımına uğramaya devam ediyordu.
-- Parti boyutunu 100'den 50'ye indirmek YETMEDİ -- çünkü bağlayıcı kısıt
-- parti başına satır sayısı değilmiş.
--
-- ÖLÇÜLEN SEBEP (pg_stat_user_tables, üretim):
--
--   products    n_tup_upd = 146.151   n_tup_hot_upd = 3   -> HOT oranı %0,0
--   (kıyas) product_groups                                -> HOT oranı %11,5
--
-- HOT (Heap-Only Tuple) güncellemesi mümkün olmadığında, BİR satırın
-- güncellenmesi tablonun BÜTÜN indekslerini yeniden yazdırır. `products`
-- üzerinde 17 indeks var. Yani her teklif yazması on yedi indeks yazması
-- demek -- ve tur içinde biriken bu yük, sonunda bir partiyi 8 saniyelik
-- `statement_timeout`un üstüne çıkarıyor. "Başta iyi, gittikçe kötüleşiyor"
-- kalıbının sebebi bu.
--
-- ---------------------------------------------------------------------------
-- DÜŞÜRÜLENLER VE NEDEN GÜVENLİ OLDUKLARI
-- ---------------------------------------------------------------------------
-- Üçünün de `idx_scan = 0` ve bu sayı veritabanının TÜM ÖMRÜNÜ kapsıyor:
-- `pg_stat_database.stats_reset` null, yani sayaçlar hiç sıfırlanmamış.
--
--   products_search_idx          GIN (search_vector)            8.584 kB
--       En pahalısı. GIN indeksleri bakımı en maliyetli türdür ve
--       `search_vector` başlık/açıklamadan ÜRETİLDİĞİ için her upsert onu
--       yeniden yazar. Depoda `search_vector`'e değen tek bir satır yok:
--       ne SQL fonksiyonlarında ne uygulama kodunda (arandı, sıfır sonuç).
--       Arama `product_groups` üzerindeki indekslerden gidiyor.
--
--   products_canonical_key_idx   btree (canonical_key)          6.152 kB
--       `canonical_key` de hiçbir yerde okunmuyor. Eşleştirme
--       `match_signature` ve `fingerprint` üzerinden yapılıyor.
--
--   products_group_price_idx     btree (group_id, price_cents)  2.384 kB
--       TAM KOPYA. `products_group_active_idx` BİREBİR aynı tanıma sahip
--       (aynı sütunlar, aynı kısmi koşul) ve 541.354 tarama alıyor.
--       Planlayıcı ikisinden birini seçiyor; diğeri yalnızca yazılıyor,
--       hiç okunmuyor.
--
-- ---------------------------------------------------------------------------
-- DÜŞÜRÜLMEYEN: products_vendor_external_id_key
-- ---------------------------------------------------------------------------
-- Onun da taraması sıfır AMA o bir UNIQUE indeks: performans için değil,
-- KISIT için duruyor. Bir satıcının aynı `external_id` ile iki ürün
-- açamamasını o sağlıyor. "Taranmıyor" demek "bir işe yaramıyor" demek
-- değildir; benzersizlik kısıtları okunmaz, ihlal anında devreye girer.
-- Onu düşürmek bir performans iyileştirmesi değil, sessiz bir veri
-- bütünlüğü kaybı olurdu.
-- ===========================================================================

drop index if exists public.products_search_idx;
drop index if exists public.products_canonical_key_idx;
drop index if exists public.products_group_price_idx;

do $$
declare
  v_kalan  int;
  v_unique int;
begin
  select count(*) into v_kalan
    from pg_indexes
   where schemaname = 'public' and tablename = 'products'
     and indexname in ('products_search_idx',
                       'products_canonical_key_idx',
                       'products_group_price_idx');

  if v_kalan <> 0 then
    raise exception 'indeksler dusurulmedi (% kaldi)', v_kalan;
  end if;

  -- KORUNMASI GEREKEN kisit hala yerinde mi?
  select count(*) into v_unique
    from pg_indexes
   where schemaname = 'public' and tablename = 'products'
     and indexname = 'products_vendor_external_id_key';

  if v_unique <> 1 then
    raise exception
      'products_vendor_external_id_key KAYBOLDU -- benzersizlik kisiti bu '
      'gocte korunmaliydi';
  end if;

  -- Kopyanin hayatta kalani duruyor mu? Ikisini birden dusurmek, 541 bin
  -- taramali bir erisim yolunu yok etmek olurdu.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'products'
       and indexname = 'products_group_active_idx'
  ) then
    raise exception
      'products_group_active_idx yok -- kopyanin YANLIS olani dusurulmus';
  end if;

  raise notice 'products yazma buyutmesi azaltildi: 3 kullanilmayan indeks dusuruldu';
end $$;
