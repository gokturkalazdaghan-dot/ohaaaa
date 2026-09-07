-- ===========================================================================
-- Feed dogrulama: OLCULEN gercekler yaziliyor
-- ===========================================================================
--
-- 20260907380000 uc feed'i KIMLIGIYLE kaydetmis, adres uydurmamisti. Bu goc
-- o kayitlarin uzerine OLCUM koyuyor: hesap sahibi Alison'in gercek feed
-- dosyasini (datafeed_3074081.csv.gz) ve Awin advertiser dizinini sagladi.
--
-- ---------------------------------------------------------------------------
-- ALISON: FEED GERCEK, ICINDE FIYAT YOK
-- ---------------------------------------------------------------------------
--
-- Dosya alim hattindan gecirildi (scripts/awin-feed-dryrun.mjs, AGA CIKMADAN):
--
--   tasima            gzip           (sihirli bayttan okundu, uzantidan degil)
--   ham satir         5594           -> Awin'in bildirdigi 5.594 ile birebir
--   merchant_id       120101         -> MID ile birebir
--   data_feed_id      111515         -> Feed ID ile birebir
--   para birimi       USD            -> OLCULDU, cikarim degil
--   last_updated      HER SATIRDA BOS
--   hattan gecen      0
--   elenen            5594           hepsi "fiyat sifir veya negatif"
--   GTIN dolu         0
--   marka dolu        0
--
-- Feed'in butun fiyat sutunlari bos: `search_price`, `store_price`,
-- `rrp_price`, `base_price` sifir; `display_price` her satirda "USD0.00".
-- Alison bir CEVRIMICI KURS saglayicisi -- kurslar ucretsiz, gelir sertifika
-- ve abonelikte. Yani feed'de satin alinabilir, fiyatlanabilir bir kalem YOK.
--
-- BU BIR ESLEME HATASI DEGIL. Normallestirici dogru davrandi: fiyatsiz kalem
-- alinmaz, cunku "0 TL" olarak gecen bir kayit karsilastirmada daima "en
-- ucuz" cikar ve kullaniciya yanlis sonuc gosterir.
--
-- KAYNAK ACILMIYOR. Acilsaydi her turda 5.594 satir reddedilir, katalog bos
-- kalir, hata sayaci dolar ve devre kesici gurultusu uretirdi.
--
-- Ayrica: `ean`, `product_GTIN`, `mpn` ve `brand_name` sutunlarinin DORDU DE
-- bos. O feed'de kanonik kimlik yalnizca basliktan turerdi -- markasiz baslik
-- en zayif anahtardir ve alakasiz urunleri birlestirme riski en yuksek olan.
--
-- ---------------------------------------------------------------------------
-- BACK TO THE OFFICE: PAZAR ARTIK BILINIYOR
-- ---------------------------------------------------------------------------
--
-- 20260907380000 bu advertiser icin kaynak acamamisti cunku PAZARI
-- bilinmiyordu: `sources.market_code` NOT NULL ve `sources.currency`
-- varsayilani 'TRY'; pazari bilinmeden acilan kaynak butun fiyatlari TRY
-- sayarak alirdi.
--
-- Awin advertiser dizini (hesap sahibinin disa aktardigi CSV) bu bosluğu
-- kapatiyor: primaryRegion GB, cookieLength 30, feedEnabled yes,
-- displayUrl https://www.backtotheoffice.co.uk/.
--
-- Komisyon HÂLÂ YOK: dizinde commissionMin ve commissionMax'in ikisi de 0 --
-- bu "komisyon sifir" demek degil, "yayinlanmamis" demektir (ayni satirda
-- lead degerleri de 0). Bu yuzden `terms_verified_at` NULL kaliyor.
--
-- ---------------------------------------------------------------------------
-- WANAYOU: FEED YOK, UYDURULMADI
-- ---------------------------------------------------------------------------
--
-- Hesap sahibi program sartlarini bildirdi (MID 127939, %10, 30 gun, ABD
-- pazari). Feed ID, feed adresi ve urun sayisi BILDIRILMEDI ve bu ortamda
-- kesfedilemedi: advertiser dizini CSV'sinde 127939 YOK (dizinde 66 advertiser
-- var, WANAYOU aralarinda degil) ve Awin API'sine cikilamiyor.
--
-- `feed_access = 'manual_required'`: feed'i bir insanin Awin panosundan
-- bulmasi gerekiyor. Kimlik uydurmak, sonraki turda o kimlikle bos bir indirme
-- denemesi yapip hatayi Awin'e yiktirmak olurdu.
--
-- ---------------------------------------------------------------------------
-- ORTAM KISITLARI (bu turda cozulemeyen, kod disi)
-- ---------------------------------------------------------------------------
--   AWIN_DATAFEED_API_KEY   bu ortamda TANIMLI DEGIL.
--   productdata.awin.com    egress vekili tarafindan engelli (CONNECT 403).
-- Yani canli indirme bu ortamda anahtarla bile YAPILAMAZ. Kod tarafi hazir:
-- adres feed kimliginden turetiliyor (buildAwinFeedUrl) ve anahtar yalnizca
-- ortam degiskeninden okunuyor (awinFeedAccess.ts) -- veritabanina, log'a,
-- istemci paketine ya da test fixture'ina hicbir zaman yazilmiyor.
-- ===========================================================================

