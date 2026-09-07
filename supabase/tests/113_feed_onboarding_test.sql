-- ===========================================================================
-- Feed onboarding: kimlik kaydedildi, adres UYDURULMADI, urun URETILMEDI
-- ===========================================================================
--
-- Uc advertiser'in feed'i biliniyor ama HICBIRINE bugun erisemiyoruz. Bu
-- dosyanin sinadigi sey, "erisemiyoruz"un kayitta GORUNUR ve YAPISAL olarak
-- kalici olmasi -- bir yorum satiri degil, bir kisit olmasi.
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
select is(
  (select count(*)::int from public.programs
    where network = 'awin' and network_program_id in ('120101','61655')
      and feed_url is not null),
  0,
  '2) adres bildirilmeyen programa adres uydurulmadi');

-- --- 3: BILDIRILEN ADRES OLDUGU GIBI DURUYOR ------------------------------
select is(
  (select feed_url from public.programs
    where network = 'awin' and network_program_id = '66494'),
  'sftp://datafeeds.shareasale.com/Awin/148320/feed.zip',
  '3) agin verdigi adres degistirilmeden kaydedildi');

-- --- 4: ...AMA CEKILEBILIR SAYILMIYOR -------------------------------------
-- Sema sftp: alim hattinin tek ag yolu https (validateUrl, SSRF korumasi).
-- Dosya zip: decodeFeedPayload arsivi ACIKCA reddeder (SECURITY_ERROR).
select is(
  (select feed_access from public.programs
    where network = 'awin' and network_program_id = '66494'),
  'unsupported_transport',
  '4) sftp+zip adres "cekilebilir" isaretlenmedi');

-- --- 5-6: FAIL-CLOSED KISIT ------------------------------------------------
-- "Erisebiliyoruz" demek icin CEKILEBILIR bir adres gerekir. 4. iddia
-- "kimse verified yazmamis" der; bu ikisi YAZILAMAYACAGINI kanitlar.
select throws_ok(
  $$ update public.programs set feed_access = 'verified'
      where network = 'awin' and network_program_id = '120101' $$,
  '23514', null,
  '5) adressiz feed ''verified'' isaretlenemiyor');

select throws_ok(
  $$ update public.programs set feed_access = 'verified'
      where network = 'awin' and network_program_id = '66494' $$,
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

-- --- 8: ERISIM DOGRULANMADAN KAYNAK ACILMADI ------------------------------
-- Kaynak yok => alim turu yok => urun ve fiyat noktasi yok. Kural bir sozle
-- degil, YAPIYLA saglaniyor.
select is(
  (select count(*)::int
     from public.sources s
     join public.merchants m on m.id = s.merchant_id
    where m.network_advertiser_id in ('66494','120101','61655')),
  0,
  '8) erisim dogrulanmadan kaynak acilmadi');

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
select is(
  (select count(*)::int from public.programs
    where network = 'awin' and network_program_id in ('66494','120101','61655')
      and feed_last_updated_at is not null),
  0,
  '10) bildirilmeyen son guncelleme tarihi uydurulmadi');

select * from finish();
rollback;
