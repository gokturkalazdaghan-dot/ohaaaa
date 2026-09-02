-- ============================================================================
-- SATICI BELGELERİ
-- ============================================================================
begin;

\set ON_ERROR_STOP on

-- Teknomarkt sahibi (vendor), alakasiz bir satici (Moda Vitrin) ve yonetici
-- zaten tohum verisinde var.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare v_belge uuid;
begin
  -- 1) Satici KENDI magazasi icin belge kaydi acabiliyor
  insert into public.vendor_documents
    (vendor_id, uploaded_by, doc_type, storage_path, file_name)
  values ('a0000000-0000-4000-8000-00000000000a',
          '22222222-2222-4222-8222-222222222222',
          'vergi_levhasi',
          '22222222-2222-4222-8222-222222222222/vergi-levhasi.pdf',
          'vergi-levhasi.pdf')
  returning id into v_belge;
  perform set_config('ohaaaa.belge', v_belge::text, true);
  raise notice '✓ satici kendi belgesini kaydedebiliyor';

  -- 2) Yeni belge PENDING baslar: kendini dogrulanmis ilan edemez
  if (select status from public.vendor_documents where id = v_belge) <> 'pending' then
    raise exception 'BAŞARISIZ: belge onayli baslamis';
  end if;
  raise notice '✓ belge incelenmeyi bekleyerek basliyor';

  -- 3) Satici kendi belgesini ONAYLAYAMAZ
  update public.vendor_documents
     set status = 'approved', review_note = 'kendim onayladim'
   where id = v_belge;

  if (select status from public.vendor_documents where id = v_belge) <> 'pending' then
    raise exception 'BAŞARISIZ: satici kendi belgesini onaylayabildi';
  end if;
  if (select review_note from public.vendor_documents where id = v_belge) is not null then
    raise exception 'BAŞARISIZ: satici inceleme notu yazabildi';
  end if;
  raise notice '✓ satici kendi belgesini onaylayamiyor';

  -- 4) Dosya yolu sabit: onayi baska bir dosyaya tasimak mumkun olmamali
  update public.vendor_documents
     set storage_path = '22222222-2222-4222-8222-222222222222/baska.pdf'
   where id = v_belge;
  if (select storage_path from public.vendor_documents where id = v_belge)
     <> '22222222-2222-4222-8222-222222222222/vergi-levhasi.pdf' then
    raise exception 'BAŞARISIZ: belge yolu degistirilebildi';
  end if;
  raise notice '✓ belge yolu sabit';
end $$;

-- 5) BASKA bir satici bu belgeyi goremez ve kendi adina baskasinin
--    magazasina belge yukleyemez
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

do $$
declare n int;
begin
  select count(*) into n from public.vendor_documents
   where vendor_id = 'a0000000-0000-4000-8000-00000000000a';
  if n <> 0 then
    raise exception 'BAŞARISIZ: baska saticinin belgesi okunabiliyor (% satir)', n;
  end if;
  raise notice '✓ belge baska saticiya sizmiyor';

  begin
    insert into public.vendor_documents
      (vendor_id, uploaded_by, doc_type, storage_path, file_name)
    values ('a0000000-0000-4000-8000-00000000000a',
            '33333333-3333-4333-8333-333333333333',
            'kimlik', '33333333-3333-4333-8333-333333333333/sahte.pdf', 'sahte.pdf');
    raise exception 'BAŞARISIZ: baskasinin magazasina belge yuklendi';
  exception when insufficient_privilege then
    raise notice '✓ baskasinin magazasina belge yuklenemiyor';
  end;
end $$;

-- 6) Yonetici onaylayabiliyor ve inceleme zamani SUNUCUDA konuyor
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  v_belge uuid := current_setting('ohaaaa.belge')::uuid;
  v_durum text;
  v_zaman timestamptz;
begin
  update public.vendor_documents
     set status = 'approved',
         review_note = 'Vergi levhasi gecerli',
         reviewed_by = '11111111-1111-4111-8111-111111111111'
   where id = v_belge;

  select status, reviewed_at into v_durum, v_zaman
    from public.vendor_documents where id = v_belge;

  if v_durum <> 'approved' then
    raise exception 'BAŞARISIZ: yonetici belgeyi onaylayamadi';
  end if;
  if v_zaman is null then
    raise exception 'BAŞARISIZ: inceleme zamani yazilmadi';
  end if;
  raise notice '✓ yonetici onaylayabiliyor, inceleme zamani sunucuda konuyor';
end $$;

-- 7) Onaylanmis belge satici tarafindan SILINEMEZ: onay kaydinin izi kalmali
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  v_belge uuid := current_setting('ohaaaa.belge')::uuid;
  n int;
begin
  delete from public.vendor_documents where id = v_belge;
  select count(*) into n from public.vendor_documents where id = v_belge;
  if n <> 1 then
    raise exception 'BAŞARISIZ: onaylanmis belge silinebildi';
  end if;
  raise notice '✓ onaylanmis belge satici tarafindan silinemiyor';
end $$;

-- 8) anon hicbir belgeyi goremez
reset role;
set local role anon;

do $$
begin
  if has_table_privilege('anon', 'public.vendor_documents', 'SELECT') then
    raise exception 'BAŞARISIZ: anon belge tablosunu okuyabiliyor';
  end if;
  raise notice '✓ anon belge tablosuna erisemiyor';
end $$;

reset role;
rollback;
