-- ============================================================================
-- ORTAKLIK BAŞVURU YÖNETİMİ
-- ----------------------------------------------------------------------------
-- Buradaki iddiaların ortak teması tek bir cümledir:
--
--   BİLİNMEYEN BİR ŞEY, BİLİNİYORMUŞ GİBİ KAYDEDİLEMEZ.
--
-- Şema bir aday firmanın ana sayfasını ve ülkesini bilmemeyi KABUL etmeli
-- (yoksa uydurmaya zorlar), ama o firma aday olmaktan çıktığı anda ikisini
-- de ZORUNLU kılmalı (yoksa boşluk kalıcılaşır). Aşağıdaki testler bu
-- kapının iki yönde de çalıştığını kanıtlar: yalnızca "reddediyor" demek
-- yetmez, "doğru şeyi kabul ediyor" da kanıtlanmalıdır -- aksi halde her
-- şeyi reddeden bir kısıt da testi geçerdi.
-- ============================================================================

begin;
select plan(26);

-- --- Sütunlar ve türler -----------------------------------------------------

select has_column('public', 'merchants', 'application_status',
  '1) application_status sutunu var');
select col_type_is('public', 'merchants', 'application_status', 'application_status',
  '2) application_status enum -- serbest metin degil');
select col_default_is('public', 'merchants', 'application_status', 'not_started',
  '3) varsayilan not_started -- mevcut satirlar bir IDDIA kazanmaz');

select has_column('public', 'merchants', 'network_advertiser_id',
  '4) network_advertiser_id sutunu var');
select has_column('public', 'merchants', 'terms_verified_at',
  '5) terms_verified_at sutunu var');
select has_column('public', 'merchants', 'partner_rank',
  '6) partner_rank sutunu var');
select col_type_is('public', 'merchants', 'countries', 'character(2)[]',
  '7) countries ulke kodu dizisi');

-- --- Aday: bilinmeyen alanlar boş kalabilir ---------------------------------

/*
 * BU TESTİN VARLIK SEBEBİ. `homepage_url` NOT NULL kaldığı sürece, henüz
 * başvurmadığımız bir firmayı kaydetmenin TEK yolu bir adres uydurmaktı.
 * Uydurulmuş adres, sonradan gerçek sanılır.
 */
select lives_ok(
  $$ insert into public.merchants (slug, display_name, network, status)
     values ('aday-bilinmeyen', 'Aday Firma', 'awin', 'prospect') $$,
  '8) ADAY firma ana sayfasi ve ulkesi BILINMEDEN kaydedilebilir'
);

select is(
  (select homepage_url from public.merchants where slug = 'aday-bilinmeyen'),
  null,
  '9) bilinmeyen ana sayfa NULL olarak duruyor -- uydurulmus bir deger degil'
);

select is(
  (select country_code from public.merchants where slug = 'aday-bilinmeyen'),
  null,
  '10) ulke kodu VARSAYILAN TR ile doldurulmuyor -- Ingiliz bir firma TR olamaz'
);

-- --- Aday olmaktan çıkınca zorunlu ------------------------------------------

/*
 * HER İDDİA TEK BİR KISITI SINAR.
 *
 * İlk yazılışta bu üç kontrol tek bir `awin` satırı üzerinden yapılıyordu
 * ve ikisi YANLIŞ SEBEPLE düşüyordu: PostgreSQL kısıtları belirli bir
 * sırayla değerlendirmez, o satırda önce `merchants_awin_known_needs_mid`
 * yakalanıyordu. Yani "ana sayfa kapısı çalışıyor" diye okunan test aslında
 * MID kapısını ölçüyordu -- ana sayfa kısıtı tamamen kaldırılsa bile yeşil
 * kalırdı.
 *
 * Bu yüzden ana sayfa/ülke kapıları `direct` bir mağazada sınanıyor (MID
 * kısıtı orada hiç devreye girmez), MID kapısı ayrı bir `awin` satırında.
 */
insert into public.merchants (slug, display_name, network, status)
values ('aday-dogrudan', 'Aday Dogrudan', 'direct', 'prospect');

-- Ülke veriliyor, ana sayfa verilmiyor: düşmesi gereken TEK kısıt kalıyor.
select throws_ok(
  $$ update public.merchants set status = 'pending', country_code = 'TR'
      where slug = 'aday-dogrudan' $$,
  '23514',
  'new row for relation "merchants" violates check constraint "merchants_known_needs_homepage"',
  '11) ana sayfa bilinmeden aday olmaktan CIKILAMAZ'
);

select throws_ok(
  $$ update public.merchants
        set status = 'pending', homepage_url = 'https://aday.gecersiz'
      where slug = 'aday-dogrudan' $$,
  '23514',
  'new row for relation "merchants" violates check constraint "merchants_known_needs_country"',
  '12) ulke bilinmeden aday olmaktan CIKILAMAZ'
);

-- --- Awin MID kapısı --------------------------------------------------------

/*
 * Awin yönlendirmesi advertiser kimliği olmadan üretilemez. MID'siz bir
 * Awin mağazasını yayına yaklaştırmak, üretilemeyecek bir linki
 * üretilebilirmiş gibi kaydetmektir.
 *
 * Ana sayfa ve ülke bilerek DOLDURULUYOR: aksi halde bu iddia da onların
 * kısıtlarına takılır ve MID kapısı hiç sınanmamış olurdu.
 */
select throws_ok(
  $$ update public.merchants
        set status = 'pending', homepage_url = 'https://aday.gecersiz',
            country_code = 'GB'
      where slug = 'aday-bilinmeyen' $$,
  '23514',
  'new row for relation "merchants" violates check constraint "merchants_awin_known_needs_mid"',
  '13) Awin magazasi MID BILINMEDEN aday olmaktan CIKAMAZ'
);

