-- ===========================================================================
-- Alison (Awin MID 120101): dogrulanmis program + magaza kaydi
-- ===========================================================================
--
-- Hesap sahibi Awin panosundan tek bir advertiser icin BUTUN sart setini
-- bildirdi:
--
--   Alison            MID 120101
--   Komisyon          %20
--   Cerez             30 gun
--   Urun sayisi       5594   (Awin dizininin saydigi -- BIZIM katalogumuz degil)
--   Pazar             US / CA
--   Ana sayfa         https://alison.com/
--
-- Bu, depodaki ilk advertiser kaydi ki elimizde AYNI ANDA MID, komisyon,
-- cerez, ulke ve ana sayfa var. Yani `merchants` uzerindeki dort yayin
-- kapisinin (template, terms_verified_at, country_code, homepage_url) HEPSI
-- karsilanabilir durumda. Yine de yayina ALINMIYOR; nedeni asagida.
--
-- ---------------------------------------------------------------------------
-- BILGI IKI TABLOYA BOLUNUYOR -- CUNKU IKI FARKLI SEY
-- ---------------------------------------------------------------------------
--
-- `programs`  agin dizininde GORDUGUMUZ sey. Kesif katmani burayi yazar,
--             puanlar, bayatlatir. `product_count` burada yasar: 5594, Awin'in
--             o programda saydigi urun sayisidir. Bizim `products` tablomuz
--             hakkinda hicbir sey soylemez ve bu goc oraya tek satir yazmaz.
--
-- `merchants` ORTAKLIK kaydimiz: deeplink sablonu, cerez penceresi,
--             dogrulanmis sartlar. Tiklama ve donusum buraya bakar.
--
-- Ikisini tek tabloya cokertmek, "dizinde 5594 urun var" ile "katalogumuzda
-- 5594 urun var" arasindaki farki silerdi -- ve o fark, gelir raporunun
-- dogru ya da uydurma olmasidir.
--
-- Baglantiyi `merchant_network_links` kuruyor. `programs.merchant_id`
-- KULLANILAMAZ: `programs_merchant_only_after_approval` kisiti o sutunu
-- yalnizca APPROVED/REJECTED programlar icin aciyor ve Alison icin bir onay
-- BEYAN EDILMEDI.
--
-- ---------------------------------------------------------------------------
-- NEDEN 'prospect' -- BUTUN KAPILAR ACILABILIRKEN
-- ---------------------------------------------------------------------------
--
-- Iki ayri sebep, ikisi de tek basina yeterli:
--
--   1. BASVURU ONAY DEGILDIR. Komisyon, cerez ve MID Awin dizininde
--      programa KATILMADAN da gorulur. Hesap sahibi bir katilim ya da onay
--      bildirmedi. `application_status` 'not_started' kaliyor.
--
--   2. FEED ADRESI YOK. Adres olmadan `sources` satiri acilamaz
--      (endpoint_url NOT NULL), kaynak olmadan urun girmez. Yayina alinmis
--      ama tek teklifi olmayan bir magaza, arama sonucunda gorunur ve her
--      tiklamayi bos bir sayfaya yollardi.
--
-- 5594 sayisi bunu DEGISTIRMEZ. O sayi Awin'in deposunda; bizimkinde
-- karsiligi sifir. Sayiyi katalog dolulugu gibi okumak, tam olarak bu gocun
-- engellemeye calistigi hata.
--
-- ---------------------------------------------------------------------------
-- terms_verified_at DOLDURULUYOR -- ILK KEZ YENI BIR KAYIT ICIN
-- ---------------------------------------------------------------------------
--
-- Sutunun tanimi: "Komisyon orani ve cerez penceresi programin gercek
-- sartlariyla dogrulandiginda doldurulur." Ikisi de bildirildi; ikisi de
-- sema varsayilanindan (%3 / 1 gun) farkli. Ravin'de doldurmamistik cunku
-- orada YALNIZCA cerez vardi, komisyon yoktu.
--
-- Bu isaret bir yayin izni degil, bir kanit isaretidir: yayin icin kalan
-- kapi onay ve feed.
--
-- ---------------------------------------------------------------------------
-- US/CA: ULKE BIR, PAZAR IKI
-- ---------------------------------------------------------------------------
--
-- `merchants.country_code` ve `programs.country_code` tekildir; programin
-- MERKEZI ulkesi US. Kabul edilen ulkelerin TAMAMI icin sema zaten bir yer
-- ayirmis: `merchants.countries` ('Programin kabul ettigi ulkeler'). Oraya
-- {US,CA} yaziliyor. Yeni bir sutun ya da ikinci bir program satiri
-- acilmadi -- (network, network_program_id) tekil, MID 120101 tek program.
--
-- YAZILMAYANLAR
--   currency              Bildirilmedi. US'in varsayilan para birimi USD ama
--                         bu CIKARIM olurdu; komisyonun hangi para biriminde
--                         odendigi soylenmedi. NULL kaliyor.
--   feed adresi           Uydurulmadi.
--   partner_rank          Bizim onceliklendirme siramiz; ag verisi degil.
--   score                 Puanlama isi `programs_due_for_scoring` uzerinden
--                         calisir; elle puan yazmak o siranin anlamini bozar.
-- ===========================================================================

