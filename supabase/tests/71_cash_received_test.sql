-- ============================================================================
-- TAHSİLAT DEFTERİ — "ağ ödedim dedi" ile "para geldi" karışıyor mu?
-- ----------------------------------------------------------------------------
-- Bu dosyanın tek işi şunu kanıtlamak: sistem, tahsil edilmemiş bir tutarı
-- hiçbir yoldan tahsil edilmiş gibi gösteremiyor.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data)
values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'kasa@ornek.com', '{"full_name":"Kasa"}'::jsonb)
on conflict (id) do nothing;

do $$
declare
  v_magaza uuid;
  v_odeme  uuid;
  v_donusum uuid;
  r record;
begin
  -- Yönetici kimliğiyle çalışıyoruz: revenue_summary yönetici ister.
  update public.users set role = 'admin' where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  perform set_config('request.jwt.claims',
    '{"sub":"ffffffff-ffff-4fff-8fff-ffffffffffff","role":"authenticated"}', true);

  insert into public.merchants (slug, display_name, homepage_url, status, deeplink_template,
                                terms_verified_at, country_code)
  values ('kasa-test-magaza', 'Kasa Test', 'https://kasa.example', 'active',
          '{url}?tag={tracking_id}&sub={subid}', now(), 'TR')
  returning id into v_magaza;

  ---------------------------------------------------------------------------
  -- 1) KANITSIZ "TAHSİL EDİLDİ" ŞEMADA ENGELLİ
  --    Referans, tarih ve mutabakat zamanı olmadan bir ödeme tahsil edilmiş
  --    sayılamaz. Bu kontrol arayüzde olsaydı unutulabilirdi.
  ---------------------------------------------------------------------------
  begin
    insert into public.payouts
      (merchant_id, period_start, period_end, currency, expected_cents, status)
    values (v_magaza, '2026-08-01', '2026-08-31', 'TRY', 500000, 'tahsil_edildi');
    raise exception 'BAŞARISIZ: kanitsiz tahsilat kabul edildi';
  exception when check_violation then
    raise notice '✓ kanitsiz "tahsil edildi" semada engelli';
  end;

  ---------------------------------------------------------------------------
  -- 2) BEYAN TAHSİLAT DEĞİLDİR
  --    Ağ hesap özetini gönderdi (declared dolu) ama para gelmedi.
  --    Özet, received olarak SIFIR göstermeli.
  ---------------------------------------------------------------------------
  insert into public.payouts
    (merchant_id, period_start, period_end, currency,
     expected_cents, declared_cents, status)
  values (v_magaza, '2026-08-01', '2026-08-31', 'TRY', 500000, 480000, 'beyan_edildi')
  returning id into v_odeme;

  select * into r from public.revenue_summary(3650) where currency = 'TRY';

  if r.declared_cents <> 480000 then
    raise exception 'BAŞARISIZ: beyan edilen tutar ozete girmedi (%)', r.declared_cents;
  end if;
  if r.received_cents <> 0 then
    raise exception 'BAŞARISIZ: beyan, tahsilat gibi sayildi (%)', r.received_cents;
  end if;
  if r.received_payouts <> 0 then
    raise exception 'BAŞARISIZ: tahsil edilmemis odeme sayildi';
  end if;
  raise notice '✓ agin beyani tahsilat sayilmiyor';

  ---------------------------------------------------------------------------
  -- 3) KANIT GİRİLİNCE TAHSİLAT SAYILIR — VE EKSİK ÖDEME GÖRÜNÜR KALIR
  --    Ağ 480.000 beyan etti, 450.000 gönderdi. Fark kaybolmamalı.
  ---------------------------------------------------------------------------
  update public.payouts
     set received_cents = 450000,
         payment_provider = 'havale',
         payment_reference = 'TR-2026-08-0001',
         payment_date = '2026-09-05',
         reconciled_by = 'ffffffff-ffff-4fff-8fff-ffffffffffff',
         reconciled_at = now(),
         status = 'tahsil_edildi'
   where id = v_odeme;

  select * into r from public.revenue_summary(3650) where currency = 'TRY';

  if r.received_cents <> 450000 then
    raise exception 'BAŞARISIZ: tahsil edilen tutar yanlis (%)', r.received_cents;
  end if;
  if r.declared_cents <> 480000 then
    raise exception 'BAŞARISIZ: beyan tahsilatla ezildi (%)', r.declared_cents;
  end if;
  if r.declared_cents - r.received_cents <> 30000 then
    raise exception 'BAŞARISIZ: eksik odeme farki kayboldu';
  end if;
  raise notice '✓ tahsilat ve beyan ayri duruyor; eksik odeme farki gorunur';

  ---------------------------------------------------------------------------
  -- 4) MUTABAKAT KANITI GERİ ALINAMAZ (durum tutarlı kalmalı)
  ---------------------------------------------------------------------------
  begin
    update public.payouts set payment_reference = null where id = v_odeme;
    raise exception 'BAŞARISIZ: tahsil edilmis odemenin kaniti silinebildi';
  exception when check_violation then
    raise notice '✓ tahsilat kaniti silinemiyor';
  end;

  ---------------------------------------------------------------------------
  -- 5) BİR DÖNÜŞÜM İKİ ÖDEMEYE GİREMEZ
  --    Girseydi aynı komisyon iki kez tahsil edilmiş sayılırdı.
  ---------------------------------------------------------------------------
  insert into public.conversions
    (merchant_id, network_order_id, status, currency,
     order_total_cents, commission_cents)
  values (v_magaza, 'AG-SIPARIS-1', 'approved', 'TRY', 1000000, 30000)
  returning id into v_donusum;

  insert into public.payout_conversions (payout_id, conversion_id, commission_cents)
  values (v_odeme, v_donusum, 30000);

  insert into public.payouts
    (merchant_id, period_start, period_end, currency, expected_cents, status)
  values (v_magaza, '2026-09-01', '2026-09-30', 'TRY', 0, 'beklemede');

  begin
    insert into public.payout_conversions (payout_id, conversion_id, commission_cents)
    select id, v_donusum, 30000 from public.payouts
     where merchant_id = v_magaza and period_start = '2026-09-01';
    raise exception 'BAŞARISIZ: ayni donusum ikinci odemeye de girdi';
  exception when unique_violation then
    raise notice '✓ bir donusum yalnizca bir odemeye girebiliyor';
  end;

  ---------------------------------------------------------------------------
  -- 6) GMV GELİR DEĞİLDİR — ayrı sütunlarda duruyorlar
  ---------------------------------------------------------------------------
  select * into r from public.revenue_summary(3650) where currency = 'TRY';
  if r.gmv_cents <> 1000000 then
    raise exception 'BAŞARISIZ: ciro yanlis (%)', r.gmv_cents;
  end if;
  if r.gmv_cents = r.received_cents then
    raise exception 'BAŞARISIZ: ciro ile tahsilat ayni sayi olarak dondu';
  end if;
  if r.approved_cents <> 30000 then
    raise exception 'BAŞARISIZ: onayli komisyon yanlis (%)', r.approved_cents;
  end if;
  raise notice '✓ ciro, onayli komisyon ve tahsilat ayri kalemler';

  ---------------------------------------------------------------------------
  -- 7) PARA BİRİMLERİ TOPLANMIYOR
  --    Kur kaynağı olmadan TRY ile EUR'yu toplamak uydurma sayı üretir.
  ---------------------------------------------------------------------------
  insert into public.conversions
    (merchant_id, network_order_id, status, currency,
     order_total_cents, commission_cents)
  values (v_magaza, 'AG-SIPARIS-2', 'approved', 'EUR', 200000, 6000);

  if (select count(*) from public.revenue_summary(3650)) < 2 then
    raise exception 'BAŞARISIZ: para birimleri tek satirda toplandi';
  end if;

  select * into r from public.revenue_summary(3650) where currency = 'EUR';
  if r.approved_cents <> 6000 then
    raise exception 'BAŞARISIZ: EUR kalemi yanlis (%)', r.approved_cents;
  end if;
  raise notice '✓ para birimleri ayri satirlarda, toplanmiyor';
end $$;

-- ---------------------------------------------------------------------------
-- Tahsilat defteri istemciye kapalı
-- ---------------------------------------------------------------------------
-- Bu tablo şirketin kasa defteri; sıradan kullanıcının görmesi için sebep yok.
do $$
begin
  if has_table_privilege('anon', 'public.payouts', 'SELECT') then
    raise exception 'BAŞARISIZ: anon tahsilat defterini gorebiliyor';
  end if;
  if has_table_privilege('authenticated', 'public.payouts', 'INSERT') then
    raise exception 'BAŞARISIZ: siradan kullanici odeme kaydi acabiliyor';
  end if;
  if has_function_privilege('anon', 'public.revenue_summary(integer)', 'execute') then
    raise exception 'BAŞARISIZ: anon gelir ozetini cagirabiliyor';
  end if;
  raise notice '✓ tahsilat defteri istemciye kapali';
end $$;

rollback;
