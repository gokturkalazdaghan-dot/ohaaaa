-- ===========================================================================
-- Alison (Awin MID 120101): kayit dogru yerlere bolundu mu?
-- ===========================================================================
--
-- Bu dosyanin sinadigi tek fikir sudur: 5594 SAYISI AWIN'IN, BIZIM DEGIL.
--
-- Hesap sahibi Alison icin butun sart setini bildirdi -- MID, komisyon,
-- cerez, ulke, ana sayfa -- ve dizinin saydigi 5594 urunu. Bu, deponun
-- yayin kapilarini (template + terms_verified_at + country_code +
-- homepage_url) AYNI ANDA karsilayabilen ilk advertiser'i.
--
-- Tam da bu yuzden tehlikeli: kapilarin acilabilir olmasi, acilmasi
-- gerektigi anlamina gelmez. Onay beyan edilmedi ve feed adresi yok. Yayina
-- alinmis, tek teklifi olmayan bir magaza arama sonucunda gorunur ve her
-- tiklamayi bos sayfaya yollar.
-- ===========================================================================
begin;
select plan(13);

-- --- 1-3: BILGI IKI TABLOYA BOLUNDU ---------------------------------------

select is(
  (select product_count from public.programs
    where network = 'awin' and network_program_id = '120101'),
  5594,
  '1) dizin urun sayisi programs tablosunda');

select is(
  (select count(*)::int from public.products p
     join public.merchants m on m.id = p.merchant_id
    where m.slug = 'alison'),
  0,
  '2) katalogumuzda Alison urunu YOK -- 5594 Awin''in sayisi');

select is(
  (select count(*)::int from public.sources s
     join public.merchants m on m.id = s.merchant_id
    where m.slug = 'alison'),
  0,
  '3) feed adresi bildirilmedigi icin kaynak acilmadi');

-- --- 4-6: SARTLAR ----------------------------------------------------------

select is(
  (select default_commission_rate from public.merchants where slug = 'alison'),
  0.2000::numeric(5,4),
  '4) komisyon %20');

/*
 * CEREZ, SEMA VARSAYILANI 1 GUNDE KALMADI. Kalsaydi tiklamadan 24 saat
 * sonra gelen her donusum `record_conversion` tarafindan sessizce
 * reddedilirdi -- kod hatasi olmadan, log'da iz birakmadan.
 */
select is(
  (select cookie_window_days from public.merchants where slug = 'alison'),
  30,
  '5) cerez penceresi 30 gun -- 1 gunluk varsayilanda kalmadi');

select isnt(
  (select terms_verified_at from public.merchants where slug = 'alison'),
  null,
  '6) komisyon VE cerez bilindigi icin sartlar dogrulanmis isaretli');

-- --- 7-8: DOGRULANMIS SART, YAYIN IZNI DEGILDIR ---------------------------

select is(
  (select status::text from public.merchants where slug = 'alison'),
  'prospect',
  '7) sartlar dogrulanmis olsa da magaza yayinda degil');

select is(
  (select application_status::text || '/' || (approved_at is null)::text
     from public.merchants where slug = 'alison'),
  'not_started/true',
  '8) onay uydurulmadi -- dizinde sart gormek kabul edilmek degildir');

-- --- 9: PAZAR KAYBEDILMEDI -------------------------------------------------
-- country_code tekildir; US/CA'nin ikinci yarisi `countries` dizisinde
-- yasiyor ('Programin kabul ettigi ulkeler'). Yalnizca country_code
-- yazilsaydi CA sessizce dusserdi.
select is(
  (select country_code || ':' || array_to_string(countries, ',')
     from public.merchants where slug = 'alison'),
  'US:US,CA',
  '9) merkez ulke US, kabul edilen ulkeler US+CA');

/*
 * 10) PARA BIRIMI ARTIK DOLU -- CIKARIMLA DEGIL, OLCUMLE.
 *
 * Bu iddia once `currency IS NULL` diyordu ve o zaman DOGRUYDU: US'in
 * varsayilan para birimi USD olmasi, Alison'in USD ile odedigini gostermez;
 * countries.default_currency'den turetmek CIKARIMDIR.
 *
 * 20260907390000 degeri gercek feed dosyasindan olctu: 5.594 satirin
 * tamaminda `currency` sutunu USD. Iddia zayiflamadi, KANITA KAVUSTU --
 * ve asagidaki ikinci yari kuralin kendisini koruyor: para birimi ancak bir
 * OLCUMLE BIRLIKTE yazilabilir.
 */
select is(
  (select currency from public.programs
    where network = 'awin' and network_program_id = '120101'),
  'USD'::char(3),
  '10) para birimi feed olcumunden geldi');

-- Kural: dolu bir para birimi, yaninda olcum tarihi OLMADAN duramaz. Boylece
-- ileride biri "US ise USD'dir" deyip elle doldurursa bu iddia duser.
select isnt(
  (select feed_checked_at from public.programs
    where network = 'awin' and network_program_id = '120101'),
  null,
  '10b) para birimi bir OLCUME dayaniyor -- cikarimla doldurulamaz');

-- --- 11: BAG PROGRAMA GERCEKTEN BAGLI -------------------------------------
-- `programs.merchant_id` KULLANILAMAZDI: programs_merchant_only_after_approval
-- o sutunu yalnizca APPROVED/REJECTED icin aciyor. Bag merchant_network_links
-- uzerinden kuruluyor.
select is(
  (select (l.merchant_id = m.id and l.program_id = p.id and l.is_primary)
     from public.merchant_network_links l
     join public.merchants m on m.slug = 'alison'
     join public.programs  p on p.network = 'awin' and p.network_program_id = '120101'
    where l.network = 'awin' and l.network_program_id = '120101'),
  true,
  '11) magaza birincil bagla programa bagli');

-- --- 12: SABLONDA COZULMEMIS YER TUTUCU YOK -------------------------------
-- buildAffiliateUrl {awinmid} cozmez. Kalsaydi link uretilir, tiklama
-- kaydedilir ve komisyon sessizce kaybolurdu.
select is(
  (select (position('awinmid=120101' in deeplink_template) > 0
           and deeplink_template !~ '\{(?!url\}|url_encoded\}|tracking_id\}|subid\})[a-z_]+\}')
     from public.merchants where slug = 'alison'),
  true,
  '12) sablon kendi MID''ini sabit tasiyor, cozulmemis yer tutucu yok');

select * from finish();
rollback;