-- --- 1) Program: agin dizininde gordugumuz sey -----------------------------
insert into public.programs (
  network, network_program_id, merchant_name, homepage_url,
  country_code, market_code, commission_rate, cookie_window_days,
  product_count, application_state, last_verified_at, terms
) values (
  'awin', '120101', 'Alison', 'https://alison.com/',
  'US', 'US', 0.2000, 30,
  5594, 'DISCOVERED', now(),
  'Awin panosu (07/09/2026, hesap sahibi bildirimi): komisyon %20, cerez 30 '
  'gun, dizinde 5594 urun, pazar US/CA. Feed adresi bildirilmedi. Katilim/onay '
  'BEYAN EDILMEDI -- dizinde gorulen sartlar programa kabul edilmis olmak '
  'degildir.'
)
on conflict (network, network_program_id) do nothing;

-- --- 2) Magaza: ortaklik kaydimiz ------------------------------------------
insert into public.merchants (
  slug, display_name, homepage_url, country_code, countries,
  network, network_advertiser_id, status, application_status,
  default_commission_rate, cookie_window_days, terms_verified_at,
  deeplink_template, notes
) values (
  'alison', 'Alison', 'https://alison.com/', 'US', array['US','CA']::char(2)[],
  'awin', '120101', 'prospect', 'not_started',
  0.2000, 30, now(),
  'https://www.awin1.com/cread.php'
  '?awinmid=120101'
  '&awinaffid=3074081'
  '&clickref={subid}'
  '&ued={url_encoded}',
  'Awin panosu (07/09/2026): MID 120101, komisyon %20, cerez 30 gun, pazar '
  'US/CA, ana sayfa https://alison.com/. Sartlar dogrulandi (komisyon VE '
  'cerez bildirildi). YAYINDA DEGIL: (a) katilim/onay beyan edilmedi, '
  '(b) feed adresi yok -- kaynaksiz magaza tek teklif gostermez. Awin '
  'dizini 5594 urun sayiyor; bizim katalogumuzda 0 -- bu sayi programs '
  'tablosunda, urun tablosunda degil.'
)
on conflict (slug) do nothing;

-- --- 3) Magaza <-> ag programi bagi ----------------------------------------
insert into public.merchant_network_links (
  merchant_id, network, network_program_id, program_id,
  tracking_id, deeplink_template, commission_rate, cookie_window_days,
  is_primary, is_enabled
)
select m.id, 'awin', '120101', p.id,
       '3074081', m.deeplink_template, 0.2000, 30,
       true, true
  from public.merchants m
  join public.programs  p on p.network = 'awin' and p.network_program_id = '120101'
 where m.slug = 'alison'
on conflict (network, network_program_id) do nothing;

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  m record;
  p record;
  l record;
  v_sayi integer;
