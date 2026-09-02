-- ============================================================================
-- ADRES DEFTERİ
-- ============================================================================
begin;

\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('77777777-7777-4777-8777-777777777777', 'adres-a@ornek.com', '{"full_name":"Adres A"}'::jsonb),
  ('88888888-8888-4888-8888-888888888888', 'adres-b@ornek.com', '{"full_name":"Adres B"}'::jsonb)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';

do $$
declare
  v_ev  uuid;
  v_is  uuid;
  n     int;
begin
  -- 1) Adres eklenebiliyor
  insert into public.addresses
    (user_id, label, full_name, phone, city, district, address_line, is_default)
  values ('77777777-7777-4777-8777-777777777777', 'Ev', 'Adres A', '05001112233',
          'İstanbul', 'Kadıköy', 'Caferağa Mah. Örnek Sk. No:1 D:2', true)
  returning id into v_ev;
  raise notice '✓ adres eklenebiliyor';

  -- 2) İkinci adres varsayılan yapılınca birincisi bırakır
  --    (kısmi benzersiz dizin reddetseydi kullanıcı hata alırdı; doğru
  --     davranış devretmek)
  insert into public.addresses
    (user_id, label, full_name, phone, city, district, address_line, is_default)
  values ('77777777-7777-4777-8777-777777777777', 'İş', 'Adres A', '05001112233',
          'İstanbul', 'Şişli', 'Mecidiyeköy Mah. Deneme Cad. No:5', true)
  returning id into v_is;

  if (select is_default from public.addresses where id = v_ev) then
    raise exception 'BAŞARISIZ: eski varsayılan hâlâ varsayılan';
  end if;
  if not (select is_default from public.addresses where id = v_is) then
    raise exception 'BAŞARISIZ: yeni adres varsayılan olmadı';
  end if;
  raise notice '✓ varsayilan devrediliyor, ikinci varsayilan reddedilmiyor';

  -- 3) Kullanıcı başına tek varsayılan
  select count(*) into n from public.addresses
   where user_id = '77777777-7777-4777-8777-777777777777' and is_default;
  if n <> 1 then
    raise exception 'BAŞARISIZ: % adet varsayilan var, 1 olmali', n;
  end if;
  raise notice '✓ kullanici basina tek varsayilan';

  -- 4) Eksik/kısa açık adres reddedilir: "ev" diye bir adrese kargo gitmez
  begin
    insert into public.addresses
      (user_id, full_name, phone, city, district, address_line)
    values ('77777777-7777-4777-8777-777777777777', 'Adres A', '05001112233',
            'İzmir', 'Konak', 'kısa');
    raise exception 'BAŞARISIZ: gecersiz acik adres kabul edildi';
  exception when check_violation then
    raise notice '✓ gecersiz acik adres reddediliyor';
  end;
end $$;

-- 5) BAŞKA kullanıcı bu adresleri göremez ve yazamaz
set local request.jwt.claims = '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}';

do $$
declare n int;
begin
  select count(*) into n from public.addresses
   where user_id = '77777777-7777-4777-8777-777777777777';
  if n <> 0 then
    raise exception 'BAŞARISIZ: baskasinin adresi okunabiliyor (% satir)', n;
  end if;
  raise notice '✓ adres baska kullaniciya sizmiyor';

  -- Başkasının adına adres yazmak da engellenmeli: aksi hâlde biri, başka
  -- bir hesabın varsayılan adresini kendi eline değiştirebilirdi.
  begin
    insert into public.addresses
      (user_id, full_name, phone, city, district, address_line)
    values ('77777777-7777-4777-8777-777777777777', 'Saldirgan', '05000000000',
            'Ankara', 'Cankaya', 'Baskasinin adina yazilan adres satiri');
    raise exception 'BAŞARISIZ: baskasinin adina adres yazilabildi';
  exception when insufficient_privilege then
    raise notice '✓ baskasinin adina adres yazilamiyor';
  end;
end $$;

-- 6) Kendi adresini ekleyebiliyor: olumlu kontrol. Bu olmadan, her yazmayı
--    reddeden bozuk bir politika da yukarıdaki iddiaları geçerdi.
do $$
begin
  insert into public.addresses
    (user_id, full_name, phone, city, district, address_line)
  values ('88888888-8888-4888-8888-888888888888', 'Adres B', '05009998877',
          'Ankara', 'Çankaya', 'Kızılay Mah. Deneme Cad. No:7 D:3');
  raise notice '✓ kullanici KENDI adresini ekleyebiliyor';
end $$;

reset role;
rollback;
