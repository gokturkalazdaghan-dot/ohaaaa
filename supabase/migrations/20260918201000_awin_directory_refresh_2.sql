-- Awin reklamveren dizini (3. parti) — 45 satir.
-- 41'i zaten kayitli: olculen metrikleri (EPC, cerez, feed, ulke) tazeleniyor.
-- 4'u YENI: 12044 AliExpress PL, 129553 Jumy Bee, 124250 Brookwood Med,
-- 88453 Wondershare.
--
-- EPC KURALI: conversionRate bos olan satirda EPC "0.00" yaziyor ama bu
-- OLCULMEMIS demek, "kazanc yok" demek degil. O satirlarda epc_cents NULL
-- birakiliyor -- 0 yazmak, hic olculmemis programi puanlamada en kotu
-- gostermek olurdu.
--
-- KOMISYON: dizin commissionMax alanini cogunlukla 0 veriyor (yani
-- yayinlamamis). 0 GECERLI bir orandir, bu yuzden 0 -> NULL cevriliyor.
-- Yalnizca gercekten yayinlanmis iki oran yaziliyor (goettgen %10,
-- AliExpress %7,5).
--
-- Hicbiri ACTIVE yapilmiyor: teknik entegrasyon ve sozlesme dogrulamasi
-- olmadan bir program yayina alinamaz. Hepsi DISCOVERED olarak kaliyor.
with v(np_id, ad, url, ulke, komisyon, cerez, feed, epc, ham) as (values
('119629','PURTY BODY Affiliate Program','https://purtybody.com/','US',null,30,true,66,'{"primarySector": "Lingerie", "approvalRate": 99.74, "awinIndex": 75.6136, "kaynak": "awin-advertiser-directory"}'),
('61655','Back to the Office','https://www.backtotheoffice.co.uk/','GB',null,30,true,35,'{"primarySector": "Computers", "approvalRate": 90.07, "awinIndex": 57.3572, "kaynak": "awin-advertiser-directory"}'),
('126139','FansJerseyHub','https://fansjerseyhub1.com/','US',null,30,true,43,'{"primarySector": "Sportswear", "approvalRate": 79.07, "awinIndex": 84.9574, "kaynak": "awin-advertiser-directory"}'),
('127361','Aussui Affiliate Programme (UK)','https://aussui.com/','GB',null,30,true,18,'{"primarySector": "Online Gaming", "approvalRate": 65.96, "awinIndex": 75.6985, "kaynak": "awin-advertiser-directory"}'),
('25962','BlazeVideo DE','https://www.blazevideos.de/','DE',null,30,true,73,'{"primarySector": "Electronic Accessories", "approvalRate": 55.06, "awinIndex": 40.5197, "kaynak": "awin-advertiser-directory"}'),
('40454','lunzo PL','https://www.lunzo.pl','PL',null,25,true,4,'{"primarySector": "Entertainment Superstore", "approvalRate": 68.27, "awinIndex": 58.5397, "kaynak": "awin-advertiser-directory"}'),
('40452','Lunzo HU','https://www.lunzo.hu/','HU',null,25,true,5,'{"primarySector": "Entertainment Superstore", "approvalRate": 74.8, "awinIndex": 67.1041, "kaynak": "awin-advertiser-directory"}'),
('96701','Moosehill','https://moosehillstore.com/collections/deals','US',null,30,true,60,'{"primarySector": "Clothing", "approvalRate": 100.0, "awinIndex": 61.7263, "kaynak": "awin-advertiser-directory"}'),
('96499','Ottocast','https://www.ottocast.com','US',null,45,true,16,'{"primarySector": "Automotive", "approvalRate": 86.4, "awinIndex": 47.9761, "kaynak": "awin-advertiser-directory"}'),
('66494','mooncool','https://mooncool.com','US',null,30,true,40,'{"primarySector": "Sports Equipment", "approvalRate": 80.56, "awinIndex": 44.4328, "kaynak": "awin-advertiser-directory"}'),
('56439','Red Gorilla International','https://www.redgorilla.red/','GB',null,30,true,17,'{"primarySector": "Home & Garden", "approvalRate": 100.0, "awinIndex": 88.7045, "kaynak": "awin-advertiser-directory"}'),
('17453','goettgen.de - Das grosse Schmuck und Uhrenportal','https://www.goettgen.de/','DE',0.1,60,true,11,'{"primarySector": "Jewellery", "approvalRate": 93.33, "awinIndex": 53.9947, "kaynak": "awin-advertiser-directory"}'),
('125138','FED Fitness US','https://www.fedfitness.com/','US',null,30,true,102,'{"primarySector": "Sports Equipment", "approvalRate": 72.37, "awinIndex": 37.9011, "kaynak": "awin-advertiser-directory"}'),
('121760','Triple Bristle (US)','https://www.triplebristle.com/','US',null,30,true,81,'{"primarySector": "Health & Beauty", "approvalRate": 100.0, "awinIndex": 0.0, "kaynak": "awin-advertiser-directory"}'),
('95889','Quicklly','https://www.quicklly.com','US',null,90,false,25,'{"primarySector": "FMCG", "approvalRate": 40.76, "awinIndex": 31.8024, "kaynak": "awin-advertiser-directory"}'),
('54355','Lunzo CZ','https://www.lunzo.cz/','CZ',null,25,true,1,'{"primarySector": "Womenswear", "approvalRate": 71.25, "awinIndex": 61.7988, "kaynak": "awin-advertiser-directory"}'),
('54357','Lapert CZ','https://www.lapert.cz/','CZ',null,25,true,2,'{"primarySector": "Womenswear", "approvalRate": 87.69, "awinIndex": 70.7804, "kaynak": "awin-advertiser-directory"}'),
('114104','Lunzo AT','https://www.lunzo.at/','AT',null,25,true,0,'{"primarySector": "Department Stores", "approvalRate": 100.0, "awinIndex": 77.3755, "kaynak": "awin-advertiser-directory"}'),
('111366','Sparkle GmbH','https://www.heyhappiness.com','US',null,30,true,49,'{"primarySector": "Clothing Accessories", "approvalRate": 82.22, "awinIndex": 50.2987, "kaynak": "awin-advertiser-directory"}'),
('12044','AliExpress PL','https://www.aliexpress.com','PL',0.075,3,true,19,'{"primarySector": "Gadgets", "approvalRate": 100.0, "awinIndex": 49.3987, "kaynak": "awin-advertiser-directory"}'),
('128579','Everblog US','https://everblog.com/','US',null,30,true,null,'{"primarySector": "Electronic Accessories", "approvalRate": 0.0, "awinIndex": 0.0, "kaynak": "awin-advertiser-directory"}'),
('117613','OUTFITR (US)','https://outfitrer.com/','US',null,30,true,224,'{"primarySector": "Home & Garden", "approvalRate": 93.31, "awinIndex": 70.0547, "kaynak": "awin-advertiser-directory"}'),
('129553','Jumy Bee - US','https://jumybee.com/','US',null,30,true,null,'{"primarySector": "Health & Beauty", "approvalRate": 0.0, "awinIndex": 0.0, "kaynak": "awin-advertiser-directory"}'),
('129485','Silver Brush','https://www.silverbrush.com/','US',null,30,true,null,'{"primarySector": "Home & Garden", "approvalRate": 0.0, "awinIndex": 0.0, "kaynak": "awin-advertiser-directory"}'),
('116187','Kings Camo (US)','https://www.kingscamo.com/','US',null,30,true,42,'{"primarySector": "Clothing", "approvalRate": 100.0, "awinIndex": 68.192, "kaynak": "awin-advertiser-directory"}'),
('128033','Dima Eyewear (US)','https://dimaeyewear.com/','US',null,30,true,26,'{"primarySector": "Clothing Accessories", "approvalRate": 92.86, "awinIndex": 60.8084, "kaynak": "awin-advertiser-directory"}'),
('99013','Shenzhen Cangyu Technology Co., Ltd.','https://simpleprojectus.com','US',null,30,true,165,'{"primarySector": "Home & Garden", "approvalRate": 82.76, "awinIndex": 64.6436, "kaynak": "awin-advertiser-directory"}'),
('120101','Alison US CA','https://alison.com/','US',null,30,true,24,'{"primarySector": "Education, Training & Recruitment", "approvalRate": 98.4, "awinIndex": 66.7211, "kaynak": "awin-advertiser-directory"}'),
('124816','Traverseon','https://traverseon.com/','US',null,30,true,40,'{"primarySector": "Home & Garden", "approvalRate": 85.92, "awinIndex": 51.4896, "kaynak": "awin-advertiser-directory"}'),
('126975','EasyClaw','https://easyclaw.com/','US',null,30,false,null,'{"primarySector": "Software Downloads", "approvalRate": 0.0, "awinIndex": 0.0, "kaynak": "awin-advertiser-directory"}'),
('123618','Cozeware','https://www.cozeware.com/','US',null,45,false,506,'{"primarySector": "Home & Garden", "approvalRate": 75.7, "awinIndex": 78.6176, "kaynak": "awin-advertiser-directory"}'),
('36144','OutIn','https://outin.com','US',null,30,true,137,'{"primarySector": "Home & Garden", "approvalRate": 79.04, "awinIndex": 46.5063, "kaynak": "awin-advertiser-directory"}'),
('129105','HealthRX','https://healthrx.com/','US',null,30,false,null,'{"primarySector": "Health & Beauty", "approvalRate": 0.0, "awinIndex": 0.0, "kaynak": "awin-advertiser-directory"}'),
('124250','Brookwood Med','https://brookwoodmed.com/','US',null,30,true,14,'{"primarySector": "Health & Beauty", "approvalRate": 100.0, "awinIndex": 72.7687, "kaynak": "awin-advertiser-directory"}'),
('115216','King Koil','https://www.kingkoilairbeds.com','US',null,30,true,80,'{"primarySector": "Furniture & Soft Furnishings", "approvalRate": 96.99, "awinIndex": 58.0452, "kaynak": "awin-advertiser-directory"}'),
('22069','Grade Mobile','https://grademobile.co.uk/','GB',null,30,true,23,'{"primarySector": "Mobile Pay As You Go", "approvalRate": 85.33, "awinIndex": 70.6132, "kaynak": "awin-advertiser-directory"}'),
('127939','wanayou','https://www.wanayou.com/','US',null,30,true,null,'{"primarySector": "Sportswear", "approvalRate": 0.0, "awinIndex": 0.0, "kaynak": "awin-advertiser-directory"}'),
('95201','Giftlab','https://www.giftlab.com/','US',null,30,true,35,'{"primarySector": "Gifts & Flowers", "approvalRate": 100.0, "awinIndex": 57.6648, "kaynak": "awin-advertiser-directory"}'),
('125464','Toputure - US','https://toputure.com/','US',null,30,true,64,'{"primarySector": "Sports Equipment", "approvalRate": 100.0, "awinIndex": 56.3532, "kaynak": "awin-advertiser-directory"}'),
('88453','Wondershare Global Limited','https://www.wondershare.com','US',null,90,true,16,'{"primarySector": "Computers", "approvalRate": 69.57, "awinIndex": 32.4612, "kaynak": "awin-advertiser-directory"}'),
('115809','Ravin Crossbows (US)','https://ravincrossbows.com/','US',null,30,false,116,'{"primarySector": "Sports Equipment", "approvalRate": 87.25, "awinIndex": 60.4977, "kaynak": "awin-advertiser-directory"}'),
('113600','Nextrition Pet (US)','https://www.nextritionpet.com/','US',null,30,true,33,'{"primarySector": "Pets & Pet Care", "approvalRate": 44.3, "awinIndex": 45.9063, "kaynak": "awin-advertiser-directory"}'),
('54359','Lapert SK','https://www.lapert.sk/','SK',null,25,true,2,'{"primarySector": "Womenswear", "approvalRate": 84.46, "awinIndex": 70.0232, "kaynak": "awin-advertiser-directory"}'),
('50899','Xuchang Aixiu Hair Products Co., Ltd.','https://www.allovehair.com','US',null,30,false,45,'{"primarySector": "Clothing Accessories", "approvalRate": 85.6, "awinIndex": 51.5776, "kaynak": "awin-advertiser-directory"}'),
('129267','Findlys','https://www.findlys.com/','US',null,30,false,null,'{"primarySector": "Business Services (B2B)", "approvalRate": 0.0, "awinIndex": 0.0, "kaynak": "awin-advertiser-directory"}')
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
declare v_toplam int; v_ulkeli int; v_epcli int; v_aktif int;
begin
  select count(*) into v_toplam from public.programs where network = 'awin';
  select count(*) into v_ulkeli from public.programs where network = 'awin' and country_code is not null;
  select count(*) into v_epcli  from public.programs where network = 'awin' and epc_cents is not null;
  select count(*) into v_aktif  from public.programs where application_state = 'APPROVED';

  if v_toplam < 45 then
    raise exception 'DOGRULAMA 1: dizindeki 45 programin hepsi kayitli degil (%).', v_toplam;
  end if;
  if v_ulkeli < 45 then
    raise exception 'DOGRULAMA 2: % programin ulkesi bos -- urun hangi ulkede gosterilecegi bilinemezdi.', v_toplam - v_ulkeli;
  end if;
  if v_aktif <> 0 then
    raise exception 'DOGRULAMA 3: dogrulanmamis bir program ONAYLI isaretlenmis (%).', v_aktif;
  end if;

  raise notice
    'Awin dizini islendi: % program, %'' unde ulke, %'' inde OLCULMUS EPC var. Hicbiri yayina alinmadi.',
    v_toplam, v_ulkeli, v_epcli;
end $$;