select lives_ok(
  $$ update public.merchants
        set status = 'pending', homepage_url = 'https://aday.gecersiz',
            country_code = 'GB', network_advertiser_id = '123456'
      where slug = 'aday-bilinmeyen' $$,
  '14) uc bilgi de bilindiginde gecis KABUL EDILIR'
);

/*
 * Sıra numarası ile MID'in karışması, TÜM trafiğin yanlış advertiser'a
 * gitmesi demektir. Rakam olmayan bir değer (firma adı, "MID-3") yazma
 * anında düşer.
 */
select throws_ok(
  $$ update public.merchants set network_advertiser_id = 'awinmid-3'
      where slug = 'aday-bilinmeyen' $$,
  '23514',
  'new row for relation "merchants" violates check constraint "merchants_advertiser_id_numeric"',
  '15) MID sutununa rakam disi deger YAZILAMAZ'
);

-- --- Karar tarihleri --------------------------------------------------------

select throws_ok(
  $$ update public.merchants set application_status = 'approved'
      where slug = 'aday-bilinmeyen' $$,
  '23514',
  'new row for relation "merchants" violates check constraint "merchants_decision_needs_date"',
  '16) TARIHSIZ "onaylandi" kaydedilemez -- kanitsiz iddia'
);

select throws_ok(
  $$ update public.merchants set application_status = 'rejected'
      where slug = 'aday-bilinmeyen' $$,
  '23514',
  'new row for relation "merchants" violates check constraint "merchants_decision_needs_date"',
  '17) TARIHSIZ "reddedildi" kaydedilemez'
);

-- Ters yön: karar verilmemişken karar tarihi taşınamaz.
select throws_ok(
  $$ update public.merchants set approved_at = now()
      where slug = 'aday-bilinmeyen' $$,
  '23514',
  'new row for relation "merchants" violates check constraint "merchants_dates_match_decision"',
  '18) basvuru onaylanmamisken onay tarihi TASINAMAZ'
);

select lives_ok(
  $$ update public.merchants
        set application_status = 'approved', approved_at = now()
      where slug = 'aday-bilinmeyen' $$,
  '19) tarihiyle birlikte onay KABUL EDILIR'
);

-- Karar, gönderimden önce olamaz.
select throws_ok(
  $$ update public.merchants
        set application_submitted_at = now() + interval '10 days'
      where slug = 'aday-bilinmeyen' $$,
  '23514',
  'new row for relation "merchants" violates check constraint "merchants_decision_after_submission"',
  '20) karar tarihi gonderim tarihinden ONCE olamaz'
);

-- --- Yayına alma, doğrulanmış şart ister ------------------------------------

/*
 * `cookie_window_days` varsayılanı 1 gündür ve GERÇEKTEN OKUNUR:
 * `record_conversion` pencereyi aşan dönüşümleri reddeder. Gerçek pencere
 * 30 günse, doğrulanmamış varsayılanla yayına alınan bir program 29 günlük
 * dönüşümü sessizce çöpe atar. Bu, kod hatası olmadan gerçekleşen bir
 * gelir kaybıdır; kapı bu yüzden şemada.
 */
select throws_ok(
  $$ update public.merchants
        set status = 'active',
            deeplink_template = 'https://aday.gecersiz/g?u={url}'
      where slug = 'aday-bilinmeyen' $$,
  '23514',
  'new row for relation "merchants" violates check constraint "merchants_active_needs_verified_terms"',
  '21) sartlari DOGRULANMAMIS bir magaza yayina alinamaz'
);

select lives_ok(
  $$ update public.merchants
        set status = 'active',
            deeplink_template = 'https://aday.gecersiz/g?u={url}',
            terms_verified_at = now()
      where slug = 'aday-bilinmeyen' $$,
  '22) sartlar dogrulandiginda yayina alma KABUL EDILIR'
);

-- --- Sıra numarası benzersiz ------------------------------------------------

select lives_ok(
  $$ update public.merchants set partner_rank = 7 where slug = 'aday-bilinmeyen' $$,
  '23) sira numarasi atanabilir'
);

select throws_ok(
  $$ insert into public.merchants (slug, display_name, network, status, partner_rank)
     values ('aday-ikinci', 'Ikinci Aday', 'awin', 'prospect', 7) $$,
  '23505',
  null,
  '24) ayni sira numarasi iki firmaya VERILEMEZ'
);

-- --- İstemciye kapalı -------------------------------------------------------

/*
 * Hangi firmaya başvurduğumuz, hangisinin bizi reddettiği ve öncelik
 * sıramız işletme bilgisidir. `merchants` tablosunun anon'a AÇIK olduğu
 * (aktif satırlar için) unutulursa bu bilgi vitrine sızardı; sütun bazlı
 * yetki o kapıyı kapalı tutuyor.
 */
select is(
  (select bool_or(has_column_privilege('anon', 'public.merchants', s, 'select'))
     from unnest(array['application_status', 'network_advertiser_id',
                       'partner_rank', 'traffic_restrictions',
                       'approved_at', 'rejected_at']) as s),
  false,
  '25) ortaklik alanlarinin HICBIRI anon''a acik degil'
);

select is(
  (select bool_or(has_column_privilege('authenticated', 'public.merchants', s, 'select'))
     from unnest(array['application_status', 'network_advertiser_id',
                       'partner_rank', 'traffic_restrictions',
                       'approved_at', 'rejected_at']) as s),
  false,
  '26) ortaklik alanlarinin HICBIRI authenticated''a acik degil'
);

select * from finish();
rollback;