begin
  select * into m from public.merchants where slug = 'alison';
  select * into p from public.programs  where network = 'awin' and network_program_id = '120101';
  select * into l from public.merchant_network_links
   where network = 'awin' and network_program_id = '120101';

  if m is null or p is null or l is null then
    raise exception 'DOGRULAMA 1: magaza/program/bag ucundan biri yazilmadi.';
  end if;

  -- 2) MID her uc kayitta da AYNI. Ayrisirlarsa tiklama bir programa,
  --    mutabakat baskasina bakar.
  if m.network_advertiser_id <> '120101'
     or p.network_program_id <> '120101'
     or l.network_program_id <> '120101' then
    raise exception 'DOGRULAMA 2: MID kayitlar arasinda ayristi.';
  end if;

  -- 3) SARTLAR: %20 ve 30 gun. Cerez sema varsayilaninda (1 gun) kalsaydi
  --    tiklamadan 24 saat sonraki her donusum sessizce reddedilirdi.
  if m.default_commission_rate <> 0.2000 or m.cookie_window_days <> 30 then
    raise exception 'DOGRULAMA 3: sartlar yanlis (komisyon=%, cerez=%).',
      m.default_commission_rate, m.cookie_window_days;
  end if;

  -- 4) Sartlar dogrulanmis isaretli -- komisyon VE cerez bildirildigi icin.
  if m.terms_verified_at is null then
    raise exception 'DOGRULAMA 4: komisyon ve cerez bilinirken sart dogrulama isareti konmamis.';
  end if;

  -- 5) ONAY UYDURULMADI. Dizinde sart gormek, programa kabul edilmek degildir.
  if m.application_status <> 'not_started' or m.approved_at is not null
     or p.application_state <> 'DISCOVERED' then
    raise exception 'DOGRULAMA 5: onay beyan edilmeden onayli gosterilmis '
      '(magaza=%, program=%).', m.application_status, p.application_state;
  end if;

  -- 6) YAYINDA DEGIL. Butun kapilar acilabilir durumda oldugu icin bu, kod
  --    degil KARAR: onay yok, feed yok.
  if m.status <> 'prospect' then
    raise exception 'DOGRULAMA 6: onaysiz ve feed''siz magaza yayina alinmis (%).', m.status;
  end if;

  -- 7) FEED ADRESI UYDURULMADI: kaynak yok, dolayisiyla urun de yok.
  select count(*) into v_sayi from public.sources where merchant_id = m.id;
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 7: adres bildirilmeden % kaynak acilmis.', v_sayi;
  end if;

  select count(*) into v_sayi from public.products where merchant_id = m.id;
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 8: feed yokken % urun yazilmis -- 5594 AWIN''in '
      'sayisi, bizim katalogumuzun degil.', v_sayi;
  end if;

  -- 9) 5594 PROGRAM SATIRINDA, urun tablosunda degil.
  if p.product_count <> 5594 then
    raise exception 'DOGRULAMA 9: dizin urun sayisi 5594 olmali, bulunan %.',
      p.product_count;
  end if;

  -- 10) US/CA: merkez ulke US, kabul edilen ulkeler {US,CA}.
  if m.country_code is distinct from 'US'
     or m.countries is distinct from array['US','CA']::char(2)[] then
    raise exception 'DOGRULAMA 10: pazar kaybedildi (ulke=%, ulkeler=%).',
      m.country_code, m.countries;
  end if;

  -- 11) PARA BIRIMI CIKARILMADI. US -> USD bir varsayimdir; bildirilmedi.
  if p.currency is not null then
    raise exception 'DOGRULAMA 11: bildirilmeyen para birimi cikarimla yazilmis (%).',
      p.currency;
  end if;

  -- 12) SABLON: kendi MID'ini SABIT tasiyor, cozulmemis yer tutucu yok,
  --     hedef awin1.com. Yer tutucu kalsaydi link uretilir, tiklama
  --     kaydedilir ve komisyon sessizce kaybolurdu.
  if position('awinmid=120101' in coalesce(m.deeplink_template, '')) = 0 then
    raise exception 'DOGRULAMA 12a: sablon kendi MID''ini tasimiyor.';
  end if;
  if m.deeplink_template ~ '\{(?!url\}|url_encoded\}|tracking_id\}|subid\})[a-z_]+\}' then
    raise exception 'DOGRULAMA 12b: sablonda desteklenmeyen yer tutucu var.';
  end if;
  if position('https://www.awin1.com/cread.php' in m.deeplink_template) <> 1 then
    raise exception 'DOGRULAMA 12c: sablon awin1.com disina isaret ediyor.';
  end if;

  -- 13) BAG programa gercekten bagli ve BIRINCIL.
  if l.merchant_id <> m.id or l.program_id is distinct from p.id
     or not l.is_primary or not l.is_enabled then
    raise exception 'DOGRULAMA 13: magaza-program bagi eksik ya da birincil degil.';
  end if;

  -- 14) DIZINDEN DOGRULANAN 14 FIRMA DEVRALINMADI. Alison kendi kanitiyla
  --     geldi; 20260905120000'in doldurdugu kume degismedi.
  select count(*) into v_sayi
    from public.merchants
   where network = 'awin' and terms_verified_at is not null and partner_rank is not null;
  if v_sayi <> 14 then
    raise exception 'DOGRULAMA 14: dizinden dogrulanan firma sayisi 14 olmali, bulunan %.',
      v_sayi;
  end if;

  raise notice
    'Alison yazildi: program (MID 120101, dizinde 5594 urun) + magaza (%%20 '
    'komisyon, 30 gun cerez, US/CA) + birincil ag bagi. Sartlar dogrulandi; '
    'YAYINDA DEGIL -- onay beyan edilmedi ve feed adresi yok.';
end $$;
