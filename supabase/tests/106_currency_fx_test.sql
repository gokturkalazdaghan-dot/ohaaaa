-- ===========================================================================
-- 106 — fiyat para birimi ve kur dönüşümü
-- ===========================================================================
--
-- Merkezdeki iki tehlike:
--
--   1. Para birimsiz fiyat geçmişi. `price_cents = 1000` satırı 10 USD mi
--      10 TRY mi olduğunu söylemez; ürünün BUGÜNKÜ para birimine bakarak
--      yorumlamak, para birimi değiştiği gün geçmişin tamamını sessizce
--      yeniden yorumlar ve "en düşük fiyat" bambaşka bir sayı olur.
--   2. Kur yokken sayı üretmek. 1.0 varsaymak ya da rastgele bir kur
--      almak, uydurma bir fiyatı gerçek gibi göstermektir -- kullanıcı o
--      fiyata güvenip tıklar.
begin;
select plan(15);

-- --- 1-3: MODEL AYRIMI KORUNUYOR ------------------------------------------
-- Market ≠ country ≠ currency ≠ locale: dördü AYRI referans tablosu.
select is(
  (select count(*)::int from information_schema.tables
    where table_schema='public' and table_name in ('markets','countries','currencies','locales')),
  4, '1) market/country/currency/locale DORT AYRI tablo');

select ok((select count(*) >= 8 from public.markets), '2) stratejik pazarlar duruyor');

select is(
  (select count(*)::int from public.markets where code in ('TR','EU','UK','US','CA','ANZ','NORDICS','GCC')),
  8, '3) EU/NORDICS/GCC dahil sekiz pazar korundu');

-- --- 4-5: FİYAT PARA BİRİMİNİ TAŞIR ---------------------------------------
select has_column('public', 'price_points', 'currency',
  '4) fiyat noktasi para birimini TASIYOR');

select is(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='price_points' and column_name='currency'),
  'NO', '5) para birimi ZORUNLU -- parasiz fiyat kaydi anlamsiz');

-- --- 6-8: KUR TABLOSU ------------------------------------------------------
select has_table('public', 'fx_rates', '6) kur tablosu var');

select throws_ok(
  $$ insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
     values ('EUR', 'TRY', 45, current_date, '  ') $$,
  '23514', null,
  '7) KAYNAKSIZ kur reddediliyor -- denetlenemeyen fiyat olurdu');

select throws_ok(
  $$ insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
     values ('EUR', 'TRY', -1, current_date, 'x') $$,
  '23514', null,
  '8) negatif kur reddediliyor');

-- --- 9-12: DÖNÜŞÜM DAVRANIŞI ----------------------------------------------
select is(
  public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-07'),
  null::bigint,
  '9) KUR YOKSA NULL -- 1.0 varsaymak uydurma fiyati gercek gibi gosterirdi');

select is(
  public.convert_money_cents(1000, 'USD', 'USD', date '2026-09-07'),
  1000::bigint, '10) ayni para birimi dokunulmadan geciyor');

insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
values ('USD', 'TRY', 40, date '2026-09-01', 'test'),
       ('USD', 'TRY', 50, date '2026-09-10', 'test');

select is(
  public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-07'),
  40000::bigint, '11) o tarihte GECERLI kur kullaniliyor');

-- Gecmis bir fiyati gelecekteki bir kurla cevirmek, o gun var olmayan bir
-- bilgiyi kullanmaktir.
select is(
  public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-05'),
  40000::bigint, '12) GELECEKTEKI kur gecmise UYGULANMIYOR');

-- --- 13: KUR YAYINLANMAYAN GÜN ---------------------------------------------
-- Hafta sonu/tatil: bir onceki is gununun kuru gecerli.
select is(
  public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-09'),
  40000::bigint, '13) kur yayinlanmayan gunde onceki kur gecerli');

-- --- 14: DÖNÜŞÜM SAKLANAN FİYATI DEĞİŞTİRMİYOR ----------------------------
-- Donusturulmus degeri geri yazmak orijinali YOK ETMEK olurdu: kur
-- sonradan duzeltildiginde gecmisi geri alacak hicbir sey kalmazdi.
select is(
  (select provolatile::text || prosecdef::text from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='convert_money_cents'),
  'sfalse',
  '14) donusum STABLE ve SECURITY INVOKER -- fiyati yazamaz, yetki yukseltmez');

-- --- 15: KURLAR VİTRİNE AÇIK, YAZMA KAPALI --------------------------------
-- Bir kur satiri eklemek, gosterilen HER fiyati degistirmektir.
select is(
  (select count(*)::int from (values ('anon'), ('authenticated')) as r(rol)
    where has_table_privilege(r.rol, 'public.fx_rates', 'insert')
       or has_table_privilege(r.rol, 'public.fx_rates', 'update')),
  0, '15) istemci roller kur YAZAMIYOR');

select * from finish();
rollback;
