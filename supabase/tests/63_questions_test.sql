-- ============================================================================
-- ÜRÜN SORU-CEVAP
-- ============================================================================
begin;

\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'soran@ornek.com', '{"full_name":"Soran"}'::jsonb),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'yabanci@ornek.com', '{"full_name":"Yabanci"}'::jsonb)
on conflict (id) do nothing;

-- Teknomarkt'ın sattığı bir ürünün grubu seçilir: cevaplama yetkisi tam da
-- "o grupta onaylı mağazası olmak" demek.
do $$
declare v_grup uuid;
begin
  select p.group_id into v_grup
    from public.products p
   where p.vendor_id = 'a0000000-0000-4000-8000-00000000000a'
     and p.group_id is not null
   limit 1;
  if v_grup is null then
    raise exception 'BAŞARISIZ: Teknomarkt urunu bulunamadi';
  end if;
  perform set_config('ohaaaa.q_group', v_grup::text, true);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';

do $$
declare
  v_grup uuid := current_setting('ohaaaa.q_group')::uuid;
  v_soru uuid;
begin
  -- 1) Satin almadan soru sorulabiliyor (yorumdan farki bu)
  insert into public.product_questions (group_id, user_id, body)
  values (v_grup, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'Kutunun icinde sarj aleti var mi?')
  returning id into v_soru;
  perform set_config('ohaaaa.q_id', v_soru::text, true);
  raise notice '✓ satin almadan soru sorulabiliyor';

  -- 2) Cok kisa soru reddedilir
  begin
    insert into public.product_questions (group_id, user_id, body)
    values (v_grup, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'kisa');
    raise exception 'BAŞARISIZ: cok kisa soru kabul edildi';
  exception when check_violation then
    raise notice '✓ cok kisa soru reddediliyor';
  end;

  -- 3) Soruyu soran KENDI cevabini yazamaz: satici agzindan konusamamali
  update public.product_questions
     set answer = 'Evet var, kutuda hediye sarj aleti geliyor!'
   where id = v_soru;

  if (select answer from public.product_questions where id = v_soru) is not null then
    raise exception 'BAŞARISIZ: soruyu soran satici cevabi yazabildi';
  end if;
  raise notice '✓ soran kisi satici cevabi yazamiyor';

  -- 4) Kendi sorusunu gizleyip moderasyonu atlatamaz
  update public.product_questions set is_hidden = true where id = v_soru;
  if (select is_hidden from public.product_questions where id = v_soru) then
    raise exception 'BAŞARISIZ: kullanici gizleme bayragini degistirebildi';
  end if;
  raise notice '✓ gizleme bayragi istemciden degistirilemiyor';
end $$;

-- 5) O urunu SATMAYAN biri cevaplayamaz
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';

do $$
declare v_soru uuid := current_setting('ohaaaa.q_id')::uuid;
begin
  if public.can_answer_question(current_setting('ohaaaa.q_group')::uuid) then
    raise exception 'BAŞARISIZ: alakasiz kullanici cevaplama yetkisi aliyor';
  end if;

  update public.product_questions set answer = 'Yanlis bilgi' where id = v_soru;
  if (select answer from public.product_questions where id = v_soru) is not null then
    raise exception 'BAŞARISIZ: alakasiz kullanici cevap yazabildi';
  end if;
  raise notice '✓ urunu satmayan cevaplayamiyor';
end $$;

-- 6) O urunu SATAN magaza sahibi cevaplayabiliyor (olumlu kontrol)
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  v_soru uuid := current_setting('ohaaaa.q_id')::uuid;
  v_cevap text;
  v_zaman timestamptz;
begin
  if not public.can_answer_question(current_setting('ohaaaa.q_group')::uuid) then
    raise exception 'BAŞARISIZ: urunu satan magaza cevaplama yetkisi alamiyor';
  end if;

  update public.product_questions
     set answer = 'Kutuda sarj aleti bulunmuyor, ayri satiliyor.',
         answered_by = '22222222-2222-4222-8222-222222222222',
         answer_vendor_id = 'a0000000-0000-4000-8000-00000000000a'
   where id = v_soru;

  select answer, answered_at into v_cevap, v_zaman
    from public.product_questions where id = v_soru;

  if v_cevap is null then
    raise exception 'BAŞARISIZ: yetkili satici cevap yazamadi';
  end if;
  raise notice '✓ urunu satan magaza cevaplayabiliyor';

  -- 7) Cevap zamanini SUNUCU koyar, istemci degil
  if v_zaman is null then
    raise exception 'BAŞARISIZ: cevap zamani yazilmadi';
  end if;
  raise notice '✓ cevap zamani sunucuda konuluyor';
end $$;

-- 8) Cevaplanan sorunun METNI artik degistirilemez: cevabi baska bir soruya
--    ait gostermek mumkun olmamali
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';

do $$
declare v_soru uuid := current_setting('ohaaaa.q_id')::uuid;
begin
  update public.product_questions set body = 'Tamamen baska bir soru mu?' where id = v_soru;
  if (select body from public.product_questions where id = v_soru)
     <> 'Kutunun icinde sarj aleti var mi?' then
    raise exception 'BAŞARISIZ: cevaplanmis sorunun metni degistirilebildi';
  end if;
  raise notice '✓ cevaplanmis sorunun metni sabit';
end $$;

-- 9) anon soru soramaz ama okuyabilir
reset role;
set local role anon;

do $$
begin
  if not exists (select 1 from public.product_questions
                  where id = current_setting('ohaaaa.q_id')::uuid) then
    raise exception 'BAŞARISIZ: anon yayindaki soruyu goremiyor';
  end if;
  raise notice '✓ anon soruyu okuyabiliyor';

  begin
    insert into public.product_questions (group_id, user_id, body)
    values (current_setting('ohaaaa.q_group')::uuid,
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Anonim soru denemesi burada');
    raise exception 'BAŞARISIZ: anon soru sorabildi';
  exception when insufficient_privilege then
    raise notice '✓ anon soru soramiyor';
  end;
end $$;

reset role;
rollback;
