-- TEST · Satıcı ihlal puanı — sözleşmedeki tablo ve kademeler
\set ON_ERROR_STOP on
begin;

do $$
declare
  v uuid; r jsonb; s int; t text; n int;
begin
  select id into v from public.vendors where slug = 'teknomarkt';

  -- 1) Puan KURALDAN okunuyor, cagirandan degil
  r := public.record_violation(v, 'kargo_gecikmesi');
  if (r ->> 'points')::int <> 5 then
    raise exception 'BASARISIZ: kargo gecikmesi 5 puan olmali, % geldi', r ->> 'points';
  end if;
  raise notice '✓ puan kural tablosundan okunuyor (kargo gecikmesi = 5)';

  -- 2) Tanimsiz kod REDDEDILIYOR
  begin
    perform public.record_violation(v, 'olmayan_kural');
    raise exception 'BASARISIZ: tanimsiz kural kabul edildi';
  exception when invalid_parameter_value then
    raise notice '✓ tanimsiz ihlal kodu reddediliyor';
  end;

  -- 3) 50 puan -> siralamada geride
  perform public.record_violation(v, 'iade_reddi');   -- +25 = 30
  perform public.record_violation(v, 'sahte_takip');  -- +50 = 80
  s := public.vendor_violation_score(v);
  t := public.vendor_violation_tier(v);
  if s <> 80 or t <> 'siparis_durduruldu' then
    raise exception 'BASARISIZ: 80 puanda kademe yanlis (% / %)', s, t;
  end if;
  raise notice '✓ 80 puan -> siparis akisi durduruldu';

  -- 4) 100 puan -> magaza KAPANIR ve urunler iner
  perform public.record_violation(v, 'ambalaj_ihlali');  -- +10 = 90
  perform public.record_violation(v, 'stok_iptali');     -- +10 = 100
  if public.vendor_violation_tier(v) <> 'kapali' then
    raise exception 'BASARISIZ: 100 puanda magaza kapanmadi';
  end if;
  if (select status from public.vendors where id = v) <> 'suspended' then
    raise exception 'BASARISIZ: magaza durumu askiya alinmadi';
  end if;
  select count(*) into n from public.products where vendor_id = v and status = 'active';
  if n <> 0 then
    raise exception 'BASARISIZ: kapali magazanin % urunu hala vitrinde', n;
  end if;
  raise notice '✓ 100 puan -> magaza askiya alindi, urunler vitrinden indi';

  -- 5) Suresi dolan puan DUSER (12 ay)
  update public.vendor_violations set expires_at = now() - interval '1 day'
   where vendor_id = v and rule_code = 'sahte_takip';
  if public.vendor_violation_score(v) <> 50 then
    raise exception 'BASARISIZ: suresi dolan puan dusmedi (%)', public.vendor_violation_score(v);
  end if;
  raise notice '✓ suresi dolan puan yururlukten dusuyor';

  -- 6) Itirazla kaldirilan puan DUSER ama KAYIT KALIR (denetim izi)
  update public.vendor_violations set waived_at = now(), waive_reason = 'itiraz kabul'
   where vendor_id = v and rule_code = 'iade_reddi';
  if public.vendor_violation_score(v) <> 25 then
    raise exception 'BASARISIZ: kaldirilan puan dusmedi (%)', public.vendor_violation_score(v);
  end if;
  select count(*) into n from public.vendor_violations
   where vendor_id = v and rule_code = 'iade_reddi';
  if n <> 1 then
    raise exception 'BASARISIZ: kaldirilan ihlal kaydi silinmis';
  end if;
  raise notice '✓ itirazla kaldirilan puan duser, kayit denetim izi olarak kalir';

  -- 7) Kural tablosu sozlesmedeki YEDI ihlali iceriyor
  select count(*) into n from public.violation_rules;
  if n <> 7 then
    raise exception 'BASARISIZ: kural sayisi 7 olmali, % var', n;
  end if;
  if (select points from public.violation_rules where code = 'taklit_urun') <> 100 then
    raise exception 'BASARISIZ: taklit urun puani sozlesmeyle ayrismis';
  end if;
  raise notice '✓ kural tablosu sozlesmeyle birebir (7 ihlal, taklit = 100)';

  -- 8) Ceza puani DISARIYA acik olmamali
  --
  -- Bu iddia bir hatanin ardindan yazildi: ihlal gocu fonksiyonlari
  -- `grant ... to authenticated, service_role` ile aciyordu ama PostgreSQL'in
  -- yeni fonksiyona verdigi PUBLIC yetkisini kaldirmiyordu. Sonuc: oturum
  -- acmadan `/rest/v1/rpc/vendor_violation_score` cagrilabiliyor ve herhangi
  -- bir saticinin ceza puani okunabiliyordu. SECURITY DEFINER oldugu icin RLS
  -- de korumuyordu.
  --
  -- Puan, saticinin ticari itibarina iliskin bir veri; acik olmamali.
  if has_function_privilege('anon', 'public.vendor_violation_score(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.vendor_violation_score(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.vendor_violation_tier(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.vendor_violation_tier(uuid)', 'EXECUTE') then
    raise exception 'BASARISIZ: ceza puani istemci rolunden okunabiliyor';
  end if;
  raise notice '✓ ceza puani istemciye kapali (anon ve authenticated calistiramaz)';
end $$;

rollback;
