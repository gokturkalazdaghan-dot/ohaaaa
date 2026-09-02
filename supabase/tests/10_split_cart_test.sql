-- ============================================================================
-- TEST · create_order() — split-cart, komisyon ve stok davranışı
-- ============================================================================
\set ON_ERROR_STOP on

begin;

-- Müşteri olarak oturum aç (Supabase JWT taklidi).
set local role postgres;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

do $$
declare
  v_order        public.orders;
  v_vendor_count integer;
  v_item_count   integer;
  v_expected_sub bigint;
  v_tm_payout    bigint;
  v_tm_sub       bigint;
  v_tm_comm      bigint;
  v_stock_before integer;
  v_stock_after  integer;
begin
  select stock into v_stock_before from public.products
   where id = '50000000-0000-4000-8000-000000000004';

  -- İKİ FARKLI TAŞERONDAN üç kalem: split-cart tetiklenmeli.
  --   Teknomarkt : Sony XM5 x2 (11.899,00 ₺) + Airfryer x1 (8.249,00 ₺)
  --   Moda Vitrin: Nike Pegasus x1 (4.499,00 ₺)
  v_order := public.create_order(
    '[{"product_id":"50000000-0000-4000-8000-000000000004","quantity":2},
      {"product_id":"50000000-0000-4000-8000-00000000000c","quantity":1},
      {"product_id":"50000000-0000-4000-8000-00000000000a","quantity":1}]'::jsonb,
    'musteri@ornek.com',
    '{"ad_soyad":"Zeynep Yılmaz","il":"İstanbul","ilce":"Kadıköy","adres":"Test Mah. 1"}'::jsonb
  );

  -- ---- 1) Sipariş tek, alt sipariş iki tane olmalı -------------------------
  select count(*) into v_vendor_count
    from public.vendor_orders where order_id = v_order.id;

  if v_vendor_count <> 2 then
    raise exception 'BAŞARISIZ: 2 alt sipariş (vendor_order) bekleniyordu, % bulundu', v_vendor_count;
  end if;

  select count(*) into v_item_count
    from public.order_items where order_id = v_order.id;

  if v_item_count <> 3 then
    raise exception 'BAŞARISIZ: 3 kalem bekleniyordu, % bulundu', v_item_count;
  end if;

  -- ---- 2) Ara toplam sunucuda doğru hesaplanmalı ---------------------------
  v_expected_sub := (1189900 * 2) + 824900 + 449900;   -- = 3654600

  if v_order.items_subtotal_cents <> v_expected_sub then
    raise exception 'BAŞARISIZ: ara toplam % bekleniyordu, % bulundu',
      v_expected_sub, v_order.items_subtotal_cents;
  end if;

  -- ---- 3) Komisyon taşeronun KENDİ oranıyla hesaplanmalı -------------------
  /*
   * KOMISYON SIFIR OLMALI.
   *
   * Bu test daha once %7 bekliyordu ve gecerdi -- cunku hem kod hem tohum
   * verisi komisyon kesiyordu. Ama platformun saticiya verdigi soz SIFIR
   * KOMISYON; testin sabitledigi sey yanlis is modeliydi.
   *
   * Yanlis olani dogru sanip sabitleyen bir test, hatayi duzeltilemez hale
   * getirir: birisi kodu duzeltmeye kalktiginda test onu geri cevirir.
   */
  select items_subtotal_cents, commission_cents, payout_cents
    into v_tm_sub, v_tm_comm, v_tm_payout
    from public.vendor_orders
   where order_id = v_order.id
     and vendor_id = 'a0000000-0000-4000-8000-00000000000a';

  if v_tm_comm <> 0 then
    raise exception 'BAŞARISIZ: komisyon sifir olmali, % kurus kesilmis', v_tm_comm;
  end if;

  -- ---- 4) Hakediş = ara toplam + kargo - komisyon --------------------------
  if v_tm_payout <> v_tm_sub + (select shipping_cents from public.vendor_orders
                                 where order_id = v_order.id
                                   and vendor_id = 'a0000000-0000-4000-8000-00000000000a')
                    - v_tm_comm then
    raise exception 'BAŞARISIZ: hakediş (payout) tutarsız: %', v_tm_payout;
  end if;

  -- ---- 5) Ana sipariş toplamı alt siparişlerin toplamına eşit olmalı -------
  if v_order.grand_total_cents <>
       (select sum(items_subtotal_cents + shipping_cents)
          from public.vendor_orders where order_id = v_order.id) then
    raise exception 'BAŞARISIZ: genel toplam alt siparişlerle uyuşmuyor';
  end if;

  -- ---- 6) Stok düşmüş olmalı ----------------------------------------------
  select stock into v_stock_after from public.products
   where id = '50000000-0000-4000-8000-000000000004';

  if v_stock_after <> v_stock_before - 2 then
    raise exception 'BAŞARISIZ: stok %→% bekleniyordu, % bulundu',
      v_stock_before, v_stock_before - 2, v_stock_after;
  end if;

  -- ---- 7) Ödeme onayı durumları ilerletmeli --------------------------------
  perform public.confirm_payment(v_order.id, 'simulated', 'SIM-TEST-0001');

  if (select status from public.orders where id = v_order.id) <> 'paid' then
    raise exception 'BAŞARISIZ: sipariş ödendi olarak işaretlenmedi';
  end if;

  if exists (select 1 from public.vendor_orders
              where order_id = v_order.id and status = 'awaiting_vendor') then
    raise exception 'BAŞARISIZ: alt siparişler "accepted" durumuna geçmedi';
  end if;

  raise notice '✓ split-cart: 1 sipariş → 2 alt sipariş, 3 kalem, toplam % kuruş',
    v_order.grand_total_cents;
