-- Tazelik: "gördük" ile "doğruladık" ayrı; "ölçmedik" ile "bayat" ayrı.
begin;
select plan(12);

insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template, country_code, terms_verified_at)
values ('taze-m', 'Taze Magaza', 'https://taze.gecersiz', 'direct', 'active',
        'https://taze.gecersiz/g?u={url}', 'TR', now());

insert into public.products
  (merchant_id, external_id, title, price_cents, currency, market, status,
   fulfillment, product_url, stock)
select id, 'TZ-1', 'Taze Urun', 100000, 'TRY', 'TR', 'active',
       'affiliate', 'https://taze.gecersiz/u/1', 10
  from public.merchants where slug = 'taze-m';

-- --- 1-2) HİÇ ÖLÇÜLMEMİŞ ≠ TAZE -------------------------------------------
/*
 * Sütunların varsayılanı yok ve bu kasıtlı: `now()` varsayılanı vermek,
 * hiç doğrulanmamış bir fiyatı "az önce doğrulandı" diye işaretlerdi.
 */
select is(
  public.offer_freshness((select id from public.products where external_id='TZ-1'))
    -> 'price' ->> 'state',
  'olculmedi',
  '1) hic olculmemis fiyat "olculmedi" -- taze DEGIL'
);

select is(
  public.offer_freshness((select id from public.products where external_id='TZ-1'))
    -> 'overall' ->> 'state',
  'olculmedi',
  '2) bir bilesen bile olculmemisse genel durum "olculmedi"'
);

-- --- 3-5) TAZE ------------------------------------------------------------
update public.products
   set price_checked_at = now() - interval '10 minutes',
       stock_checked_at = now() - interval '2 minutes',
       offer_checked_at = now() - interval '3 minutes'
 where external_id = 'TZ-1';

select is(
  public.offer_freshness((select id from public.products where external_id='TZ-1'))
    -> 'price' ->> 'state',
  'taze',
  '3) 10 dk once dogrulanmis fiyat taze'
);

select ok(
  (public.offer_freshness((select id from public.products where external_id='TZ-1'))
    -> 'price' ->> 'age_minutes')::numeric between 9 and 11,
  '4) fiyat yasi dakika olarak dogru'
);

/*
 * GENEL TAZELİK = EN BAYAT BİLEŞEN, ortalama değil.
 *
 * Fiyat 10 dk, stok 2 dk, teklif 3 dk. Ortalama ~5 dk derdi ve fiyatın
 * en bayat bilgi olduğunu gizlerdi. Kullanıcıyı yanıltan şey en bayat
 * bilgidir.
 */
select ok(
  (public.offer_freshness((select id from public.products where external_id='TZ-1'))
    -> 'overall' ->> 'age_minutes')::numeric between 9 and 11,
  '5) genel tazelik EN BAYAT bilesene esit (ortalama degil)'
);

-- --- 6-7) BAYAT -----------------------------------------------------------
update public.products
   set price_checked_at = now() - interval '30 hours'
 where external_id = 'TZ-1';

select is(
  public.offer_freshness((select id from public.products where external_id='TZ-1'))
    -> 'price' ->> 'state',
  'bayat',
  '6) esigi asan fiyat bayat'
);

select is(
  public.offer_freshness((select id from public.products where external_id='TZ-1'))
    -> 'overall' ->> 'state',
  'bayat',
  '7) tek bayat bilesen genel durumu bayat yapiyor'
);

-- --- 8) EŞİK YAPILANDIRILABİLİR -------------------------------------------
select is(
  public.offer_freshness(
    (select id from public.products where external_id='TZ-1'), 3000)
    -> 'price' ->> 'state',
  'taze',
  '8) esik parametresi gecerli: 3000 dk esikte ayni fiyat taze'
);

-- --- 9-11) DEĞİŞİM DAMGASI ------------------------------------------------
/*
 * "Kontrol ettik" ile "değişti" AYRI olaylar. Alım hattı her çalışmada
 * tüm teklifleri upsert eder; çoğunda fiyat aynıdır. Değişim damgasını
 * her upsert'te atmak, değişmeyen bir ürünü "sürekli değişiyor" gösterirdi
 * -- ve uyarlanabilir yoklama tam olarak bu sinyale bakacak.
 */
update public.products set price_checked_at = now() where external_id = 'TZ-1';

select ok(
  (select last_price_change_at from public.products where external_id='TZ-1') is null,
  '9) fiyat DEGISMEDEN yapilan kontrol degisim damgasi atmiyor'
);

update public.products set price_cents = 90000 where external_id = 'TZ-1';

select ok(
  (select last_price_change_at from public.products where external_id='TZ-1') is not null,
  '10) fiyat degisince damga atiliyor'
);

-- Stok DEĞİŞİMİ "var/yok" geçişidir; 10'dan 9'a düşmek değil.
update public.products set stock = 9 where external_id = 'TZ-1';
select ok(
  (select last_stock_change_at from public.products where external_id='TZ-1') is null,
  '11) stok adedi degisimi (10->9) stok DURUMU degisimi sayilmiyor'
);

update public.products set stock = 0 where external_id = 'TZ-1';
select ok(
  (select last_stock_change_at from public.products where external_id='TZ-1') is not null,
  '12) stok var->yok gecisi damga atiyor'
);

select * from finish();
rollback;
