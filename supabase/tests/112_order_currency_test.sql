-- ===========================================================================
-- Siparis para birimi: TAHSIL EDILEN tutar dogru para biriminde mi?
-- ===========================================================================
--
-- Bu depoda kovaladigimiz hata sinifinin en pahali hâli burasi. Digerlerinde
-- yanlis olan GOSTERILEN fiyatti; burada yanlis olan TAHSIL EDILEN tutar ve
-- muhasebeye gecen kayit.
--
-- `orders.currency` sutunu vardi, varsayilani 'TRY' idi ve `create_order` onu
-- HIC yazmiyordu: 199 USD'lik bir urun 19900 "kurus" sayilip musteriden
-- ~199 TL alinirdi.
-- ===========================================================================
begin;
select plan(8);

-- Tohumdaki iki urunden birini USD'ye cevir. Ayni tasern, ayni fiyat --
-- degisen TEK sey para birimi, yani sinanan sey de yalnizca o.
update public.products set currency = 'USD'
 where id = '50000000-0000-4000-8000-000000000002';

-- --- 1: KARISIK SEPET REDDEDILIYOR ----------------------------------------
-- Iki para birimini tek `grand_total_cents` ile tahsil etmenin yolu yok.
-- Kur cevirisi YAPILMIYOR: fx_rates bos ve kaynaksiz kur uydurmak yasak;
-- ayrica hangi kurla tahsil edildigi siparise yazilmadan yapilan bir
-- cevirim denetlenemez.
select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"50000000-0000-4000-8000-000000000001","quantity":1},
         {"product_id":"50000000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
       'pb-test@ornek.example', '{}'::jsonb, null) $$,
  '23514', null,
  '1) karisik para birimli sepet REDDEDILIYOR -- sessizce toplanmiyor');

-- --- 2-4: TEK PARA BIRIMLI USD SIPARIS ------------------------------------
select is(
  (select currency from public.create_order(
     '[{"product_id":"50000000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
     'pb-test@ornek.example', '{}'::jsonb, null)),
  'USD'::char(3),
  '2) siparisin para birimi URUNDEN yaziliyor -- varsayilan TRY''de kalmiyor');

select is(
  (select currency from public.create_order(
     '[{"product_id":"50000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
     'pb-test@ornek.example', '{}'::jsonb, null)),
  'TRY'::char(3),
  '3) TRY siparis TRY kaliyor -- kural her seyi USD yapan bir uygulamayla gecmiyor');

-- Tutar hâlâ dogru hesaplaniyor: para birimi eklemek toplami bozmadi.
select ok(
  (select grand_total_cents from public.create_order(
     '[{"product_id":"50000000-0000-4000-8000-000000000002","quantity":2}]'::jsonb,
     'pb-test@ornek.example', '{}'::jsonb, null)) > 0,
  '4) toplam hesabi bozulmadi');

-- --- 5: KALEM SIPARISTEN SAPAMAZ ------------------------------------------
-- Islev dogru yazilmis olsa bile baska bir yazici gelebilir. Ertelenmis
-- tetikleyici, kurali islevin dogruluguna baglamaktan cikariyor.
--
-- Once TRY bir siparis olusturulur, sonra kalemi USD bir urune cevrilir.
select throws_ok(
  $$ do $x$
     declare o public.orders;
     begin
       o := public.create_order(
         '[{"product_id":"50000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
         'pb-test2@ornek.example', '{}'::jsonb, null);
       update public.order_items
          set product_id = '50000000-0000-4000-8000-000000000002'
        where order_id = o.id;
     end $x$ $$,
  '23514', null,
  '5) siparisin para biriminden sapan kalem REDDEDILIYOR');

-- --- 6: TETIKLEYICI ANINDA CALISIYOR --------------------------------------
-- Ertelenmis olsaydi hata ancak COMMIT aninda gelirdi: hangi kalemin bozuk
-- oldugunu gostermez ve kural, islemi yaziya dokerken en gec anda devreye
-- girerdi. `create_order` para birimini ILK KALEMDEN ONCE yazdigi icin
-- ertelemeye gerek yok. (5. iddia bunun calistigini zaten kanitliyor; burada
-- ozellik SABITLENIYOR -- biri ertelerse sebebi burada yazili.)
select is(
  (select t.tgdeferrable
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'order_items' and t.tgname = 'order_items_currency_matches'),
  false,
  '6) kalem tetikleyicisi aninda calisiyor');

-- --- 7: VAR OLMAYAN PARA BIRIMI KAYDEDILEMEZ ------------------------------
-- Sutun onceden serbest metindi: 'XYZ' ya da 'try' yazilabilirdi.
select throws_ok(
  $$ update public.orders set currency = 'XYZ'
      where id = (select id from public.orders limit 1) $$,
  '23503', null,
  '7) tanimsiz para birimi kodu siparise yazilamiyor');

-- --- 8: create_order GRANT'I KORUNDU --------------------------------------
-- `create or replace` kullanildi. DROP edilseydi ACL duser ve siparis
-- olusturma `authenticated` icin tamamen kirilirdi.
select ok(
  has_function_privilege('authenticated',
    'public.create_order(jsonb, text, jsonb, text)', 'execute'),
  '8) create_order authenticated icin calistirilabilir kaldi');

select * from finish();
rollback;
