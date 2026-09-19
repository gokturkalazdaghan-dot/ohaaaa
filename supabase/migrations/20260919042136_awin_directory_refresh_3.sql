-- Awin reklamveren dizini (3. dosya) — 47 satir okundu, 4'u YENI.
--
-- 43 satir ZATEN KAYITLI ve bu goce HIC ALINMADI. Onceki iki tazelemede
-- olculen degerleri yeniden yazmak, ayni veriyi ucuncu kez uretime
-- tasimak olurdu; fark yoksa yazma da yok.
--
-- Dizinde OLMAYAN ama uretimde duran 2 program (119629 PURTY BODY,
-- 129553 Jumy Bee) SILINMEDI. Bir satirin bu dosyada gorunmemesi
-- "program kapandi" demek degil -- dizin dokumu filtreli cekilmis
-- olabilir. Yoklugu kanit saymak, calisan bir programi sessizce
-- kaybetmek olurdu.
--
-- ---------------------------------------------------------------------
-- EPC: DORDU DE OLCULMUS
-- ---------------------------------------------------------------------
-- Onceki tazelemede conversionRate bos olan satirlarda EPC "0.00"
-- yaziyordu ve bu OLCULMEMIS demekti, "kazanc yok" degil. Bu dortte
-- conversionRate dolu (29.17 / 11.49 / 11.00 / 2.81), yani EPC gercek
-- bir olcum ve oldugu gibi yaziliyor.
--
-- KOMISYON: dizin commissionMax'i cogunlukla 0 veriyor (yayinlanmamis).
-- 0 GECERLI bir orandir, bu yuzden 0 -> NULL. Yalnizca CBD Armour'un
-- gercekten yayinlanmis %20 orani yaziliyor.
--
-- ---------------------------------------------------------------------
-- 17948 CBD ARMOUR — HUKUKI KISIT, INSAN ONAYI GEREKIR
-- ---------------------------------------------------------------------
-- Kenevir turevi (CBD) satiyor. Turkiye'de kenevir turevleri KONTROLLU
-- madde; bu programin vitrine cikarilmasi teknik degil HUKUKI bir karar
-- ve bu karari bir gocun vermesi dogru olmaz.
--
-- Silmiyoruz da: dizin kaydi, "bu program var ve su sebeple beklemede"
-- bilgisini tasiyan tek yer. Silinseydi bir sonraki dizin cekiminde
-- hicbir uyari olmadan yeniden kesfedilir ve gecmisi bilinmeden
-- degerlendirilirdi.
--
-- `raw.yasal_kisit` alani bu yuzden var: ACTIVE'e tasimayi dusunen
-- herkes onu gorur.
--
-- Dordu de DISCOVERED. Hicbiri ACTIVE degil: teknik entegrasyon ve
-- sozlesme dogrulamasi olmadan bir program yayina alinamaz.
with v(np_id, ad, url, ulke, komisyon, cerez, feed, epc, ham) as (values
  ('104973','Adore Lenses Portugal','https://adorelenses.com/es/','PT',
   null, 30, false, 28,
   '{"primarySector": "Health & Beauty", "approvalRate": 100.0, "awinIndex": 79.6949, "kaynak": "awin-advertiser-directory-3"}'),

  ('118951','MyPetDMV - The original Pet Drivers License','https://www.mypetdmv.com/','US',
   null, 30, false, 33,
   '{"primarySector": "Pets & Pet Care", "approvalRate": 100.0, "awinIndex": 75.0328, "kaynak": "awin-advertiser-directory-3"}'),

  ('17948','CBD Armour','https://cbdarmour.co.uk/','GB',
   0.20, 365, true, 151,
   '{"primarySector": "Health & Beauty", "approvalRate": 100.0, "awinIndex": 85.1508, "kaynak": "awin-advertiser-directory-3", "yasal_kisit": "CBD/kenevir turevi. Turkiye mevzuatinda kontrollu madde. ACTIVE yapilmadan once INSAN ONAYI ve hukuki degerlendirme zorunlu."}'),

  ('88751','PandaHall','https://www.pandahall.com','US',
   null, 30, true, 12,
   '{"primarySector": "Clothing Accessories", "approvalRate": 99.56, "awinIndex": 53.6217, "kaynak": "awin-advertiser-directory-3"}')
)
insert into public.programs
  (network, network_program_id, merchant_name, homepage_url, country_code,
   commission_rate, cookie_window_days, feed_available, epc_cents,
   application_state, last_verified_at, raw)
select 'awin', v.np_id, v.ad, v.url, v.ulke::char(2),
       v.komisyon::numeric, v.cerez::int, v.feed::boolean, v.epc::bigint,
       'DISCOVERED'::public.program_application_state, now(), v.ham::jsonb
  from v
on conflict (network, network_program_id) do update
  set merchant_name      = excluded.merchant_name,
      homepage_url       = coalesce(excluded.homepage_url, public.programs.homepage_url),
      country_code       = coalesce(excluded.country_code, public.programs.country_code),
      commission_rate    = coalesce(excluded.commission_rate, public.programs.commission_rate),
      cookie_window_days = coalesce(excluded.cookie_window_days, public.programs.cookie_window_days),
      feed_available     = excluded.feed_available,
      epc_cents          = coalesce(excluded.epc_cents, public.programs.epc_cents),
      last_verified_at   = now(),
      raw                = coalesce(public.programs.raw, '{}'::jsonb) || excluded.raw;

do $$
declare v_toplam int; v_yeni int; v_aktif int; v_kisitli int;
begin
  select count(*) into v_toplam from public.programs where network = 'awin';
  select count(*) into v_yeni   from public.programs
   where network = 'awin' and raw->>'kaynak' = 'awin-advertiser-directory-3';
  select count(*) into v_aktif  from public.programs
   where network = 'awin' and application_state <> 'DISCOVERED';
  select count(*) into v_kisitli from public.programs
   where network = 'awin' and raw ? 'yasal_kisit';

  if v_yeni <> 4 then
    raise exception 'BASARISIZ: 4 yeni program bekleniyordu, % bulundu', v_yeni;
  end if;
  if v_aktif > 0 then
    raise exception 'BASARISIZ: % program DISCOVERED disinda -- dizin gocu hicbirini yayina alamaz', v_aktif;
  end if;

  raise notice 'awin dizini: toplam %, bu gocte yeni %, yasal kisitli %, aktif %',
    v_toplam, v_yeni, v_kisitli, v_aktif;
end $$;