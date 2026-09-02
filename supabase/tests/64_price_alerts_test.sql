-- ============================================================================
-- FİYAT DÜŞÜŞ BİLDİRİMİ
-- ============================================================================
begin;

\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'alarm@ornek.com', '{"full_name":"Alarm"}'::jsonb)
on conflict (id) do nothing;

do $$
declare
  v_grup uuid;
  v_fiyat bigint;
  v_fav uuid;
  n int;
begin
  select id, min_price_cents into v_grup, v_fiyat
    from public.product_groups where min_price_cents is not null limit 1;
  if v_grup is null then
    raise exception 'BAŞARISIZ: fiyatli urun grubu yok';
  end if;

  -- 1) Dususu esigi GECMEYEN favori bildirilmez: kayit fiyati guncel fiyata
  --    cok yakin.
  insert into public.favorites (user_id, group_id, saved_price_cents)
  values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', v_grup,
          (v_fiyat / 0.98)::bigint)   -- yalnizca ~%2 dusus
  returning id into v_fav;

  select count(*) into n from public.pending_price_alerts()
   where favorite_id = v_fav;
  if n <> 0 then
    raise exception 'BAŞARISIZ: esigi gecmeyen dusus bildirilecek sayildi';
  end if;
  raise notice '✓ kucuk dusus bildirilmiyor';

  -- 2) Esigi gecen dusus bildirilir
  update public.favorites
     set saved_price_cents = (v_fiyat / 0.5)::bigint   -- %50 dusus
   where id = v_fav;

  select count(*) into n from public.pending_price_alerts()
   where favorite_id = v_fav;
  if n <> 1 then
    raise exception 'BAŞARISIZ: gercek dusus bildirilmiyor (% satir)', n;
  end if;
  raise notice '✓ esigi gecen dusus bildiriliyor';

  -- 3) Yakin zamanda bildirilen tekrar bildirilmez
  update public.favorites set last_alerted_at = now() where id = v_fav;
  select count(*) into n from public.pending_price_alerts()
   where favorite_id = v_fav;
  if n <> 0 then
    raise exception 'BAŞARISIZ: bekleme suresi yok sayildi';
  end if;
  raise notice '✓ bekleme suresi uygulaniyor';

  -- 4) Bekleme suresi dolunca yeniden bildirilir
  update public.favorites
     set last_alerted_at = now() - interval '30 days' where id = v_fav;
  select count(*) into n from public.pending_price_alerts()
   where favorite_id = v_fav;
  if n <> 1 then
    raise exception 'BAŞARISIZ: bekleme dolunca bildirilmedi';
  end if;
  raise notice '✓ bekleme dolunca yeniden bildiriliyor';

  -- 5) Kullanici kapattiysa bildirilmez
  update public.favorites set notify_on_drop = false where id = v_fav;
  select count(*) into n from public.pending_price_alerts()
   where favorite_id = v_fav;
  if n <> 0 then
    raise exception 'BAŞARISIZ: kapatilmis bildirim yine gonderilecek sayildi';
  end if;
  raise notice '✓ kullanici bildirimi kapatabiliyor';
end $$;

-- 6) Fonksiyon kisisel veri donuyor: istemciye KAPALI olmali
do $$
begin
  if has_function_privilege('anon', 'public.pending_price_alerts(numeric,int,int)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.pending_price_alerts(numeric,int,int)', 'EXECUTE') then
    raise exception 'BAŞARISIZ: bildirim listesi istemciden okunabiliyor (e-posta sizar)';
  end if;
  raise notice '✓ bildirim listesi istemciye kapali';
end $$;

-- 7) Kullanici KAYIT FIYATINI degistiremez ama bildirimi kapatabilir:
--    yetki sutun bazinda verildi.
do $$
begin
  if not has_column_privilege('authenticated', 'public.favorites', 'notify_on_drop', 'UPDATE') then
    raise exception 'BAŞARISIZ: kullanici bildirim tercihini degistiremiyor';
  end if;
  if has_column_privilege('authenticated', 'public.favorites', 'saved_price_cents', 'UPDATE') then
    raise exception 'BAŞARISIZ: kayit anindaki fiyat degistirilebiliyor';
  end if;
  if has_column_privilege('authenticated', 'public.favorites', 'last_alerted_at', 'UPDATE') then
    raise exception 'BAŞARISIZ: kullanici bildirim zamanini sifirlayip tekrar tetikleyebilir';
  end if;
  raise notice '✓ yetki sutun bazinda: tercih acik, fiyat ve zaman kapali';
end $$;

rollback;
