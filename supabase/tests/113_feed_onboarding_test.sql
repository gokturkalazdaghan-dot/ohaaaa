-- ===========================================================================
-- Feed onboarding: kimlik kaydedildi, adres UYDURULMADI, urun URETILMEDI
-- ===========================================================================
--
-- Feed kimlikleri kayitli. Erisim durumu 07/09/2026'da DEGISTI: uc feed
-- gercekten indirildi, WANAYOU'nunki ise hâlâ yok. Bu dosyanin sinadigi sey
-- degismedi -- "bilmedigimizi bilmiyoruz" kaydinin YAPISAL olarak kalici
-- olmasi: bir yorum satiri degil, bir kisit olmasi. Fixture'lar erisilebilir
-- hâle gelince iddialar hâlâ adressiz olan advertiser'a tasindi; kisitlarin
-- kendisi aynen duruyor.
-- ===========================================================================
begin;
select plan(10);

-- --- 1: UC FEED DE KIMLIGIYLE KAYITLI -------------------------------------
-- Adres olmadan da kaydedilebilmeleri gerekiyordu; onceden feed kimligini
-- tutacak yer yoktu ve elimizdeki gercek bilgi kaybolup gidiyordu.
select is(
  (select string_agg(network_feed_id, ',' order by network_feed_id)
     from public.programs
    where network = 'awin' and network_program_id in ('66494','120101','61655')),
  '102827,108580,111515',
  '1) uc feed kimligi de kayitli');

-- --- 2: ADRES BILDIRILMEYENE ADRES YAZILMADI ------------------------------
-- FIXTURE DEGISTI (07/09/2026). 120101 ve 61655 artik GERCEKTEN adresli:
-- feed dizini indirildi, indirme adresleri oradan geldi ve dosyalar cekildi
-- (http=200, application/gzip). Iddianin ANLAMI degismedi, yalnizca hâlâ
-- adressiz olan bir fixture'a tasindi: WANAYOU'nun feed'i GERCEKTEN yok --
-- dizinin 577 satirinin hicbir sutununda MID 127939 gecmiyor.
select is(
  (select count(*)::int from public.programs
    where network = 'awin' and network_program_id = '127939'
      and feed_url is not null),
  0,
  '2) adres bildirilmeyen programa adres uydurulmadi');

-- --- 3-4: MOONCOOL DUZELTMESI ---------------------------------------------
-- ESKI IDDIA YANLISTI ve YANLIS OLDUGU OLCULDU (07/09/2026).
--
-- "sftp://datafeeds.shareasale.com/Awin/148320/feed.zip" bir TASIMA ADRESI
-- DEGIL; Awin'in feed dizinindeki FEED NAME alanidir. Feed'in kendisi normal
-- https+gzip ile cekiliyor: http=200, application/gzip, 6 satir (1 baslik +
-- 5 urun), merchant_id 66494, hattan gecen 5/5.
--
-- Eski 3. iddia o dizeyi `feed_url`de bekliyordu, eski 4. iddia da ondan
-- "cekilemez" sonucunu cikariyordu. Ikisi de ayni yanlis okumaya dayaniyordu.
select is(
  (select feed_access from public.programs
    where network = 'awin' and network_program_id = '66494'),
  'verified',
  '3) Mooncool feed''i https ile GERCEKTEN cekilebiliyor');

select ok(
  (select feed_url from public.programs
    where network = 'awin' and network_program_id = '66494')
    like 'https://productdata.awin.com/%fid/108580/%',
  '4) adres gercek indirme adresi (fid 108580)');

-- --- 5-6: FAIL-CLOSED KISIT ------------------------------------------------
-- "Erisebiliyoruz" demek icin CEKILEBILIR bir adres gerekir. 4. iddia
-- "kimse verified yazmamis" der; bu ikisi YAZILAMAYACAGINI kanitlar.
-- FIXTURE DEGISTI: 120101 ve 66494 artik gercekten adresli. Kisitin KENDISI
-- degismedi ve burada hâlâ sinaniyor -- adressiz WANAYOU ile.
select throws_ok(
  $$ update public.programs set feed_access = 'verified'
      where network = 'awin' and network_program_id = '127939' $$,
  '23514', null,
  '5) adressiz feed ''verified'' isaretlenemiyor');

-- https OLMAYAN adresle de olmaz: sftp adres yaziip verified denemesi.
select throws_ok(
  $$ update public.programs
        set feed_url = 'sftp://ornek.gecersiz/feed.zip', feed_access = 'verified'
      where network = 'awin' and network_program_id = '127939' $$,
  '23514', null,
  '6) https olmayan adresle ''verified'' isaretlenemiyor');

-- --- 7: AYNI FEED IKI PROGRAMA BAGLANAMAZ ---------------------------------
-- Baglansaydi ayni katalog iki kez sayilir, iki program da ayni urun
-- sayisini gosterirdi.
select throws_ok(
  $$ update public.programs set network_feed_id = '108580'
      where network = 'awin' and network_program_id = '120101' $$,
  '23505', null,
  '7) ayni feed kimligi iki programa baglanamiyor');

-- --- 8: KAYNAK YALNIZCA DOGRULANMIS FEED ICIN ACILABILIR ------------------
-- ESKI IDDIA "hic kaynak yok" diyordu. Artik BTO'nun In Stock feed'i (111663)
-- GERCEKTEN dogrulandi (http=200, 35.952/35.952 satir hattan gecti) ve onun
-- kaynagi acildi -- yani "hic kaynak yok" artik dogru DEGIL.
--
-- Korunmasi gereken kural bu degildi zaten: kural, DOGRULANMAMIS bir feed'e
-- kaynak acilmamasiydi. Iddia o kurali dogrudan sinamaya cevrildi ve boylece
-- ONCEKINDEN GUCLU: eskisi yalnizca uc MID'e bakiyordu, bu butun kaynaklari
-- tariyor.
select is(
  (select count(*)::int
     from public.sources s
     join public.merchants m on m.id = s.merchant_id
     join public.programs  p on p.network = m.network
                            and p.network_program_id = m.network_advertiser_id
    where p.feed_access is distinct from 'verified'),
  0,
  '8) dogrulanmamis feed icin kaynak acilmadi');

-- --- 9: GERCEK FEED VERISI OLMADAN URUN URETILMEDI ------------------------
select is(
  (select count(*)::int
     from public.products p
     join public.merchants m on m.id = p.merchant_id
    where m.network_advertiser_id in ('66494','120101','61655')),
  0,
  '9) gercek feed verisi olmadan urun uretilmedi');

-- --- 10: BILDIRILMEYEN SON GUNCELLEME TARIHI UYDURULMADI ------------------
-- NULL burada "hic guncellenmedi" degil "BILDIRILMEDI" demek; ikisini ayni
-- hucreye yazmak, bilmedigimizi biliyormus gibi gostermek olurdu.
-- FIXTURE DEGISTI: uc program icin tarih artik BILINIYOR -- feed dizininin
-- "Last Imported" alanindan geldi (agin kendi beyani). Iddianin anlami ayni:
-- BILDIRILMEYEN tarih uydurulmaz. WANAYOU'nun feed'i yok, tarihi de yok.
select is(
  (select count(*)::int from public.programs
    where network = 'awin' and network_program_id = '127939'
      and feed_last_updated_at is not null),
  0,
  '10) bildirilmeyen son guncelleme tarihi uydurulmadi');

select * from finish();
rollback;