-- --- 1) Hattan gecen urun sayisi icin sutun -------------------------------
-- `network_item_count` AGIN iddiasi, `product_count` dizin gozlemi; bu ise
-- BIZIM olcumumuz: normallestiriciden gecebilen kalem sayisi. Kaynak acilip
-- acilmayacagina karar veren sayi budur ve digerlerinden farkli olabilir --
-- Alison'da 5594 karsilik 0.
alter table public.programs
  add column if not exists feed_ingestable_count integer,
  add column if not exists feed_checked_at       timestamptz;

comment on column public.programs.feed_ingestable_count is
  'Feed''den alim hattindan GECEBILEN kalem sayisi (dry-run olcumu). Agin '
  'bildirdigi sayi degildir: Alison 5.594 bildirip 0 gecirdi.';
comment on column public.programs.feed_checked_at is
  'Feed''in en son ne zaman hattan gecirildigi. NULL = hic denenmedi.';

alter table public.programs drop constraint if exists programs_feed_ingestable_non_negative;
alter table public.programs add constraint programs_feed_ingestable_non_negative
  check (feed_ingestable_count is null or feed_ingestable_count >= 0);

-- Olcum yapildiysa TARIHI de olmali: tarihsiz bir sayi, ne zamana ait
-- oldugu bilinmedigi icin bayatladigini kimseye soylemez.
alter table public.programs drop constraint if exists programs_feed_count_needs_check_time;
alter table public.programs add constraint programs_feed_count_needs_check_time
  check ((feed_ingestable_count is null) = (feed_checked_at is null));

-- 'manual_required': feed'i bir insanin panodan bulmasi gerekiyor.
alter table public.programs drop constraint if exists programs_feed_access_vocab;
alter table public.programs add constraint programs_feed_access_vocab
  check (feed_access in ('unverified','credentials_required','unsupported_transport',
                         'manual_required','verified'));

-- --- 2) Alison: olcum yaziliyor -------------------------------------------
update public.programs
   set currency              = 'USD',
       network_item_count    = 5594,
       feed_ingestable_count = 0,
       feed_checked_at       = now(),
       last_verified_at      = now(),
       terms = coalesce(terms || ' | ', '') ||
         'OLCUM (07/09/2026, gercek feed dosyasi, aga cikilmadan): gzip, 5594 '
         'satir, merchant_id 120101, data_feed_id 111515, para birimi USD. '
         'HATTAN GECEN URUN: 0 -- feed''in butun fiyat sutunlari bos '
         '(display_price her satirda "USD0.00"); Alison ucretsiz cevrimici '
         'kurs saglayicisi. ean/product_GTIN/mpn/brand_name da bos. '
         'last_updated her satirda bos. KAYNAK ACILMADI: acilsaydi her turda '
         '5594 satir reddedilir, katalog bos kalirdi.'
 where network = 'awin' and network_program_id = '120101';

-- Magazanin para birimi de artik OLCULDU. Ulke zaten US idi; bu, kaynak
-- acildiginda fiyatlarin hangi para biriminde okunacagini sabitler.
update public.merchants
   set notes = coalesce(notes || ' | ', '') ||
         'Feed olcumu: para birimi USD (feed''in currency sutunundan, 5594 '
         'satirin tamami). Feed''de fiyat YOK -- hattan gecen urun 0.'
 where slug = 'alison';

