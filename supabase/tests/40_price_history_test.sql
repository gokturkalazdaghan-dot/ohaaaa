-- ============================================================================
-- price_history() iddiaları
-- ============================================================================
begin;

do $$
declare
  v_group  uuid;
  v_offer  uuid;
  v_offer2 uuid;
  v_rows   integer;
  v_val    bigint;
begin
  select id into v_group from public.product_groups where slug = 'apple-iphone-15-128gb';
  select id into v_offer  from public.products where group_id = v_group order by price_cents limit 1;
  select id into v_offer2 from public.products where group_id = v_group and id <> v_offer order by price_cents limit 1;

  -- Tetikleyicinin yazdiklarini temizle: sadece bizim kurdugumuz senaryo kalsin
  delete from public.price_points where product_id in (v_offer, v_offer2);

  -- Senaryo: 20 gun once 100 TL, 5 gun once 80 TL. Aradaki gunlerde GOZLEM YOK.
  insert into public.price_points (product_id, price_cents, in_stock, observed_at)
  values (v_offer, 10000, true, now() - interval '20 days'),
         (v_offer, 8000,  true, now() - interval '5 days');

  -- 1) Gozlem olmayan gunlerde son bilinen fiyat tasinmali.
  --    price_points yalnizca DEGISIMDE satir yazar; "gozlem yok = fiyat yok"
  --    demek, degismeyen fiyati kayip gostermek olurdu.
  select min_price_cents into v_val
    from public.price_history(v_group, 30)
   where day = (current_date - 10);
  if v_val is distinct from 10000 then
    raise exception '10 gun oncesinde tasinan fiyat 10000 olmali, % geldi', v_val;
  end if;
  raise notice '✓ gozlem olmayan gunde son bilinen fiyat tasiniyor';

  -- 2) Yeni gozlemden sonra yeni fiyat gecerli olmali.
  select min_price_cents into v_val
    from public.price_history(v_group, 30)
   where day = (current_date - 2);
  if v_val is distinct from 8000 then
    raise exception '2 gun oncesinde fiyat 8000 olmali, % geldi', v_val;
  end if;
  raise notice '✓ yeni gozlemden sonra yeni fiyat gecerli';

  -- 3) Ilk gozlemden ONCEKI gunler icin satir OLMAMALI.
  --    Bilmedigimiz bir donem icin fiyat uydurmak, gecmisi carpitmak olurdu.
  select count(*) into v_rows
    from public.price_history(v_group, 30)
   where day < (current_date - 20);
  if v_rows <> 0 then
    raise exception 'ilk gozlemden onceki gunler icin % satir dondu, 0 olmali', v_rows;
  end if;
  raise notice '✓ gozlem oncesi donem icin fiyat uydurulmuyor';

  -- 4) Grup seviyesinde EN DUSUK alinmali (sitenin siralama olcutuyle ayni).
  insert into public.price_points (product_id, price_cents, in_stock, observed_at)
  values (v_offer2, 6000, true, now() - interval '3 days');
  select min_price_cents into v_val
    from public.price_history(v_group, 30)
   where day = (current_date - 1);
  if v_val is distinct from 6000 then
    raise exception 'grup en dusugu 6000 olmali, % geldi', v_val;
  end if;
  raise notice '✓ grup seviyesinde en dusuk fiyat aliniyor';

  -- 5) Stokta olmayan gozlem sayilmamali: alinamayan fiyat, fiyat degildir.
  insert into public.price_points (product_id, price_cents, in_stock, observed_at)
  values (v_offer2, 100, false, now() - interval '1 day');
  select min_price_cents into v_val
    from public.price_history(v_group, 30)
   where day = current_date;
  if v_val = 100 then
    raise exception 'stokta olmayan gozlem gecmise girmemeli';
  end if;
  raise notice '✓ stokta olmayan gozlem gecmise girmiyor';
end $$;

rollback;
