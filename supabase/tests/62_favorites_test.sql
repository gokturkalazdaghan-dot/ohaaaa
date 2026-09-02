-- ============================================================================
-- FAVORİLER
-- ============================================================================
begin;

\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('99999999-9999-4999-8999-999999999999', 'fav-a@ornek.com', '{"full_name":"Fav A"}'::jsonb),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fav-b@ornek.com', '{"full_name":"Fav B"}'::jsonb)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}';

do $$
declare
  v_grup uuid;
  n int;
begin
  select id into v_grup from public.product_groups limit 1;
  if v_grup is null then
    raise exception 'BAŞARISIZ: tohum verisinde urun grubu yok';
  end if;
  perform set_config('ohaaaa.test_group_id', v_grup::text, true);

  insert into public.favorites (user_id, group_id, saved_price_cents)
  values ('99999999-9999-4999-8999-999999999999', v_grup, 1189900);
  raise notice '✓ favori eklenebiliyor';

  -- Ayni urun iki kez isaretlenemez
  begin
    insert into public.favorites (user_id, group_id, saved_price_cents)
    values ('99999999-9999-4999-8999-999999999999', v_grup, 999900);
    raise exception 'BAŞARISIZ: ayni urun iki kez favoriye eklendi';
  exception when unique_violation then
    raise notice '✓ ayni urun iki kez eklenemiyor';
  end;

  -- Kayit anindaki fiyat korunur: ikinci deneme onu EZMEMELI
  select saved_price_cents into n from public.favorites
   where user_id = '99999999-9999-4999-8999-999999999999' and group_id = v_grup;
  if n <> 1189900 then
    raise exception 'BAŞARISIZ: kayit anindaki fiyat degismis (%)', n;
  end if;
  raise notice '✓ kayit anindaki fiyat korunuyor';
end $$;

-- Baska kullanici goremez ve baskasi adina yazamaz
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
declare
  v_grup uuid := current_setting('ohaaaa.test_group_id')::uuid;
  n int;
begin
  select count(*) into n from public.favorites
   where user_id = '99999999-9999-4999-8999-999999999999';
  if n <> 0 then
    raise exception 'BAŞARISIZ: baskasinin favorileri okunabiliyor (% satir)', n;
  end if;
  raise notice '✓ favori baska kullaniciya sizmiyor';

  begin
    insert into public.favorites (user_id, group_id)
    values ('99999999-9999-4999-8999-999999999999', v_grup);
    raise exception 'BAŞARISIZ: baskasi adina favori yazilabildi';
  exception when insufficient_privilege then
    raise notice '✓ baskasi adina favori yazilamiyor';
  end;

  -- Olumlu kontrol: kendi favorisini ekleyebilmeli. Bu olmadan her yazmayi
  -- reddeden bozuk bir politika da yukaridaki iddiayi gecerdi.
  insert into public.favorites (user_id, group_id, saved_price_cents)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_grup, 1000000);
  raise notice '✓ kullanici KENDI favorisini ekleyebiliyor';
end $$;

-- Guncelleme yetkisi VERILMEDI: kayit anindaki fiyat degistirilememeli.
do $$
begin
  if has_table_privilege('authenticated', 'public.favorites', 'UPDATE') then
    raise exception 'BAŞARISIZ: favori satiri guncellenebiliyor; kayit fiyati ezilebilir';
  end if;
  raise notice '✓ favori satiri guncellenemiyor (kayit fiyati sabit)';
end $$;

reset role;
rollback;
