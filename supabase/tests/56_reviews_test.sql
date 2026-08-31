-- ============================================================================
-- TEST · Değerlendirmeler — satın alma doğrulaması ve ortalama puan
-- ============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_user   uuid := '90000000-0000-4000-8000-000000000001';
  v_other  uuid := '90000000-0000-4000-8000-000000000002';
  v_vendor uuid;
  v_group  uuid;
  v_product uuid;
  v_order  uuid;
  v_vo     uuid;
  v_item   uuid;
  v_item2  uuid;
  v_rating numeric;
  v_count  int;
begin
  -- --- Kurulum: gerçek bir teslim edilmiş sipariş -------------------------
  -- public.users, auth.users'a bagli (tetikleyici ile dolar). Testte de
  -- gercek yol izlenir: once auth kaydi, sonra profil.
  insert into auth.users (id, email) values
    (v_user, 'alici@example.com'), (v_other, 'baskasi@example.com');
  update public.users set role = 'customer' where id in (v_user, v_other);

  select id into v_vendor from public.vendors limit 1;
  select id, group_id into v_product, v_group
    from public.products where vendor_id = v_vendor and group_id is not null limit 1;

  insert into public.orders (id, user_id, email, status, items_subtotal_cents, grand_total_cents)
  values (gen_random_uuid(), v_user, 'alici@example.com', 'delivered', 1000, 1000)
  returning id into v_order;

  insert into public.vendor_orders (id, order_id, vendor_id, status, items_subtotal_cents, commission_rate)
  values (gen_random_uuid(), v_order, v_vendor, 'delivered', 1000, 0)
  returning id into v_vo;

  insert into public.order_items
    (id, order_id, vendor_order_id, vendor_id, product_id, title_snapshot,
     unit_price_cents, quantity, line_total_cents)
  values (gen_random_uuid(), v_order, v_vo, v_vendor, v_product, 'Test', 1000, 1, 1000)
  returning id into v_item;

  -- --- 1) Satın alan yorum yazabilir ---------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);

  insert into public.reviews (order_item_id, user_id, group_id, vendor_id, product_rating, vendor_rating, body)
  values (v_item, v_user, v_group, v_vendor, 5, 4, 'Urun anlatildigi gibi geldi, kargo hizliydi.');
  raise notice '✓ satin alan kullanici yorum yazabiliyor';

  -- --- 2) AYNI kalemi ikinci kez değerlendiremez ---------------------------
  begin
    insert into public.reviews (order_item_id, user_id, group_id, vendor_id, product_rating, vendor_rating)
    values (v_item, v_user, v_group, v_vendor, 1, 1);
    raise exception 'BASARISIZ: ayni kalem iki kez degerlendirilebildi';
  exception when unique_violation then
    raise notice '✓ bir kalem yalnizca bir kez degerlendirilebiliyor';
  end;

  -- --- 3) BAŞKASININ siparişiyle yorum yazamaz -----------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role','authenticated')::text, true);
  begin
    insert into public.reviews (order_item_id, user_id, group_id, vendor_id, product_rating, vendor_rating)
    values (v_item, v_other, v_group, v_vendor, 5, 5);
    raise exception 'BASARISIZ: baskasinin siparisiyle yorum yazilabildi';
  exception when insufficient_privilege then
    raise notice '✓ baskasinin siparisiyle yorum yazilamiyor';
  end;

  -- --- 4) Teslim EDİLMEMİŞ sipariş değerlendirilemez ------------------------
  reset role;
  update public.vendor_orders set status = 'shipped' where id = v_vo;
  insert into public.order_items
    (id, order_id, vendor_order_id, vendor_id, product_id, title_snapshot,
     unit_price_cents, quantity, line_total_cents)
  values (gen_random_uuid(), v_order, v_vo, v_vendor, v_product, 'Test 2', 1000, 1, 1000)
  returning id into v_item2;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);
  begin
    insert into public.reviews (order_item_id, user_id, group_id, vendor_id, product_rating, vendor_rating)
    values (v_item2, v_user, v_group, v_vendor, 5, 5);
    raise exception 'BASARISIZ: teslim edilmemis siparis degerlendirilebildi';
  exception when insufficient_privilege then
    raise notice '✓ teslim edilmemis siparis degerlendirilemiyor';
  end;

  -- --- 5) Aldığı kalemi dayanak gösterip BAŞKA ürüne puan veremez ----------
  reset role;
  update public.vendor_orders set status = 'delivered' where id = v_vo;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);
  begin
    insert into public.reviews (order_item_id, user_id, group_id, vendor_id, product_rating, vendor_rating)
    values (v_item2, v_user,
            (select id from public.product_groups where id <> v_group limit 1),
            v_vendor, 5, 5);
    raise exception 'BASARISIZ: alinmayan urune puan verilebildi';
  exception when insufficient_privilege then
    raise notice '✓ alinan kalem baska bir urune dayanak yapilamiyor';
  end;

  -- --- 6) Ortalama puan VERİTABANI tarafından hesaplanıyor -----------------
  reset role;
  select rating, rating_count into v_rating, v_count
    from public.product_groups where id = v_group;
  if v_rating <> 5.00 or v_count <> 1 then
    raise exception 'BASARISIZ: urun ortalamasi yanlis (% / %)', v_rating, v_count;
  end if;

  select rating, rating_count into v_rating, v_count
    from public.vendors where id = v_vendor;
  if v_rating <> 4.00 or v_count <> 1 then
    raise exception 'BASARISIZ: satici ortalamasi yanlis (% / %)', v_rating, v_count;
  end if;
  raise notice '✓ urun ve satici ortalamalari ayri ayri, dogru hesaplaniyor';

  -- --- 7) Yorum gizlenince ortalama GÜNCELLENİYOR --------------------------
  -- Uygulama hesaplasaydi, gizleme yolunu guncellemeyi unutabilirdi.
  update public.reviews set status = 'hidden' where order_item_id = v_item;
  select rating_count into v_count from public.product_groups where id = v_group;
  if v_count <> 0 then
    raise exception 'BASARISIZ: gizlenen yorum ortalamada kaldi (%)', v_count;
  end if;
  raise notice '✓ gizlenen yorum ortalamadan dusuyor';

  -- --- 8) anon yorum yazamaz ----------------------------------------------
  set local role anon;
  begin
    insert into public.reviews (order_item_id, user_id, group_id, vendor_id, product_rating, vendor_rating)
    values (v_item2, v_user, v_group, v_vendor, 5, 5);
    raise exception 'BASARISIZ: anon yorum yazabildi';
  exception when insufficient_privilege then
    raise notice '✓ anon yorum yazamiyor';
  end;
  reset role;
end $$;

rollback;
