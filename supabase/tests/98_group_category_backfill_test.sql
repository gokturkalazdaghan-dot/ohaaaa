-- ============================================================================
-- TEST · scripts/sql/backfill-group-categories.sql — güvenlik kuralları
-- ============================================================================
--
-- NEDEN BU TEST VAR
-- Backfill betiği üretimde 34.510 satır yazdı. Böyle bir betiğin tehlikesi
-- yazdığı satırlar değil, YANLIŞLIKLA yazabileceği satırlardır: dolu bir
-- kategorinin üzerine yazmak, belirsiz bir grupta rastgele seçim yapmak,
-- ya da kaynak olmaması gereken bir mağazadan kategori türetmek. Bu üç
-- davranışın hiçbiri gözle görülmez -- ancak test eder.
--
-- BETİĞİN KOPYASI DEĞİL KENDİSİ ÇALIŞTIRILIR. Aşağıdaki `\ir` gerçek dosyayı
-- dahil eder (`\ir` bu dosyanın KENDİ klasörüne göre çözer). Sorguyu buraya
-- kopyalasaydık iki metin zamanla ayrışır ve test, betiğin artık yapmadığı
-- bir şeyi doğrulamaya devam ederdi.
--
-- Her şey tek işlemde ve sonunda geri alınıyor.
-- ============================================================================
\set ON_ERROR_STOP on

begin;

set local role postgres;

-- --- Kurgu -----------------------------------------------------------------
-- Altı vaka, altı grup. Kategoriler ve taşeron tohum verisinden.
insert into public.product_groups (id, slug, title, category_id) values
  ('d0000000-0000-4000-8000-000000000001', 'bf-tekil',     'Tekil kategori',        null),
  ('d0000000-0000-4000-8000-000000000002', 'bf-belirsiz',  'Çakışan kategoriler',   null),
  ('d0000000-0000-4000-8000-000000000003', 'bf-urunsuz',   'Ürünsüz öksüz',         null),
  ('d0000000-0000-4000-8000-000000000004', 'bf-dolu',      'Kategorisi zaten dolu', 'c0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000005', 'bf-kanitsiz',  'Ürünlerde kategori yok', null),
  ('d0000000-0000-4000-8000-000000000006', 'bf-yasakli',   'Yalnızca yasaklı kaynak', null);

do $$
declare
  v_tasoron uuid := 'a0000000-0000-4000-8000-00000000000a';  -- Teknomarkt (tohum)
  v_sp      uuid;
begin
  /*
   * Yasaklı kaynak: Simple Project. Onun teklifleri üretime dahil edilmemeli,
   * dolayısıyla ondan kategori de TÜRETİLMEMELİ.
   *
   * Mağaza göçlerle geliyor, burada YARATILMIYOR: `active` yapmak
   * `merchants_active_needs_verified_terms` kısıtını ihlal ederdi ve testin
   * konusu o kısıt değil. Yoksa test anlamsızdır, o yüzden açıkça düşüyor.
   */
  select id into v_sp from public.merchants where slug = 'simple-project';
  if v_sp is null then
    raise exception 'KURGU HATASI: simple-project mağazası şemada yok, test yasaklı kaynağı deneyemez';
  end if;

  -- Yardımcı: taşeron teklifi (marketplace) ekler.
  insert into public.products
    (id, vendor_id, group_id, external_id, title, category_id, price_cents,
     market_code, fulfillment, stock)
  values
    -- 1) TEKİL: iki ürün de "bilgisayar" diyor -> yazılmalı.
    ('d2000000-0000-4000-8000-000000000011', v_tasoron, 'd0000000-0000-4000-8000-000000000001',
     'bf-1a', 'Tekil A', 'c0000000-0000-4000-8000-000000000012', 1000, 'TR', 'marketplace', 1),
    ('d2000000-0000-4000-8000-000000000012', v_tasoron, 'd0000000-0000-4000-8000-000000000001',
     'bf-1b', 'Tekil B', 'c0000000-0000-4000-8000-000000000012', 1000, 'TR', 'marketplace', 1),

    -- 2) BELİRSİZ: telefon vs kulaklık -> BOŞ KALMALI.
    ('d2000000-0000-4000-8000-000000000021', v_tasoron, 'd0000000-0000-4000-8000-000000000002',
     'bf-2a', 'Belirsiz A', 'c0000000-0000-4000-8000-000000000011', 1000, 'TR', 'marketplace', 1),
    ('d2000000-0000-4000-8000-000000000022', v_tasoron, 'd0000000-0000-4000-8000-000000000002',
     'bf-2b', 'Belirsiz B', 'c0000000-0000-4000-8000-000000000013', 1000, 'TR', 'marketplace', 1),

    -- 4) DOLU: ürün "bilgisayar" diyor ama grubun kategorisi zaten "moda".
    --    Üzerine YAZILMAMALI.
    ('d2000000-0000-4000-8000-000000000041', v_tasoron, 'd0000000-0000-4000-8000-000000000004',
     'bf-4a', 'Dolu A', 'c0000000-0000-4000-8000-000000000012', 1000, 'TR', 'marketplace', 1),

    -- 5) KANITSIZ: ürünün kategorisi de yok -> BOŞ KALMALI.
    ('d2000000-0000-4000-8000-000000000051', v_tasoron, 'd0000000-0000-4000-8000-000000000005',
     'bf-5a', 'Kanitsiz A', null, 1000, 'TR', 'marketplace', 1);

  -- 6) YASAKLI KAYNAK: tek kanıt Simple Project'ten geliyor -> BOŞ KALMALI.
  insert into public.products
    (id, merchant_id, group_id, external_id, title, category_id, price_cents,
     market_code, fulfillment, product_url, stock)
  values
    ('d2000000-0000-4000-8000-000000000061', v_sp, 'd0000000-0000-4000-8000-000000000006',
     'bf-6a', 'Yasakli A', 'c0000000-0000-4000-8000-000000000012', 1000, 'TR',
     'affiliate', 'https://simple.example/u/1', 1);