-- --- 3) Back to the Office: pazar, ulke ve ana sayfa ----------------------
update public.programs
   set country_code     = 'GB',
       market_code      = 'UK',
       last_verified_at = now(),
       terms = coalesce(terms || ' | ', '') ||
         'Awin advertiser dizini (CSV, 07/09/2026): primaryRegion GB, '
         'cookieLength 30, feedEnabled yes, displayUrl '
         'https://www.backtotheoffice.co.uk/. Komisyon dizinde 0-0 -- bu '
         '"sifir komisyon" degil "yayinlanmamis" demektir (ayni satirda lead '
         'degerleri de 0), bu yuzden sartlar dogrulanmis SAYILMIYOR.'
 where network = 'awin' and network_program_id = '61655';

update public.merchants
   set country_code       = 'GB',
       homepage_url       = 'https://www.backtotheoffice.co.uk/',
       cookie_window_days = 30,
       countries          = array['GB']::char(2)[],
       notes = coalesce(notes || ' | ', '') ||
         'Awin advertiser dizini (07/09/2026): bolge GB, cerez 30 gun, feed '
         'var, ana sayfa https://www.backtotheoffice.co.uk/. Cerez 1 gunluk '
         'sema varsayilanindan 30''a cekildi -- 1''de kalsaydi tiklamadan 24 '
         'saat sonraki her donusum sessizce reddedilirdi. KOMISYON hâlâ '
         'bildirilmedi (dizinde 0-0 = yayinlanmamis).'
 where slug = 'back-to-the-office';

-- --- 4) WANAYOU: sartlar biliniyor, feed bilinmiyor -----------------------
insert into public.merchants (
  slug, display_name, country_code, countries,
  network, network_advertiser_id, status, application_status,
  default_commission_rate, cookie_window_days,
  deeplink_template, notes
) values (
  'wanayou', 'WANAYOU', 'US', array['US']::char(2)[],
  'awin', '127939', 'prospect', 'not_started',
  0.1000, 30,
  'https://www.awin1.com/cread.php'
  '?awinmid=127939'
  '&awinaffid=3074081'
  '&clickref={subid}'
  '&ued={url_encoded}',
  'Awin panosu (07/09/2026): MID 127939, komisyon %10, cerez 30 gun, ABD '
  'pazari, AOV 18-30 USD. FEED ID, FEED ADRESI VE URUN SAYISI BILDIRILMEDI '
  've kesfedilemedi: advertiser dizini CSV''sinde 127939 yok, Awin API''sine '
  'bu ortamda cikilamiyor. Ana sayfa da bildirilmedi. Katilim/onay BEYAN '
  'EDILMEDI.'
)
on conflict (slug) do nothing;

insert into public.programs (
  network, network_program_id, merchant_name,
  country_code, market_code, commission_rate, cookie_window_days,
  feed_access, application_state, last_verified_at, terms
) values (
  'awin', '127939', 'WANAYOU',
  'US', 'US', 0.1000, 30,
  'manual_required', 'DISCOVERED', now(),
  'Awin panosu (07/09/2026): komisyon %10, cerez 30 gun, ABD pazari, AOV '
  '18-30 USD. Feed ID/adres/urun sayisi BILDIRILMEDI. Dizin CSV''sinde '
  '(66 advertiser) 127939 YOK; Awin API''sine cikilamiyor. Feed''i bir '
  'insanin panodan bulmasi gerekiyor -- kimlik uydurmak, sonraki turda bos '
  'bir indirme denemesi yapip hatayi Awin''e yiktirmak olurdu.'
)
on conflict (network, network_program_id) do nothing;

insert into public.merchant_network_links (
  merchant_id, network, network_program_id, program_id,
  tracking_id, deeplink_template, commission_rate, cookie_window_days,
  is_primary, is_enabled
)
select m.id, 'awin', '127939', p.id,
       '3074081', m.deeplink_template, 0.1000, 30, true, true
  from public.merchants m
  join public.programs  p on p.network = 'awin' and p.network_program_id = '127939'
 where m.slug = 'wanayou'
on conflict (network, network_program_id) do nothing;

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  a record; b record; w record;
  v_sayi integer;
