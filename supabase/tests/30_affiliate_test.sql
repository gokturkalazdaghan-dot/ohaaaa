-- ============================================================================
-- TEST · Affiliate akışı — tıklama, dönüşüm, atıf ve fiyat geçmişi
-- ----------------------------------------------------------------------------
-- Bu dosya gelirin doğru sayıldığını kanıtlar. Buradaki bir hata doğrudan
-- para kaybıdır (atfedilemeyen satış) veya para uydurmadır (mükerrer ciro).
-- ============================================================================
\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- 1) Affiliate teklifi sipariş edilemez
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

do $$
declare
  v_orders_before bigint;
  v_orders_after  bigint;
begin
  select count(*) into v_orders_before from public.orders;

  begin
    perform public.create_order(
      '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      'musteri@ornek.com', '{}'::jsonb
    );
    raise exception 'BAŞARISIZ: ortak mağaza ürünü sipariş edilebildi';
  exception
    when check_violation then null;   -- beklenen
  end;

  select count(*) into v_orders_after from public.orders;

  if v_orders_after <> v_orders_before then
    raise exception 'BAŞARISIZ: reddedilen sipariş geri alınmadı';
  end if;

  raise notice '✓ affiliate teklifi sipariş edilemiyor ve sipariş geri alınıyor';
end
$$;

-- ---------------------------------------------------------------------------
-- 2) Karma sepet: taşeron + ortak mağaza aynı siparişte olamaz
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform public.create_order(
      '[{"product_id":"50000000-0000-4000-8000-000000000004","quantity":1},
        {"product_id":"60000000-0000-4000-8000-000000000003","quantity":1}]'::jsonb,
      'musteri@ornek.com', '{}'::jsonb
    );
    raise exception 'BAŞARISIZ: karma sepet kabul edildi';
  exception
    when check_violation then null;
  end;

  raise notice '✓ karma sepet (taşeron + ortak mağaza) reddediliyor';
end
$$;

-- ---------------------------------------------------------------------------
-- 3) Tıklama kaydı ve dönüşüm atfı
-- ---------------------------------------------------------------------------
do $$
declare
  v_click_id    uuid;
  v_conv        public.conversions;
  v_subid       text := 'test_subid_0123456789abcd';
begin
  v_click_id := public.record_click(
    p_product_id => '60000000-0000-4000-8000-000000000001',
    p_subid      => v_subid,
    p_session_id => 'sess-1',
    p_placement  => 'product_page',
    p_device     => 'mobile'
  );

  if v_click_id is null then
    raise exception 'BAŞARISIZ: tıklama kaydedilmedi';
  end if;

  -- Tıklama anındaki fiyat dondurulmalı.
  if (select price_cents_at_click from public.clicks where id = v_click_id)
     <> (select price_cents from public.products
          where id = '60000000-0000-4000-8000-000000000001') then
    raise exception 'BAŞARISIZ: tıklama anındaki fiyat kaydedilmedi';
  end if;

  -- Mağaza kimliği tıklamadan türetilmeli (istemciden gelmemeli).
  if (select merchant_id from public.clicks where id = v_click_id)
     <> 'b1000000-0000-4000-8000-000000000001' then
    raise exception 'BAŞARISIZ: tıklama yanlış mağazaya yazıldı';
  end if;

  -- Ağ satışı bildirir.
  v_conv := public.record_conversion(
    p_merchant_id      => 'b1000000-0000-4000-8000-000000000001',
    p_network_order_id => 'NET-ORDER-1',
    p_subid            => v_subid,
    p_status           => 'pending',
    p_order_total_cents=> 5349900,
    p_commission_cents => 133747
  );

  if v_conv.click_id <> v_click_id then
    raise exception 'BAŞARISIZ: dönüşüm tıklamaya atfedilmedi';
  end if;

  raise notice '✓ tıklama → dönüşüm atfı subid üzerinden kuruluyor';
end
$$;

-- ---------------------------------------------------------------------------
-- 4) Mükerrer postback ciroyu ikiye katlamamalı (idempotentlik)
-- ---------------------------------------------------------------------------
do $$
declare
  v_count_before bigint;
  v_count_after  bigint;
  v_conv         public.conversions;
begin
  select count(*) into v_count_before from public.conversions;

  -- Ağ aynı satışı tekrar bildirir; bu kez "onaylandı" olarak.
  v_conv := public.record_conversion(
    p_merchant_id      => 'b1000000-0000-4000-8000-000000000001',
    p_network_order_id => 'NET-ORDER-1',
    p_subid            => 'test_subid_0123456789abcd',
    p_status           => 'approved',
    p_order_total_cents=> 5349900,
    p_commission_cents => 133747
  );

  select count(*) into v_count_after from public.conversions;

  if v_count_after <> v_count_before then
    raise exception 'BAŞARISIZ: mükerrer postback yeni satır açtı (% → %)',
      v_count_before, v_count_after;
  end if;

  if v_conv.status <> 'approved' then
    raise exception 'BAŞARISIZ: dönüşüm durumu güncellenmedi';
  end if;

  if v_conv.status_changed_at is null then
    raise exception 'BAŞARISIZ: durum değişim zamanı damgalanmadı';
  end if;

  raise notice '✓ mükerrer postback idempotent: satır açmıyor, durumu güncelliyor';
end
$$;

-- ---------------------------------------------------------------------------
-- 5) subid eşleşmese bile ciro kaydedilmeli (atıf kaybı ≠ veri kaybı)
-- ---------------------------------------------------------------------------
do $$
declare
  v_conv public.conversions;
