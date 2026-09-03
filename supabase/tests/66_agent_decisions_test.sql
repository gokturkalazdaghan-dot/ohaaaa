-- ============================================================================
-- AJAN KARARLARI
-- ============================================================================
begin;

\set ON_ERROR_STOP on

do $$
declare
  v_id uuid;
  n bigint; m bigint; oran numeric;
begin
  -- 1) Karar kaydedilebiliyor; sonuc BOS baslar
  insert into public.agent_decisions
    (agent, model, prompt_version, input_digest, decision, confidence, evidence, expected_outcome)
  values ('search_intent', 'claude-opus-5', 'v1',
          '5 bin liraya kadar oyuncu kulakligi',
          '{"query":"oyuncu kulakligi","maxPriceTl":5000}'::jsonb,
          0.870,
          '{"kaynak":"yapisal_cikti"}'::jsonb,
          '{"sonuc_bekleniyor":true}'::jsonb)
  returning id into v_id;

  if (select actual_outcome from public.agent_decisions where id = v_id) is not null then
    raise exception 'BAŞARISIZ: gerçeklesen sonuc karar aninda dolu';
  end if;
  raise notice '✓ karar kaydediliyor, gerceklesen sonuc bos basliyor';

  -- 2) Guven 0-1 disina cikamaz: sahte guven sema seviyesinde engelli
  begin
    insert into public.agent_decisions
      (agent, model, prompt_version, input_digest, decision, confidence)
    values ('search_intent', 'x', 'v1', 'a', '{}'::jsonb, 1.5);
    raise exception 'BAŞARISIZ: 1 ustu guven kabul edildi';
  exception when check_violation then
    raise notice '✓ guven araligi zorlaniyor';
  end;

  -- 3) Guven NULL olabilir: olcemedigimiz guveni uydurmak yasak
  insert into public.agent_decisions
    (agent, model, prompt_version, input_digest, decision, confidence)
  values ('visual_search', 'x', 'v1', 'foto', '{}'::jsonb, null);
  raise notice '✓ olculemeyen guven NULL birakilabiliyor';

  -- 4) OLCUM YOKKEN dogruluk orani NULL doner -- sifir DEGIL.
  --    Sifir yazmak "hepsi basarisiz" demek olurdu; olculmemis ile
  --    basarisiz ayni sey degil.
  select decisions_total, decisions_measured, success_rate
    into n, m, oran
    from public.agent_accuracy('search_intent', 30);

  if n < 1 then raise exception 'BAŞARISIZ: karar sayilmadi'; end if;
  if m <> 0 then raise exception 'BAŞARISIZ: olculmemis karar olculmus sayildi'; end if;
  if oran is not null then
    raise exception 'BAŞARISIZ: olcum yokken dogruluk orani uretildi (%)', oran;
  end if;
  raise notice '✓ olcum yokken dogruluk orani NULL (uydurulmuyor)';

  -- 5) Sonuc yazilinca oran GERCEK sayimdan cikar
  update public.agent_decisions
     set actual_outcome = '{"success":true,"sonuc_sayisi":12}'::jsonb,
         measured_at = now()
   where id = v_id;

  select decisions_measured, success_rate into m, oran
    from public.agent_accuracy('search_intent', 30);

  if m <> 1 then raise exception 'BAŞARISIZ: olculen karar sayilmadi'; end if;
  if oran <> 1.0 then raise exception 'BAŞARISIZ: oran yanlis (%)', oran; end if;
  raise notice '✓ oran gercek sayimdan cikiyor';
end $$;

-- 6) Karar kaydi ISTEMCIDEN yazilamaz: ajanin performans kaydi, olctugu kisi
--    tarafindan doldurulabilir olsaydi "basari orani" istemcinin gonderdigi
--    sayiya donerdi.
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

do $$
begin
  if has_table_privilege('authenticated', 'public.agent_decisions', 'INSERT')
     or has_table_privilege('authenticated', 'public.agent_decisions', 'UPDATE') then
    raise exception 'BAŞARISIZ: istemci ajan kaydina yazabiliyor';
  end if;
  raise notice '✓ ajan kaydi istemciden yazilamiyor';

  -- Okuma da yalnizca yoneticiye acik (RLS).
  if exists (select 1 from public.agent_decisions) then
    raise exception 'BAŞARISIZ: siradan kullanici ajan kararlarini okuyabiliyor';
  end if;
  raise notice '✓ ajan kararlari siradan kullaniciya kapali';
end $$;

-- 7) Dogruluk fonksiyonu istemciye kapali: kisisel arama metinlerini ozetler.
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.agent_accuracy(public.agent_kind,int)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.agent_accuracy(public.agent_kind,int)', 'EXECUTE') then
    raise exception 'BAŞARISIZ: dogruluk ozeti istemciden cagrilabiliyor';
  end if;
  raise notice '✓ dogruluk ozeti yalnizca sunucudan';
end $$;

rollback;