begin
  select * into a from public.programs where network='awin' and network_program_id='120101';
  select * into b from public.programs where network='awin' and network_program_id='61655';
  select * into w from public.programs where network='awin' and network_program_id='127939';

  if a is null or b is null or w is null then
    raise exception 'DOGRULAMA 1: uc program kaydindan biri yok.';
  end if;

  -- 2) ALISON: para birimi OLCULDU (cikarim degil) ve feed'den 0 urun geciyor.
  if a.currency is distinct from 'USD' then
    raise exception 'DOGRULAMA 2a: Alison para birimi USD olmali, bulunan %.', a.currency;
  end if;
  if a.feed_ingestable_count is distinct from 0 then
    raise exception 'DOGRULAMA 2b: Alison hattan gecen urun sayisi 0 olmali, bulunan %.',
      a.feed_ingestable_count;
  end if;

  -- 3) AGIN IDDIASI ILE BIZIM OLCUMUMUZ AYRI SUTUNLARDA DURUYOR. Tek sutuna
  --    cokertilseydi "5.594 urun" ile "0 urun" ayni hucrede yarisirdi.
  if a.network_item_count is distinct from 5594 then
    raise exception 'DOGRULAMA 3: agin bildirdigi sayi kaybolmus (%).', a.network_item_count;
  end if;

  -- 4) OLCUM TARIHSIZ OLAMAZ: tarihsiz bir sayi bayatladigini soylemez.
  begin
    update public.programs set feed_checked_at = null
     where network='awin' and network_program_id='120101';
    raise exception 'DOGRULAMA 4: olcum tarihi silinebildi.';
  exception when check_violation then null;
  end;

  -- 5) FEED'DEN URUN GECMEDIGI ICIN KAYNAK ACILMADI.
  select count(*) into v_sayi
    from public.sources s join public.merchants m on m.id = s.merchant_id
   where m.network_advertiser_id in ('120101','66494','61655','127939');
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 5: dogrulanmamis feed icin % kaynak acilmis.', v_sayi;
  end if;

  -- 6) ...ve dolayisiyla urun/fiyat da uretilmedi.
  select count(*) into v_sayi
    from public.products p join public.merchants m on m.id = p.merchant_id
   where m.network_advertiser_id in ('120101','66494','61655','127939');
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 6: gercek feed verisi olmadan % urun uretilmis.', v_sayi;
  end if;

  -- 7) BACK TO THE OFFICE: pazar bosluğu kapandi.
  if b.country_code is distinct from 'GB' or b.market_code is distinct from 'UK' then
    raise exception 'DOGRULAMA 7: BTO pazari yazilmamis (ulke=%, pazar=%).',
      b.country_code, b.market_code;
  end if;
  if (select homepage_url from public.merchants where slug='back-to-the-office') is null then
    raise exception 'DOGRULAMA 7b: BTO ana sayfasi yazilmamis.';
  end if;

  -- 8) ...ama KOMISYON dizinde 0-0 idi ve bu "yayinlanmamis" demek: sartlar
  --    dogrulanmis SAYILMIYOR ve magaza yayina alinamiyor.
  if (select terms_verified_at from public.merchants where slug='back-to-the-office')
     is not null then
    raise exception 'DOGRULAMA 8: yayinlanmamis komisyon dogrulanmis sayilmis.';
  end if;

  -- 9) WANAYOU: feed UYDURULMADI.
  if w.network_feed_id is not null or w.feed_url is not null
     or w.product_count is not null or w.network_item_count is not null then
    raise exception 'DOGRULAMA 9: WANAYOU icin bildirilmeyen feed verisi uydurulmus.';
  end if;
  if w.feed_access <> 'manual_required' then
    raise exception 'DOGRULAMA 9b: WANAYOU feed erisimi manual_required olmali, bulunan %.',
      w.feed_access;
  end if;

  -- 10) WANAYOU'nun BILDIRILEN sartlari yazildi.
  if w.commission_rate is distinct from 0.1000 or w.cookie_window_days is distinct from 30 then
    raise exception 'DOGRULAMA 10: WANAYOU sartlari yanlis (%, %).',
      w.commission_rate, w.cookie_window_days;
  end if;

  -- 11) HICBIRI 'verified' DEGIL: hicbirini bu ortamda indiremedik.
  select count(*) into v_sayi from public.programs
   where network='awin' and network_program_id in ('120101','66494','61655','127939')
     and feed_access = 'verified';
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 11: indirilemeyen % feed ''verified'' isaretlenmis.', v_sayi;
  end if;

  raise notice
    'Feed olcumu yazildi: Alison USD/5594 satir/0 gecen (feed''de fiyat yok), '
    'BTO pazari GB/UK, WANAYOU manual_required. Kaynak acilmadi, urun uretilmedi.';
end $$;
