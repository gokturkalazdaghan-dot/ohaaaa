-- ===========================================================================
-- Arama fiyat suzgeci: para birimleri arasinda karsilastirma YAPILMIYOR
-- ===========================================================================
--
-- Sinanan tek fikir: 5000 SAYISI TEK BASINA BIR FIYAT DEGILDIR.
-- 5000 kurus (₺50,00), 5000 sent ($50.00) ve 5000 forint (~13 USD) ayni
-- sayidir; "5000'e kadar" suzgeci onlari ayirt etmek zorunda.
--
-- 20260907330000 bu kurali `search_products_page` icin koymustu, ama
-- sayfanin GERCEKTE kullandigi `search_products` ve `search_facets`
-- dokunulmadan kalmisti. Bu dosya o iki fonksiyonu sinar.
-- ===========================================================================
begin;
select plan(9);

-- Iki grup, AYNI SAYI, farkli para birimi.
insert into public.product_groups (slug, title, brand, category_id, offer_count,
                                   min_price_cents, max_price_cents, price_currency)
select 'pbt-try', 'PBT Kulaklik TRY', 'PBTMarka', c.id, 1, 5000, 5000, 'TRY'
  from public.categories c where c.is_active limit 1;
insert into public.product_groups (slug, title, brand, category_id, offer_count,
                                   min_price_cents, max_price_cents, price_currency)
select 'pbt-usd', 'PBT Kulaklik USD', 'PBTMarka', c.id, 1, 5000, 5000, 'USD'
  from public.categories c where c.is_active limit 1;

-- --- 1-2: SUZGEC PARA BIRIMI ICINDE ---------------------------------------

select is(
  (select count(*)::int from public.search_products(
     'PBT Kulaklik', null, 0, 6000, 'relevance', 50, 0, null, false, 'TRY')),
  1,
  '1) TRY istenince yalnizca TRY grubu -- 5000 kurus ile 5000 sent ayni sayi degil');

select is(
  (select count(*)::int from public.search_products(
     'PBT Kulaklik', null, 0, 6000, 'relevance', 50, 0, null, false, 'USD')),
  1,
  '2) USD istenince yalnizca USD grubu');

-- --- 3: PARA BIRIMI YOKSA FIYAT SUZGECI HIC UYGULANMAZ --------------------
-- Sessizce birini elemek, hangi para biriminde oldugunu BILMEDEN karar
-- vermek olurdu. `search_products_page` ile ayni kural.
select is(
  (select count(*)::int from public.search_products(
     'PBT Kulaklik', null, 0, 1, 'relevance', 50, 0)),
  2,
  '3) para birimi yokken fiyat suzgeci uygulanmiyor');

-- --- 4: SUZGEC GERCEKTEN SUZUYOR ------------------------------------------
-- 1-3 tek basina "hicbir seyi elemeyen" bozuk bir uygulamayla da gecerdi.
select is(
  (select count(*)::int from public.search_products(
     'PBT Kulaklik', null, 6000, null, 'relevance', 50, 0, null, false, 'TRY')),
  0,
  '4) araligin disindaki grup ELENIYOR -- suzgec gercekten calisiyor');

-- --- 5-6: FACET SINIRLARI --------------------------------------------------
-- Sinirlar bir SUZGEC degil OZET. Iki para birimi karisikken min/max almak
-- "en dusuk 100 (HUF), en yuksek 9.000.000 (kurus)" gibi anlamsiz bir
-- aralik uretirdi; NULL "fiyat yok" degil "tek aralikla ifade edilemez".
select is(
  (public.search_facets('PBT Kulaklik')->'min_price_cents'),
  'null'::jsonb,
  '5) iki para birimi karisikken sinir uretilmiyor');

select is(
  (public.search_facets('PBT Kulaklik', null, null, false, 'USD')->>'min_price_cents')::bigint,
  5000::bigint,
  '6) para birimi verilince sinir geri geliyor');

-- --- 7: TEK PARA BIRIMLI KAPSAMDA SINIR PARAMETRESIZ DE GELIYOR -----------
-- Bugunku katalogun tamami tek para biriminde; 5. iddianin kurali mevcut
-- davranisi BOZMAMALI. Bozsaydi filtre seridi her aramada kaybolurdu.
select isnt(
  (public.search_facets('PBT Kulaklik USD')->'min_price_cents'),
  'null'::jsonb,
  '7) kapsam tek para birimindeyse sinir parametresiz de doner');

-- --- 8: ESKI KONUMSAL CAGRILAR BOZULMADI ----------------------------------
-- p_currency SONA eklendi; onceki imzayla yazilmis her cagri (pgTAP
-- dosyalari ve dagitimda henuz guncellenmemis istemciler) calismali.
select lives_ok(
  $$ select * from public.search_products(null, null, null, null, 'relevance', 1, 0) $$,
  '8) eski konumsal cagri calisiyor -- p_currency varsayilanli ve sonda');

-- --- 9: ACL DROP SONRASI GERI VERILDI -------------------------------------
-- `drop function` grant'lari da dusurur. Geri verilmeseydi arama anon icin
-- 403 dondururdu: bir ozellik degil, SITENIN KENDISI kirilirdi.
select is(
  (select count(*)::int from (values ('anon'), ('authenticated')) as r(rol)
    where has_function_privilege(r.rol,
      'public.search_products(text, uuid, bigint, bigint, text, integer, integer, text[], boolean, char(3))',
      'execute')
      and has_function_privilege(r.rol,
      'public.search_facets(text, uuid, text[], boolean, char(3))', 'execute')),
  2,
  '9) anon ve authenticated iki fonksiyonu da calistirabiliyor');

select * from finish();
rollback;