begin
  v_conv := public.record_conversion(
    p_merchant_id      => 'b1000000-0000-4000-8000-000000000002',
    p_network_order_id => 'NET-ORDER-ORPHAN',
    p_subid            => 'bilinmeyen_subid_999999999',
    p_status           => 'approved',
    p_order_total_cents=> 774900,
    p_commission_cents => 23247
  );

  if v_conv.id is null then
    raise exception 'BAŞARISIZ: atfedilemeyen dönüşüm kaydedilmedi';
  end if;

  if v_conv.click_id is not null then
    raise exception 'BAŞARISIZ: var olmayan tıklamaya atıf yapıldı';
  end if;

  raise notice '✓ atfedilemeyen satış yine kaydediliyor (ciro kaybolmuyor)';
end
$$;

-- ---------------------------------------------------------------------------
-- 6) Sonraki postback''te subid gelmese bile atıf korunmalı
-- ---------------------------------------------------------------------------
do $$
declare
  v_conv public.conversions;
begin
  v_conv := public.record_conversion(
    p_merchant_id      => 'b1000000-0000-4000-8000-000000000001',
    p_network_order_id => 'NET-ORDER-1',
    p_subid            => null,
    p_status           => 'paid',
    p_order_total_cents=> 5349900,
    p_commission_cents => 133747
  );

  if v_conv.click_id is null then
    raise exception 'BAŞARISIZ: subid gelmeyince mevcut atıf kaybedildi';
  end if;

  raise notice '✓ subid''siz güncellemede mevcut atıf korunuyor';
end
$$;

-- ---------------------------------------------------------------------------
-- 7) Fiyat geçmişi: yalnızca DEĞİŞİMDE kayıt
-- ---------------------------------------------------------------------------
do $$
declare
  v_product uuid := '60000000-0000-4000-8000-000000000003';
  v_before  bigint;
  v_after   bigint;
begin
  select count(*) into v_before from public.price_points where product_id = v_product;

  -- Aynı fiyatla güncelleme: yeni satır OLUŞMAMALI.
  update public.products set title = title || '' where id = v_product;
  update public.products set price_cents = price_cents where id = v_product;

  select count(*) into v_after from public.price_points where product_id = v_product;
  if v_after <> v_before then
    raise exception 'BAŞARISIZ: fiyat değişmeden geçmişe kayıt atıldı (% → %)',
      v_before, v_after;
  end if;

  -- Fiyat düşüşü: kayıt oluşmalı.
  update public.products set price_cents = 999900 where id = v_product;

  select count(*) into v_after from public.price_points where product_id = v_product;
  if v_after <> v_before + 1 then
    raise exception 'BAŞARISIZ: fiyat değişimi geçmişe yazılmadı';
  end if;

  -- Stoğun tükenmesi de gözlemdir.
  update public.products set stock = 0 where id = v_product;

  if (select count(*) from public.price_points where product_id = v_product)
     <> v_before + 2 then
    raise exception 'BAŞARISIZ: stok durumu değişimi kaydedilmedi';
  end if;

  raise notice '✓ fiyat geçmişi yalnızca değişimde yazılıyor (şişme yok)';
end
$$;

-- ---------------------------------------------------------------------------
-- 8) deal_score gerçek gözleme dayanmalı
-- ---------------------------------------------------------------------------
do $$
declare
  v_product uuid := '60000000-0000-4000-8000-000000000004';
  v_score   jsonb;
begin
  -- Gözlem geçmişi oluştur: 900,00 → 850,00 → 774,90
  update public.products set price_cents = 900000 where id = v_product;
  update public.products set price_cents = 850000 where id = v_product;
  update public.products set price_cents = 774900 where id = v_product;

  v_score := public.deal_score(v_product, 90);

  if (v_score ->> 'available')::boolean is not true then
    raise exception 'BAŞARISIZ: deal_score veri bulamadı';
  end if;

  if (v_score ->> 'is_lowest_ever')::boolean is not true then
    raise exception 'BAŞARISIZ: en düşük fiyat tespit edilemedi (%)', v_score;
  end if;

  if (v_score ->> 'min_price_cents')::bigint <> 774900 then
    raise exception 'BAŞARISIZ: pencere minimumu yanlış (%)', v_score ->> 'min_price_cents';
  end if;

  -- Yeni ürünlerde iddia zayıf olmalı: 30 günden az gözlem = düşük güven.
  if (v_score ->> 'confidence') <> 'low' then
    raise exception 'BAŞARISIZ: yeni üründe güven düzeyi "low" olmalıydı (%)',
      v_score ->> 'confidence';
  end if;

  -- Fiyat yükselirse "en düşük" iddiası düşmeli.
  update public.products set price_cents = 950000 where id = v_product;
  v_score := public.deal_score(v_product, 90);

  if (v_score ->> 'is_lowest_ever')::boolean is not false then
    raise exception 'BAŞARISIZ: fiyat yükseldiği halde "en düşük" iddiası sürüyor';
  end if;

  raise notice '✓ deal_score kendi gözlemimize dayanıyor, güven düzeyi bildiriyor';
end
$$;

-- ---------------------------------------------------------------------------
-- 9) Tıklama/dönüşüm verisi sızmamalı
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
begin
  begin
    perform 1 from public.clicks limit 1;
    raise exception 'BAŞARISIZ: taşeron tıklama verisine erişebiliyor';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.conversions limit 1;
    raise exception 'BAŞARISIZ: taşeron dönüşüm verisine erişebiliyor';
  exception
    when insufficient_privilege then null;
  end;

  -- Fiyat geçmişi ise herkese açıktır: indirim iddiasının kanıtıdır.
  if not exists (select 1 from public.price_points) then
    raise exception 'BAŞARISIZ: fiyat geçmişi herkese açık olmalıydı';
  end if;

  raise notice '✓ tıklama/dönüşüm gizli, fiyat geçmişi herkese açık';
end
$$;

reset role;
rollback;
