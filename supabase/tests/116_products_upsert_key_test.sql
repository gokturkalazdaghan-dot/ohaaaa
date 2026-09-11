-- ===========================================================================
-- products: UPSERT anahtari gercekten CIKARILABILIR mi?
-- ===========================================================================
--
-- Alim hattinin tek yazma yolu su ifade:
--
--   insert ... on conflict (merchant_id, external_id) do update ...
--
-- Bu, catisma hedefinde YUKLEM TASIMIYOR. PostgreSQL kismi bir tekil indeksi
-- ancak ayni yuklem verildiginde cikarabilir; yuklemsiz istek
-- "no unique or exclusion constraint matching" ile duser.
--
-- Eskiden indeks `where merchant_id is not null` yuklemiyle tanimliydi ve
-- 35.952 satirlik gercek feed tam olarak bu hatayla durdu. Bu dosya, indeksin
-- bir daha yuklemli hale gelmemesini sabitliyor.
-- ===========================================================================
begin;
select plan(6);

-- --- 1: INDEKS VAR -------------------------------------------------------
select has_index('public', 'products', 'products_merchant_external_unique',
  '1) upsert anahtari indeksi mevcut');

-- --- 2: VE YUKLEMSIZ -----------------------------------------------------
-- Asil kural bu. Indeksin varligi tek basina yetmez; yuklemli bir indeks de
-- 1. iddiayi gecerdi ama alim hattini yine kirardi.
select is(
  (select pg_get_expr(i.indpred, i.indrelid)
     from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'products_merchant_external_unique'),
  null,
  '2) indeks YUKLEMSIZ -- ON CONFLICT bunu cikarabilir');

-- --- 3: ESKI KISMI INDEKS GITTI ------------------------------------------
select is(
  (select count(*)::int from pg_class
    where relname = 'products_merchant_external_id_key'),
  0,
  '3) eski kismi indeks kaldirildi');

-- --- 4: YUKLEMSIZ UPSERT GERCEKTEN CALISIYOR -----------------------------
-- Yapiyi degil DAVRANISI sinar: duzeltilen sey tam olarak bu ifadenin kabul
-- edilmesiydi.
select lives_ok(
  $$ insert into public.products
       (fulfillment, merchant_id, external_id, title, image_urls, product_url,
        price_cents, currency, market_code, stock, shipping_fee_cents, status,
        category_id)
     select 'affiliate', m.id, 'PGTAP-UPSERT-1', 'pgTAP kalemi', '{}'::text[],
            'https://www.awin1.com/pclick.php?p=1', 100, 'GBP', 'UK', 1, 0,
            'active', (select id from public.categories limit 1)
       from public.merchants m
      where m.status = 'active' and m.network_advertiser_id is not null
      limit 1
     on conflict (merchant_id, external_id) do update
       set price_cents = excluded.price_cents $$,
  '4) yuklemsiz ON CONFLICT kabul ediliyor');

-- --- 5: IKINCI KEZ YAZMAK MUKERRER URETMIYOR -----------------------------
select lives_ok(
  $$ insert into public.products
       (fulfillment, merchant_id, external_id, title, image_urls, product_url,
        price_cents, currency, market_code, stock, shipping_fee_cents, status,
        category_id)
     select 'affiliate', m.id, 'PGTAP-UPSERT-1', 'pgTAP kalemi', '{}'::text[],
            'https://www.awin1.com/pclick.php?p=1', 250, 'GBP', 'UK', 1, 0,
            'active', (select id from public.categories limit 1)
       from public.merchants m
      where m.status = 'active' and m.network_advertiser_id is not null
      limit 1
     on conflict (merchant_id, external_id) do update
       set price_cents = excluded.price_cents $$,
  '5) ayni anahtar ikinci kez yazilabiliyor (idempotent)');

-- --- 6: ...VE TEK SATIR, GUNCELLENMIS FIYATLA ----------------------------
-- 5. iddia tek basina "her seferinde yeni satir ac" gibi bozuk bir
-- uygulamayla da gecerdi. Bu iddia sayiyi VE guncellemeyi birlikte sinar.
select is(
  (select count(*)::int || '/' || max(price_cents)::text
     from public.products where external_id = 'PGTAP-UPSERT-1'),
  '1/250',
  '6) tek satir kaldi ve fiyat guncellendi');

select * from finish();
rollback;