end $$;

-- Silme olmadığını kanıtlamak için önceki sayılar.
create temporary table bf_once on commit drop as
  select (select count(*) from public.product_groups) as grup,
         (select count(*) from public.products)       as urun;

-- --- BETİĞİN KENDİSİ -------------------------------------------------------
\ir ../../scripts/sql/backfill-group-categories.sql

-- --- İddialar --------------------------------------------------------------
do $$
declare
  v_kategori uuid;
  v_grup     bigint;
  v_urun     bigint;
begin
  -- 1) Tekil kategori yazılmış olmalı.
  select category_id into v_kategori from public.product_groups
   where id = 'd0000000-0000-4000-8000-000000000001';
  if v_kategori is distinct from 'c0000000-0000-4000-8000-000000000012'::uuid then
    raise exception 'BAŞARISIZ: tekil kategorili gruba "bilgisayar" yazılmalıydı, bulunan: %', v_kategori;
  end if;

  -- 2) Belirsiz grup BOŞ kalmalı. Rastgele seçim yapılmamalı.
  select category_id into v_kategori from public.product_groups
   where id = 'd0000000-0000-4000-8000-000000000002';
  if v_kategori is not null then
    raise exception 'BAŞARISIZ: ürünleri farklı kategoriler gösteren grup BOŞ kalmalıydı, yazılan: %', v_kategori;
  end if;

  -- 3) Ürünsüz öksüz grup BOŞ kalmalı.
  select category_id into v_kategori from public.product_groups
   where id = 'd0000000-0000-4000-8000-000000000003';
  if v_kategori is not null then
    raise exception 'BAŞARISIZ: ürünsüz grup BOŞ kalmalıydı, yazılan: %', v_kategori;
  end if;

  -- 4) Dolu kategori KORUNMALI. Bu betiğin en tehlikeli hatası budur.
  select category_id into v_kategori from public.product_groups
   where id = 'd0000000-0000-4000-8000-000000000004';
  if v_kategori is distinct from 'c0000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'BAŞARISIZ: mevcut kategori (moda) korunmalıydı, bulunan: %', v_kategori;
  end if;

  -- 5) Kanıtsız grup BOŞ kalmalı.
  select category_id into v_kategori from public.product_groups
   where id = 'd0000000-0000-4000-8000-000000000005';
  if v_kategori is not null then
    raise exception 'BAŞARISIZ: ürünlerinde kategori olmayan grup BOŞ kalmalıydı, yazılan: %', v_kategori;
  end if;

  -- 6) Simple Project kaynak sayılmamalı.
  select category_id into v_kategori from public.product_groups
   where id = 'd0000000-0000-4000-8000-000000000006';
  if v_kategori is not null then
    raise exception 'BAŞARISIZ: Simple Project kategoriye kaynak OLMAMALIYDI, yazılan: %', v_kategori;
  end if;

  -- 7) Hiçbir satır silinmemiş olmalı.
  select grup, urun into v_grup, v_urun from bf_once;
  if (select count(*) from public.product_groups) <> v_grup then
    raise exception 'BAŞARISIZ: grup sayısı değişti (% -> %)', v_grup, (select count(*) from public.product_groups);
  end if;
  if (select count(*) from public.products) <> v_urun then
    raise exception 'BAŞARISIZ: ürün sayısı değişti (% -> %)', v_urun, (select count(*) from public.products);
  end if;

  raise notice '✓ backfill güvenlik kuralları: 7 iddia geçti';
end $$;

-- --- İdempotanlık ----------------------------------------------------------
-- İkinci çalıştırma HİÇBİR satıra dokunmamalı. Betik üretimde elle ve parti
-- parti çalıştırılıyor; iki kez çalışması kaçınılmaz bir senaryo.
create temporary table bf_imza on commit drop as
  select id, category_id from public.product_groups order by id;

\ir ../../scripts/sql/backfill-group-categories.sql

do $$
declare v_fark bigint;
begin
  select count(*) into v_fark
    from public.product_groups g
    join bf_imza i on i.id = g.id
   where g.category_id is distinct from i.category_id;

  if v_fark <> 0 then
    raise exception 'BAŞARISIZ: ikinci çalıştırma % satırı değiştirdi -- betik idempotent değil', v_fark;
  end if;

  raise notice '✓ idempotanlık: ikinci çalıştırma 0 satır değiştirdi';
end $$;

rollback;