end
$$;

-- ---- 8) Stok yetersizliği tüm siparişi geri almalı (atomiklik) -------------
do $$
declare
  v_orders_before bigint;
  v_orders_after  bigint;
begin
  select count(*) into v_orders_before from public.orders;

  begin
    perform public.create_order(
      '[{"product_id":"50000000-0000-4000-8000-000000000003","quantity":999}]'::jsonb,
      'musteri@ornek.com', '{}'::jsonb
    );
    raise exception 'BAŞARISIZ: stok yetersizken sipariş oluşturuldu';
  exception
    when check_violation then
      null;  -- beklenen davranış
  end;

  select count(*) into v_orders_after from public.orders;

  if v_orders_after <> v_orders_before then
    raise exception 'BAŞARISIZ: başarısız sipariş geri alınmadı (% → %)',
      v_orders_before, v_orders_after;
  end if;

  raise notice '✓ atomiklik: stok yetersizliğinde sipariş tamamen geri alındı';
end
$$;

-- ---- 9) Kargo: eşiksiz kalemde ücret alınır, eşik aşılırsa alınmaz ---------
do $$
declare
  v_order    public.orders;
  v_mv_ship  bigint;   -- Moda Vitrin (eşiksiz, 49,99 ₺ kargo)
  v_tm_ship  bigint;   -- Teknomarkt  (500 ₺ üzeri ücretsiz)
begin
  -- Moda Vitrin iPhone teklifi: kargo 4999, ücretsiz kargo eşiği YOK.
  -- Teknomarkt Sony XM5: kargo 0, eşik 50000 (zaten aşılıyor).
  v_order := public.create_order(
    '[{"product_id":"50000000-0000-4000-8000-000000000002","quantity":1},
      {"product_id":"50000000-0000-4000-8000-000000000004","quantity":1}]'::jsonb,
    'musteri@ornek.com', '{}'::jsonb
  );

  select shipping_cents into v_mv_ship from public.vendor_orders
   where order_id = v_order.id and vendor_id = 'a0000000-0000-4000-8000-00000000000b';

  select shipping_cents into v_tm_ship from public.vendor_orders
   where order_id = v_order.id and vendor_id = 'a0000000-0000-4000-8000-00000000000a';

  if v_mv_ship <> 4999 then
    raise exception 'BAŞARISIZ: eşiksiz kalemde 4999 kargo bekleniyordu, % bulundu', v_mv_ship;
  end if;

  if v_tm_ship <> 0 then
    raise exception 'BAŞARISIZ: eşik aşıldığı için kargo 0 olmalıydı, % bulundu', v_tm_ship;
  end if;

  if v_order.shipping_total_cents <> 4999 then
    raise exception 'BAŞARISIZ: sipariş kargo toplamı 4999 olmalıydı, % bulundu',
      v_order.shipping_total_cents;
  end if;

  if v_order.grand_total_cents <> v_order.items_subtotal_cents + 4999 then
    raise exception 'BAŞARISIZ: genel toplam kargoyu içermiyor';
  end if;

  raise notice '✓ kargo: eşiksiz taşeronda % kuruş alındı, eşiği aşan taşeronda ücretsiz', v_mv_ship;
end
$$;

rollback;
