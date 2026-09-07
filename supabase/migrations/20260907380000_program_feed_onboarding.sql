-- ===========================================================================
-- Feed onboarding: feed KIMLIGI kaydediliyor, feed ADRESI uydurulmuyor
-- ===========================================================================
--
-- Hesap sahibi uc advertiser icin Awin panosundan feed bilgisi bildirdi:
--
--   Mooncool            MID 66494   Feed ID 108580  Products 5
--                       Feed: sftp://datafeeds.shareasale.com/Awin/148320/feed.zip
--   Alison              MID 120101  Feed ID 111515  Products 5.594
--                       Feed: "Alison Course Feeds"  (ad, adres degil)
--   Back to the Office  MID 61655   Feed ID 102827  Products 116.418
--                       Feed: "General Feed - Back to the Office"  (ad)
--
-- ---------------------------------------------------------------------------
-- FEED, ADRESIYLE DEGIL KIMLIGIYLE KAYDEDILIYOR
-- ---------------------------------------------------------------------------
--
-- Uc feed'in ucunun da bir KIMLIGI var (Feed ID) ama yalnizca birinin ADRESI
-- var. Depoda feed kimligini tutacak bir yer YOKTU: `sources.endpoint_url`
-- adres bekliyordu, adres olmayinca kayit hic acilamiyordu ve elimizdeki
-- gercek bilgi (kimlik, urun sayisi, bicim) kaybolup gidiyordu.
--
-- `programs.network_feed_id` bunu cozuyor: agin feed'i hangi kimlikle
-- tanidigini saklariz; adres, erisim acildiginda o kimlikten TURETILIR.
-- `deeplink_template`in MID'den turetilmesiyle ayni kalip.
--
-- ---------------------------------------------------------------------------
-- ADRES NEDEN TURETILMEDI
-- ---------------------------------------------------------------------------
--
-- Awin'in yayinci feed indirme adresi, arama sonuclarina gore
-- `productdata.awin.com/datafeed/download/apikey/<ANAHTAR>/.../fid/<FEED_ID>/...`
-- bicimindedir. BU BICIM BU ORTAMDA DOGRULANAMADI: hem `wiki.awin.com` hem
-- `help.awin.com` egress vekili tarafindan engelleniyor (EGRESS_BLOCKED), yani
-- resmi belgeye BIRINCI ELDEN bakilamadi. Arama motorunun ozeti resmi kaynak
-- degildir.
--
-- Bu yuzden hicbir satira indirme adresi YAZILMADI. Bicim dogrulandiginda
-- adres tek bir yerde -- kimlikten -- uretilecek; simdiden yazilsaydi ve bicim
-- yanlis olsaydi, uc kaydin ucunde de sessizce calismayan bir adres dururdu.
--
-- Ayrica adresin icinde YAYINCI API ANAHTARI var: o bir SIR ve veritabaninda
-- hicbir zaman durmamali (`sources.auth_secret_ref` zaten deger degil ORTAM
-- DEGISKENI ADI tutuyor). Yani adres, dogrulansa bile satirda tam hâliyle
-- duramazdi.
--
-- ---------------------------------------------------------------------------
-- MOONCOOL'UN ADRESI VAR AMA BU HAT ONU CEKEMEZ
-- ---------------------------------------------------------------------------
--
--   sftp://datafeeds.shareasale.com/Awin/148320/feed.zip
--
-- Iki ayri sebeple bugun kullanilamaz ve ikisi de KOD GERCEGI:
--
--   1. Sema `sftp`. Alim hattinin tek ag yolu HTTPS'tir (`ProviderContext.
--      fetch`, `validateUrl` SSRF korumasi). sftp icin istemci de yok, kimlik
--      dogrulama da yok.
--   2. Dosya `.zip`. 20260907'deki `decodeFeedPayload` zip'i ACIKCA reddeder
--      (`SECURITY_ERROR`): zip, ic ice giris ve yol kacisi (zip slip) tasiyan
--      bir arsiv bicimi ve hat yalnizca gzip aciyor.
--
-- Adres UYDURULMADI, oldugu gibi kaydedildi -- ama `feed_access`
-- 'unsupported_transport' olarak isaretlendi. Bir `sources` satiri
-- ACILMADI: acilsaydi zamanlayici onu her turda cekmeye calisir, her turda
-- duser ve devre kesici gurultusu uretirdi.
--
-- ---------------------------------------------------------------------------
-- NEDEN HIC `sources` SATIRI ACILMIYOR
-- ---------------------------------------------------------------------------
--
-- Ucu icin de ayni sonuc, ama sebepler farkli; hicbiri "unuttuk" degil:
--
--   Mooncool            sema ve arsiv bicimi desteklenmiyor (yukarida).
--   Alison              adres yok; erisim yayinci API anahtari gerektiriyor.
--   Back to the Office  adres yok; AYRICA pazari bilinmiyor.
--                       `sources.market_code` NOT NULL ve `sources.currency`
--                       varsayilani 'TRY'. Pazar/para birimi bilinmeden acilan
--                       bir kaynak, erisim geldigi gun BUTUN fiyatlari TRY
--                       sayarak alirdi -- 12-17. asamalarda kovaladigimiz
--                       hatanin en kotu girisi: yanlis para birimi KAYNAKTAN
--                       iceri.
--
-- Kaynak yok => alim turu yok => urun ve fiyat noktasi yok. Gorevin
-- "feed erisimi dogrulanmadan products/price_points olusturma" kurali
-- boylece bir sozle degil, YAPIYLA saglaniyor.
--
-- ---------------------------------------------------------------------------
-- "PRODUCT FEED: 5" COZULDU
-- ---------------------------------------------------------------------------
--
-- 20260907350000 Mooncool icin gelen "5" degerinin birimini belirsiz bulmus ve
-- `product_count`'a YAZMAMISTI (feed sayisi mi urun sayisi mi?). Hesap sahibi
-- simdi ayni satiri "Products: 5" olarak bildirdi: sayi URUN sayisiymis.
-- Yaziliyor. O gocteki temkin dogruydu -- belirsizken yazsaydik ve yanlis
-- olsaydi, puanlama Mooncool'u 5 feed'lik bir katalog sanacakti.
-- ===========================================================================

-- --- 1) Feed kimligi ve erisim durumu icin sutunlar ------------------------
alter table public.programs
  add column if not exists network_feed_id      text,
  add column if not exists feed_url             text,
  add column if not exists feed_access          text not null default 'unverified',
  add column if not exists feed_last_updated_at timestamptz,
  add column if not exists network_item_count   integer;

comment on column public.programs.network_feed_id is
  'Agin feed kimligi (Awin: fid). Indirme adresi bundan TURETILIR; adresin '
  'kendisi -- icinde yayinci API anahtari gectigi icin -- satirda durmaz.';
comment on column public.programs.feed_url is
  'Ag ADRESI ACIKCA verdiyse, oldugu gibi. Turetilmis ya da tahmin edilmis '
  'adres BURAYA YAZILMAZ.';
comment on column public.programs.feed_access is
  'Feed''e bugun erisebiliyor muyuz: unverified / credentials_required / '
  'unsupported_transport / verified. ''verified'' https bir adres ISTER.';
comment on column public.programs.feed_last_updated_at is
  'Agin bildirdigi son feed guncellemesi. NULL = BILDIRILMEDI (''hic '
  'guncellenmedi'' DEGIL).';
comment on column public.programs.network_item_count is
  'Agin BU FEED icin bildirdigi kalem sayisi. Bizim katalogumuz hakkinda '
  'hicbir sey soylemez; onu `sources.last_item_count` olcer.';

-- Kucuk ve kapali bir kelime dagarcigi: serbest metin olsaydi "ok", "OK",
-- "erisilebilir" gibi uc ayri deger ayni seyi anlatir ve hicbiri sorgulanamazdi.
alter table public.programs drop constraint if exists programs_feed_access_vocab;
alter table public.programs add constraint programs_feed_access_vocab
  check (feed_access in ('unverified','credentials_required','unsupported_transport','verified'));

-- FAIL-CLOSED: "erisebiliyoruz" demek icin CEKILEBILIR bir adres gerekir.
-- capabilityEvidence.ts'in 'supported' kurali ile ayni fikir: iddia, kaniti
-- olmadan yazilamaz.
alter table public.programs drop constraint if exists programs_verified_feed_needs_https;
alter table public.programs add constraint programs_verified_feed_needs_https
  check (feed_access <> 'verified' or (feed_url is not null and feed_url like 'https://%'));

alter table public.programs drop constraint if exists programs_network_feed_id_not_blank;
alter table public.programs add constraint programs_network_feed_id_not_blank
  check (network_feed_id is null or length(btrim(network_feed_id)) > 0);

alter table public.programs drop constraint if exists programs_network_item_count_non_negative;
alter table public.programs add constraint programs_network_item_count_non_negative
  check (network_item_count is null or network_item_count >= 0);

-- AYNI FEED IKI PROGRAMA BAGLANAMAZ. Baglansaydi ayni katalog iki kez
-- sayilir ve iki program da "116 bin urun" gosterirdi.
drop index if exists public.programs_network_feed_unique;
create unique index programs_network_feed_unique
  on public.programs (network, network_feed_id)
  where network_feed_id is not null;

-- --- 2) Mooncool: "5" URUN sayisiymis; feed adresi var ama cekilemiyor -----
update public.programs
   set network_feed_id    = '108580',
       feed_url           = 'sftp://datafeeds.shareasale.com/Awin/148320/feed.zip',
       feed_access        = 'unsupported_transport',
       product_count      = 5,
       network_item_count = 5,
       last_verified_at   = now(),
       terms = coalesce(terms || ' | ', '') ||
         'Feed ID 108580. Adres sftp://datafeeds.shareasale.com/Awin/148320/'
         'feed.zip -- alim hatti YALNIZCA https ceker (validateUrl/SSRF) ve zip '
         'arsivini ACIKCA reddeder (decodeFeedPayload, SECURITY_ERROR); yalnizca '
         'gzip acilir. "Product Feed: 5" belirsizligi hesap sahibi tarafindan '
         'cozuldu: 5 URUN. Feed son guncelleme tarihi BILDIRILMEDI.'
 where network = 'awin' and network_program_id = '66494';

-- --- 3) Alison: kimlik ve ad var, adres yok -------------------------------
update public.programs
   set network_feed_id    = '111515',
       feed_access        = 'credentials_required',
       network_item_count = 5594,
       last_verified_at   = now(),
       terms = coalesce(terms || ' | ', '') ||
         'Feed ID 111515, feed adi "Alison Course Feeds", 5594 urun. ADRES '
         'BILDIRILMEDI ve uydurulmadi: Awin indirme adresi yayinci datafeed API '
         'anahtari gerektiriyor, anahtar yok. Feed son guncelleme tarihi '
         'BILDIRILMEDI.'
 where network = 'awin' and network_program_id = '120101';

-- --- 4) Back to the Office: program satiri ilk kez aciliyor ---------------
-- Magaza kaydi 20260907140000'den beri var (MID 61655) ama dizin gozlemi
-- yoktu. PAZAR VE ULKE YAZILMIYOR: bildirilmedi ve ad'dan ("Back to the
-- Office") ulke turetmek cikarim olurdu -- 20260907170000 tam da bu sebeple
-- Simple Project'in ulkesini sirket adresinden turetmeyi reddetmisti.
insert into public.programs (
  network, network_program_id, merchant_name,
  network_feed_id, feed_available, feed_access,
  product_count, network_item_count,
  application_state, last_verified_at, terms
) values (
  'awin', '61655', 'Back to the Office',
  '102827', true, 'credentials_required',
  116418, 116418,
  'DISCOVERED', now(),
  'Awin panosu (07/09/2026, hesap sahibi bildirimi): Feed ID 102827, feed adi '
  '"General Feed - Back to the Office", 116418 urun. ADRES BILDIRILMEDI ve '
  'uydurulmadi. PAZAR/ULKE DE BILDIRILMEDI -- bu yuzden sources satiri '
  'acilamaz (market_code NOT NULL, currency varsayilani TRY): pazari bilinmeden '
  'acilan kaynak butun fiyatlari TRY sayarak alirdi. Komisyon ve cerez '
  'bildirilmedi. Feed son guncelleme tarihi BILDIRILMEDI.'
)
on conflict (network, network_program_id) do update
   set network_feed_id    = excluded.network_feed_id,
       feed_available     = excluded.feed_available,
       feed_access        = excluded.feed_access,
       product_count      = excluded.product_count,
       network_item_count = excluded.network_item_count,
       last_verified_at   = excluded.last_verified_at;

-- --- 5) Ucunun de feed'i VAR (adresi olmasa da) ---------------------------
update public.programs
   set feed_available = true
 where network = 'awin' and network_program_id in ('66494','120101','61655');

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_sayi integer;
begin
  -- 1) Uc programin ucu de feed kimligini tasiyor.
  select count(*) into v_sayi
    from public.programs
   where network = 'awin'
     and network_program_id in ('66494','120101','61655')
     and network_feed_id is not null;
  if v_sayi <> 3 then
    raise exception 'DOGRULAMA 1: uc feed kimliginden % tanesi yazildi.', v_sayi;
  end if;

  -- 2) HICBIRINE INDIRME ADRESI UYDURULMADI. Yalnizca agin ACIKCA verdigi
  --    tek adres (Mooncool'un sftp'si) duruyor; digerlerinde feed_url NULL.
  select count(*) into v_sayi
    from public.programs
   where network = 'awin'
     and network_program_id in ('120101','61655')
     and feed_url is not null;
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 2: adres bildirilmeyen % programa adres yazilmis.', v_sayi;
  end if;

  select * into r from public.programs where network='awin' and network_program_id='66494';
  if r.feed_url <> 'sftp://datafeeds.shareasale.com/Awin/148320/feed.zip' then
    raise exception 'DOGRULAMA 3: Mooncool''un bildirilen adresi degistirilmis (%).', r.feed_url;
  end if;

  -- 4) O adres CEKILEBILIR SAYILMIYOR: sema sftp, dosya zip.
  if r.feed_access <> 'unsupported_transport' then
    raise exception 'DOGRULAMA 4: sftp/zip adres cekilebilir isaretlenmis (%).', r.feed_access;
  end if;

  -- 5) "Product Feed: 5" cozuldu: 5 URUN.
  if r.product_count is distinct from 5 or r.network_item_count is distinct from 5 then
    raise exception 'DOGRULAMA 5: Mooncool urun sayisi 5 olmali (product=%, network=%).',
      r.product_count, r.network_item_count;
  end if;

  -- 6) HICBIRI 'verified' DEGIL -- hicbirine bugun erisemiyoruz.
  select count(*) into v_sayi
    from public.programs
   where network = 'awin'
     and network_program_id in ('66494','120101','61655')
     and feed_access = 'verified';
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 6: erisim dogrulanmadan % feed ''verified'' isaretlenmis.', v_sayi;
  end if;

  -- 7) FAIL-CLOSED KISITI GERCEKTEN CALISIYOR: adressiz 'verified' reddedilmeli.
  --    6. iddia tek basina "kimse verified yazmadi" der; bu, YAZILAMAYACAGINI
  --    kanitlar.
  begin
    update public.programs set feed_access = 'verified'
     where network = 'awin' and network_program_id = '120101';
    raise exception 'DOGRULAMA 7: adressiz feed ''verified'' isaretlenebildi.';
  exception when check_violation then null;
  end;

  -- 8) sftp adresle de 'verified' olunamaz: kisit https istiyor.
  begin
    update public.programs set feed_access = 'verified'
     where network = 'awin' and network_program_id = '66494';
    raise exception 'DOGRULAMA 8: sftp adresle ''verified'' isaretlenebildi.';
  exception when check_violation then null;
  end;

  -- 9) HICBIR KAYNAK ACILMADI => alim turu, urun, fiyat noktasi da yok.
  select count(*) into v_sayi
    from public.sources s
    join public.merchants m on m.id = s.merchant_id
   where m.network_advertiser_id in ('66494','120101','61655');
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 9: erisim dogrulanmadan % kaynak acilmis.', v_sayi;
  end if;

  select count(*) into v_sayi
    from public.products p
    join public.merchants m on m.id = p.merchant_id
   where m.network_advertiser_id in ('66494','120101','61655');
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 10: gercek feed verisi olmadan % urun uretilmis.', v_sayi;
  end if;

  -- 11) AYNI FEED IKI PROGRAMA BAGLANAMAZ.
  begin
    update public.programs set network_feed_id = '108580'
     where network = 'awin' and network_program_id = '120101';
    raise exception 'DOGRULAMA 11: ayni feed kimligi iki programa baglanabildi -- '
      'ayni katalog iki kez sayilirdi.';
  exception when unique_violation then null;
  end;

  -- 12) Son guncelleme tarihi UYDURULMADI: ucunde de NULL.
  select count(*) into v_sayi
    from public.programs
   where network = 'awin'
     and network_program_id in ('66494','120101','61655')
     and feed_last_updated_at is not null;
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 12: bildirilmeyen son guncelleme tarihi % kayda yazilmis.',
      v_sayi;
  end if;

  raise notice
    'Uc feed kimlikle kaydedildi (108580 / 111515 / 102827). Indirme adresi '
    'UYDURULMADI; Mooncool''un sftp+zip adresi cekilemez isaretli. Hicbiri '
    'erisim dogrulanmis degil, hicbir kaynak/urun/fiyat uretilmedi.';
end $$;
