-- ===========================================================================
-- OHAAAA - Uretimden seed (ornek) verisini kaldir
-- ---------------------------------------------------------------------------
-- NEDEN
-- supabase/seed.sql gelistirme icindir: uydurma saticilar, uydurma urunler ve
-- uydurma FIYATLAR icerir. Bu satirlar uretim veritabanina girerse site,
-- gercek olmayan fiyatlari gercekmis gibi gosterir. Bir fiyat karsilastirma
-- sitesinde fiyat, urunun kendisidir - yani ziyaretciye yalan soylenmis olur.
--
-- Satici adini arayuzde gizlemek bu sorunu COZMEZ, orter: adsiz bir kart da
-- "bu urun su fiyata" iddiasini surdurur, ustelik daha inandirici gorunur.
-- Dogru cozum veriyi kaldirmaktir.
--
-- NASIL
-- Tahmine dayali eslestirme (ad oneki, "ornek" kelimesi) yapilmaz. seed.sql
-- tum satirlarini SABIT UUID'lerle ekler; asagidaki liste dogrudan o dosyadan
-- uretilmistir. Yalnizca bu 46 kimlik silinir - gercek veriye, adi ne
-- olursa olsun, dokunulmaz.
--
-- KULLANIM
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/purge-seed-data.sql
--
-- Betik once NE SILECEGINI raporlar, sonra tek islemde siler. Bir sey ters
-- giderse hicbir satir gitmez.
-- ===========================================================================

begin;

create temporary table _seed_ids (id uuid primary key) on commit drop;

insert into _seed_ids (id) values
    ('11111111-1111-4111-8111-111111111111'),
    ('22222222-2222-4222-8222-222222222222'),
    ('33333333-3333-4333-8333-333333333333'),
    ('40000000-0000-4000-8000-000000000001'),
    ('40000000-0000-4000-8000-000000000002'),
    ('40000000-0000-4000-8000-000000000003'),
    ('40000000-0000-4000-8000-000000000004'),
    ('40000000-0000-4000-8000-000000000005'),
    ('40000000-0000-4000-8000-000000000006'),
    ('44444444-4444-4444-8444-444444444444'),
    ('50000000-0000-4000-8000-000000000001'),
    ('50000000-0000-4000-8000-000000000002'),
    ('50000000-0000-4000-8000-000000000003'),
    ('50000000-0000-4000-8000-000000000004'),
    ('50000000-0000-4000-8000-000000000005'),
    ('50000000-0000-4000-8000-000000000006'),
    ('50000000-0000-4000-8000-000000000007'),
    ('50000000-0000-4000-8000-000000000008'),
    ('50000000-0000-4000-8000-000000000009'),
    ('50000000-0000-4000-8000-00000000000a'),
    ('50000000-0000-4000-8000-00000000000b'),
    ('50000000-0000-4000-8000-00000000000c'),
    ('55555555-5555-4555-8555-555555555555'),
    ('60000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000002'),
    ('60000000-0000-4000-8000-000000000003'),
    ('60000000-0000-4000-8000-000000000004'),
    ('a0000000-0000-4000-8000-00000000000a'),
    ('a0000000-0000-4000-8000-00000000000b'),
    ('a0000000-0000-4000-8000-00000000000c'),
    ('b1000000-0000-4000-8000-000000000001'),
    ('b1000000-0000-4000-8000-000000000002'),
    ('c0000000-0000-4000-8000-000000000001'),
    ('c0000000-0000-4000-8000-000000000002'),
    ('c0000000-0000-4000-8000-000000000003'),
    ('c0000000-0000-4000-8000-000000000004'),
    ('c0000000-0000-4000-8000-000000000005'),
    ('c0000000-0000-4000-8000-000000000006'),
    ('c0000000-0000-4000-8000-000000000011'),
    ('c0000000-0000-4000-8000-000000000012'),
    ('c0000000-0000-4000-8000-000000000013'),
    ('c1000000-0000-4000-8000-000000000001'),
    ('c1000000-0000-4000-8000-000000000002'),
    ('f0000000-0000-4000-8000-000000000001'),
    ('f0000000-0000-4000-8000-000000000002'),
    ('f0000000-0000-4000-8000-000000000003');

-- --- Ne silinecek? ---------------------------------------------------------
-- Once makine-okunur tek satir: cagiran betik bunu okuyup karar verir.
select 'SEED_ROWS=' || (
    (select count(*) from public.flash_deals    where id in (select id from _seed_ids))
  + (select count(*) from public.products       where id in (select id from _seed_ids))
  + (select count(*) from public.product_groups where id in (select id from _seed_ids))
  + (select count(*) from public.sources        where id in (select id from _seed_ids))
  + (select count(*) from public.vendors        where id in (select id from _seed_ids))
  + (select count(*) from public.merchants      where id in (select id from _seed_ids))
  + (select count(*) from public.categories     where id in (select id from _seed_ids))
  + (select count(*) from auth.users            where id in (select id from _seed_ids))
) as ozet;

select 'flash_deals'    as tablo, count(*) as silinecek from public.flash_deals    where id in (select id from _seed_ids)
union all select 'products',       count(*) from public.products       where id in (select id from _seed_ids)
union all select 'product_groups', count(*) from public.product_groups where id in (select id from _seed_ids)
union all select 'sources',        count(*) from public.sources        where id in (select id from _seed_ids)
union all select 'vendors',        count(*) from public.vendors        where id in (select id from _seed_ids)
union all select 'merchants',      count(*) from public.merchants      where id in (select id from _seed_ids)
union all select 'categories',     count(*) from public.categories     where id in (select id from _seed_ids)
union all select 'auth.users',     count(*) from auth.users            where id in (select id from _seed_ids);

-- --- Silme (cocuktan ebeveyne) ---------------------------------------------
delete from public.flash_deals    where id in (select id from _seed_ids);
delete from public.products       where id in (select id from _seed_ids);
delete from public.product_groups where id in (select id from _seed_ids);
delete from public.sources        where id in (select id from _seed_ids);
delete from public.vendors        where id in (select id from _seed_ids);
delete from public.merchants      where id in (select id from _seed_ids);
delete from public.categories     where id in (select id from _seed_ids);
delete from auth.users            where id in (select id from _seed_ids);

-- --- Sonuc -----------------------------------------------------------------
select 'product_groups' as tablo, count(*) as kalan from public.product_groups
union all select 'products',  count(*) from public.products
union all select 'vendors',   count(*) from public.vendors
union all select 'merchants', count(*) from public.merchants;

-- --- Kuru calistirma -------------------------------------------------------
-- `-v dry_run=1` ile cagrilirsa hicbir degisiklik kalici olmaz. Cagiran betik
-- once bununla "seed var mi" diye bakar, sonra gercekten siler. Boylece tespit
-- ve silme AYNI kimlik listesini kullanir; ikisi zamanla ayrisamaz.
\if :{?dry_run}
  \echo 'KURU CALISTIRMA - hicbir satir silinmedi'
  rollback;
\else
  commit;
\endif
