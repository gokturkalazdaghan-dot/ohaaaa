-- ============================================================================
-- TEST · Yetki tabanı (GRANT katmanı) — RLS'ten BAĞIMSIZ kanıt
-- ----------------------------------------------------------------------------
-- Bu dosya bilerek RLS'i sınamaz; onu 20_rls_test.sql yapıyor. Buradaki soru
-- daha alttaki katman: rol, tabloya DOKUNMA YETKİSİNİ taşıyor mu?
--
-- Ayrı durmasının sebebi, iki katmanın farklı şeyler için bozulması:
--   • RLS politikası yanlışsa yanlış SATIR görünür.
--   • GRANT fazlaysa RLS'in hiç uğramadığı işlemler açık kalır — TRUNCATE
--     gibi. Satır düzeyi güvenlik satırlar üzerinde çalışır; TRUNCATE tablo
--     düzeyindedir ve hiçbir politikaya uğramaz.
--
-- Bu yüzden iddia `has_table_privilege` üzerinden kurulur: sonuç kümesine
-- değil, KATALOĞA bakar. Bir tabloda politika satırları gizlediği için "boş
-- döndü, demek ki güvenli" demek, ölçtüğünü sandığın şeyi ölçmemektir.
-- ============================================================================
\set ON_ERROR_STOP on

begin;
select plan(52);

-- ---------------------------------------------------------------------------
-- 1) TRUNCATE hiçbir role, hiçbir tabloda verilmemiş olmalı.
-- ---------------------------------------------------------------------------
-- Tek tek yazmak yerine tablo listesi kataloğdan gelir: YENİ eklenen bir
-- tablo bu testi otomatik olarak kapsar. Elle yazılmış bir liste, korunması
-- en çok gereken tabloyu (henüz yazılmamış olanı) hep dışarıda bırakır.
select is_empty(
  $$select c.relname || ' -> ' || r.rolname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) as r(rolname)
     where n.nspname = 'public'
       and c.relkind = 'r'
       and has_table_privilege(r.rolname, c.oid, 'TRUNCATE')$$,
  'hicbir tabloda anon/authenticated TRUNCATE yetkisi yok'
);

-- Aynısı REFERENCES ve TRIGGER için: ikisi de şema değiştirme yetkisidir ve
-- istemci rollerinin işi değildir.
select is_empty(
  $$select c.relname || ' -> ' || r.rolname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) as r(rolname)
     where n.nspname = 'public'
       and c.relkind = 'r'
       and has_table_privilege(r.rolname, c.oid, 'TRIGGER')$$,
  'hicbir tabloda anon/authenticated TRIGGER yetkisi yok'
);

-- ---------------------------------------------------------------------------
-- 2) anon: yalnızca vitrin, yalnızca okuma.
-- ---------------------------------------------------------------------------
select ok(
  has_table_privilege('anon', 'public.' || t, 'SELECT'),
  'anon ' || t || ' tablosunu okuyabilir'
) from unnest(array[
  'categories','product_groups','products','vendors',
  'flash_deals','merchants','price_points'
]) as t;

-- anon HİÇBİR yere yazamaz. Yazma yetkisinin olmaması, RLS'in doğru
-- kurulmuş olmasından bağımsız bir güvencedir.
select ok(
  not has_table_privilege('anon', 'public.' || t, 'INSERT,UPDATE,DELETE'),
  'anon ' || t || ' tablosuna yazamaz'
) from unnest(array[
  'categories','product_groups','products','vendors','flash_deals',
  'merchants','price_points','users','orders','order_items','vendor_orders',
  'api_keys','api_request_logs','clicks','conversions','sources',
  'ingest_runs','api_rate_counters','reviews'
]) as t;

-- Gizli tablolar anon'a hiç açılmaz: boş sonuç değil, doğrudan yetki reddi.
select ok(
  not has_table_privilege('anon', 'public.' || t, 'SELECT'),
  'anon ' || t || ' tablosunu goremez'
) from unnest(array[
  'users','orders','order_items','vendor_orders','api_keys',
  'api_request_logs','clicks','conversions','sources','ingest_runs',
  'api_rate_counters'
]) as t;

-- ---------------------------------------------------------------------------
-- 3) authenticated: yazabildiği yerler adı adına sayılıdır.
-- ---------------------------------------------------------------------------
-- Hangi SATIRA dokunabildiğine RLS karar verir; burada sınanan, yetkinin
-- listenin DIŞINA taşmadığı.
select is_empty(
  $$select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and has_table_privilege('authenticated', c.oid, 'INSERT')
       -- `reviews`: kullanici kendi degerlendirmesini yazar. Hangi SATIRI
       -- yazabildigine RLS karar verir (yalnizca teslim alinmis kendi
       -- siparisi); buradaki liste yalnizca yetkinin nereye kadar
       -- uzandigini sabitler.
       and c.relname not in ('api_keys', 'vendors', 'products', 'reviews')$$,
  'authenticated yalnizca api_keys/vendors/products/reviews tablolarina INSERT edebilir'
);

select is_empty(
  $$select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and has_table_privilege('authenticated', c.oid, 'DELETE')
       -- `reviews`: kullanici kendi yorumunu silebilmeli.
       and c.relname not in ('api_keys', 'vendors', 'products', 'reviews')$$,
  'authenticated yalnizca api_keys/vendors/products/reviews tablolarindan DELETE edebilir'
);

select ok(
  has_table_privilege('authenticated', 'public.' || t, 'UPDATE'),
  'authenticated ' || t || ' tablosunu guncelleyebilir'
) from unnest(array['users','vendor_orders','api_keys','vendors','products']) as t;

-- Tıklama ve dönüşüm kayıtları PARA YOLUDUR: yalnızca sunucu yazar.
select ok(
  not has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated ' || t || ' tablosuna hic erisemez'
) from unnest(array['clicks','conversions','ingest_runs','api_rate_counters','sources']) as t;

-- ---------------------------------------------------------------------------
-- 4) Varsayılan yetkiler: bundan sonra açılacak tablo geniş doğmasın.
-- ---------------------------------------------------------------------------
-- Kök neden buydu. Bu iddia olmadan göç tek seferlik bir temizlik olur ve
-- bir sonraki tabloyla delik geri gelir.
select is_empty(
  $$select pg_get_userbyid(d.defaclrole) || ': ' || d.defaclacl::text
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
     where n.nspname = 'public'
       and d.defaclobjtype = 'r'
       and (d.defaclacl::text like '%anon=%' or d.defaclacl::text like '%authenticated=%')$$,
  'public semasinda anon/authenticated icin varsayilan tablo yetkisi kalmadi'
);

select * from finish();
rollback;
