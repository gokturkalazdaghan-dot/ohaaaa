-- ============================================================================
-- consume_api_rate_limit() iddialari
-- ============================================================================
begin;

do $$
declare
  v_key    uuid;
  v_res    jsonb;
  v_other  uuid;
  v_vendor uuid;
begin
  -- Test kendi anahtarlarini yaratir: seed'de API anahtari yok ve olmamali
  -- da (gercek bir anahtarin ozeti depoya girmemeli).
  select id into v_vendor from public.vendors limit 1;
  if v_vendor is null then
    raise exception 'test icin en az bir taseron gerekiyor';
  end if;

  insert into public.api_keys (vendor_id, name, environment, key_prefix, key_hash, last_four, scopes)
  values (v_vendor, 'hiz-siniri-testi-1', 'test', 'ohk_test_aaaaaaaa',
          repeat('a', 64), 'aaaa', array['products:write'])
  returning id into v_key;

  insert into public.api_keys (vendor_id, name, environment, key_prefix, key_hash, last_four, scopes)
  values (v_vendor, 'hiz-siniri-testi-2', 'test', 'ohk_test_bbbbbbbb',
          repeat('b', 64), 'bbbb', array['products:write'])
  returning id into v_other;

  -- 1) Sinir icindeki istekler gecmeli ve kalan azalmali.
  v_res := public.consume_api_rate_limit(v_key, 3);
  if not (v_res->>'allowed')::boolean then
    raise exception 'ilk istek reddedildi';
  end if;
  if (v_res->>'remaining')::int <> 2 then
    raise exception 'ilk istekten sonra kalan 2 olmali, % geldi', v_res->>'remaining';
  end if;

  perform public.consume_api_rate_limit(v_key, 3);
  v_res := public.consume_api_rate_limit(v_key, 3);
  if not (v_res->>'allowed')::boolean then
    raise exception 'ucuncu istek sinir icinde olmali';
  end if;
  raise notice '✓ sinir icindeki istekler geciyor, kalan dogru azaliyor';

  -- 2) Sinir asilinca reddedilmeli.
  v_res := public.consume_api_rate_limit(v_key, 3);
  if (v_res->>'allowed')::boolean then
    raise exception 'dorduncu istek 3 sinirinda reddedilmeliydi';
  end if;
  if (v_res->>'remaining')::int <> 0 then
    raise exception 'sinir asilinca kalan 0 gosterilmeli (negatif degil), % geldi', v_res->>'remaining';
  end if;
  raise notice '✓ sinir asilinca reddediliyor, kalan negatife dusmuyor';

  -- 3) Sayac ANAHTAR BASINA olmali: bir anahtarin tuketimi digerini etkilememeli.
  v_res := public.consume_api_rate_limit(v_other, 3);
  if not (v_res->>'allowed')::boolean then
    raise exception 'baska bir anahtar, ilkinin tuketiminden etkilenmis';
  end if;
  raise notice '✓ sayac anahtar basina ayri';

  -- 4) Pencere degisince sifirlanmali.
  update public.api_rate_counters
     set window_start = date_trunc('minute', now()) - interval '2 minutes'
   where api_key_id = v_key;

  v_res := public.consume_api_rate_limit(v_key, 3);
  if not (v_res->>'allowed')::boolean then
    raise exception 'yeni pencerede sayac sifirlanmali';
  end if;
  if (v_res->>'remaining')::int <> 2 then
    raise exception 'yeni pencerede kalan 2 olmali, % geldi', v_res->>'remaining';
  end if;
  raise notice '✓ pencere degisince sayac sifirlaniyor';

  -- 5) Anahtar silinince sayaci da gitmeli (yetim satir birikmemeli).
  delete from public.api_keys where id = v_other;
  if exists (select 1 from public.api_rate_counters where api_key_id = v_other) then
    raise exception 'anahtar silindi ama sayac satiri kaldi';
  end if;
  raise notice '✓ anahtar silinince sayaci da siliniyor';
end $$;

rollback;
