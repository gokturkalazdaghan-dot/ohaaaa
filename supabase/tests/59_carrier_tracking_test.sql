-- TEST · Kargo takip doğrulaması
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_vendor uuid; v_order uuid; v_vo uuid; v_st text; v_puan int; r jsonb;
begin
  select id into v_vendor from public.vendors where slug = 'teknomarkt';
  insert into public.orders (user_id, email, status, items_subtotal_cents, grand_total_cents)
  values (null, 'a@b.com', 'paid', 1000, 1000) returning id into v_order;
  insert into public.vendor_orders (order_id, vendor_id, status, items_subtotal_cents, commission_rate)
  values (v_order, v_vendor, 'accepted', 1000, 0) returning id into v_vo;

  -- 1) Bicim denetimi
  if not public.validate_tracking_number('yurtici', '1234567890123') then
    raise exception 'BASARISIZ: gecerli numara reddedildi';
  end if;
  if public.validate_tracking_number('yurtici', 'ABC') then
    raise exception 'BASARISIZ: gecersiz numara kabul edildi';
  end if;
  raise notice '✓ bicim denetimi calisiyor';

  -- 2) Bosluk/tire GURULTUSU sahtecilik sayilmaz
  if not public.validate_tracking_number('yurtici', ' 1234-5678-90123 ') then
    raise exception 'BASARISIZ: bosluk/tire iceren gecerli numara reddedildi';
  end if;
  raise notice '✓ bosluk ve tire temizleniyor, gecerli numara reddedilmiyor';

  -- 3) TANIMSIZ firma kabul edilmiyor
  if public.validate_tracking_number('kargom', '1234567890123') then
    raise exception 'BASARISIZ: tanimsiz firma kabul edildi';
  end if;
  raise notice '✓ tanimsiz kargo firmasi reddediliyor';

  -- 4) Takip numarasi OLMADAN kargolama reddediliyor
  begin
    update public.vendor_orders set status = 'shipped' where id = v_vo;
    raise exception 'BASARISIZ: takip numarasiz kargolama gecti';
  exception when check_violation then
    raise notice '✓ takip numarasi olmadan kargolanamiyor';
  end;

  -- 5) SAHTE bicimli numara reddediliyor
  begin
    update public.vendor_orders
       set status = 'shipped', carrier = 'yurtici', tracking_number = 'UYDURMA123'
     where id = v_vo;
    raise exception 'BASARISIZ: gecersiz bicimli numara kabul edildi';
  exception when check_violation then
    raise notice '✓ bicime uymayan takip numarasi reddediliyor';
  end;

  -- 6) Gecerli numara gecer ve durum UYDURULMAZ
  update public.vendor_orders
     set status = 'shipped', carrier = 'yurtici', tracking_number = '1234567890123'
   where id = v_vo;
  select tracking_verified::text into v_st from public.vendor_orders where id = v_vo;
  if v_st <> 'dogrulanmadi' then
    raise exception 'BASARISIZ: sorulmadan dogrulanmis sayildi (%)', v_st;
  end if;
  raise notice '✓ gecerli numara gecti, durum "dogrulanmadi" -- uydurulmuyor';

  -- 7) Firma "bulunamadi" derse 50 puan (sozlesme md. 7)
  v_puan := public.vendor_violation_score(v_vendor);
  r := public.mark_tracking_missing(v_vo);
  if (r ->> 'points')::int <> 50 then
    raise exception 'BASARISIZ: sahte takip 50 puan olmali, % geldi', r ->> 'points';
  end if;
  if public.vendor_violation_score(v_vendor) <> v_puan + 50 then
    raise exception 'BASARISIZ: puan islenmedi';
  end if;
  select tracking_verified::text into v_st from public.vendor_orders where id = v_vo;
  if v_st <> 'bulunamadi' then
    raise exception 'BASARISIZ: durum guncellenmedi (%)', v_st;
  end if;
  raise notice '✓ firma numarayi tanimazsa 50 puan isleniyor ve durum yaziliyor';
end $$;

rollback;
