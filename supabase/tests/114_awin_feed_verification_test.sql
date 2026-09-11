-- ===========================================================================
-- Feed dogrulama: AGIN IDDIASI ile BIZIM OLCUMUMUZ ayri duruyor mu?
-- ===========================================================================
--
-- Alison feed'i 5.594 satir bildiriyor ve hattan 0 urun geciriyor: butun
-- fiyat sutunlari bos (feed ucretsiz kurs katalogu). Bu iki sayinin AYNI
-- HUCREDE yarismamasi, kaynak acma kararinin dogru sayiya bakmasini saglar.
-- ===========================================================================
begin;
select plan(11);

-- --- 1-3: UC AYRI SAYI, UC AYRI ANLAM -------------------------------------
select is(
  (select network_item_count from public.programs
    where network='awin' and network_program_id='120101'),
  5594, '1) agin bildirdigi kalem sayisi korunuyor');

select is(
  (select feed_ingestable_count from public.programs
    where network='awin' and network_program_id='120101'),
  0, '2) hattan GECEN urun sayisi 0 -- feed''de fiyat yok');

select is(
  (select count(*)::int from public.products p
     join public.merchants m on m.id = p.merchant_id where m.slug='alison'),
  0, '3) katalogumuzda Alison urunu yok');

-- --- 4: PARA BIRIMI OLCULDU, CIKARILMADI ----------------------------------
-- 20260907340000 Alison''in para birimini BILEREK bos birakmisti (US -> USD
-- bir cikarim olurdu). Simdi feed''in kendi `currency` sutunundan geldi:
-- 5.594 satirin tamami USD.
select is(
  (select currency from public.programs
    where network='awin' and network_program_id='120101'),
  'USD'::char(3), '4) para birimi feed''den OLCULDU');

-- --- 5: OLCUM TARIHSIZ OLAMAZ ---------------------------------------------
-- Tarihsiz bir sayi, ne zamana ait oldugu bilinmedigi icin bayatladigini
-- kimseye soylemez.
select throws_ok(
  $$ update public.programs set feed_checked_at = null
      where network='awin' and network_program_id='120101' $$,
  '23514', null,
  '5) olcum sayisi tarihsiz birakilamiyor');

-- --- 6-7: KAYNAK VE URUN URETILMEDI ---------------------------------------
-- Feed''den urun gecmiyorsa kaynak acmak, her turda 5.594 satir reddedip
-- hata sayacini doldurmak demektir.
select is(
  (select count(*)::int from public.sources s
     join public.merchants m on m.id = s.merchant_id
    where m.network_advertiser_id in ('120101','66494','61655','127939')),
  0, '6) dogrulanmamis feed icin kaynak acilmadi');

-- FIXTURE DEGISTI (07/09/2026): uc feed artik GERCEKTEN indirilebiliyor
-- (http=200, application/gzip; 5 / 5.594 / 116.417 satir). Iddianin anlami
-- ayni kaldi -- INDIRILEMEYEN feed 'verified' isaretlenmez -- ve hâlâ
-- indirilemeyen tek advertiser'a tasindi: WANAYOU'nun feed'i yok.
select is(
  (select count(*)::int from public.programs
    where network='awin' and network_program_id = '127939'
      and feed_access='verified'),
  0, '7) indirilemeyen feed ''verified'' isaretlenmedi');

-- --- 8-9: BACK TO THE OFFICE ----------------------------------------------
-- Pazar bosluğu dizinden kapandi: kaynak acmanin onundeki market/currency
-- engeli artik veri eksikligi degil.
select is(
  (select country_code || '/' || market_code from public.programs
    where network='awin' and network_program_id='61655'),
  'GB/UK', '8) BTO pazari dizinden yazildi');

-- Dizinde komisyon 0-0 idi: bu "sifir komisyon" degil "YAYINLANMAMIS"
-- demektir. Sifir sayip dogrulanmis isaretlemek, yayin kapisini sessizce
-- acardi.
select is(
  (select terms_verified_at from public.merchants where slug='back-to-the-office'),
  null, '9) yayinlanmamis komisyon dogrulanmis sayilmadi');

-- --- 10-11: WANAYOU -------------------------------------------------------
-- Sartlari biliniyor, feed'i bilinmiyor. Kimlik uydurmak, sonraki turda bos
-- bir indirme denemesi yapip hatayi Awin'e yiktirmak olurdu.
select is(
  (select coalesce(network_feed_id,'-') || '/' || coalesce(feed_url,'-')
     || '/' || coalesce(network_item_count::text,'-')
     from public.programs where network='awin' and network_program_id='127939'),
  '-/-/-', '10) WANAYOU feed verisi uydurulmadi');

select is(
  (select feed_access || '/' || commission_rate::text from public.programs
    where network='awin' and network_program_id='127939'),
  'manual_required/0.1000',
  '11) WANAYOU manual_required; BILDIRILEN komisyon ise yazildi');

select * from finish();
rollback;
