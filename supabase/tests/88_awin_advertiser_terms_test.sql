-- ============================================================================
-- DİZİN VERİSİ YAZILDI — AMA YALNIZCA O
-- ----------------------------------------------------------------------------
-- 20260905120000 göçü Awin advertiser dizininden gelen program künyesini
-- yazar. Bu dosyanın işi iki yönlü:
--
--   1. Yazılması GEREKENLER gerçekten yazıldı mı (MID, ana sayfa, ülke,
--      çerez penceresi, doğrulanmış komisyon).
--   2. Yazılmaması GEREKENLER gerçekten yazılmadı mı (başvuru durumu,
--      onay/ret tarihleri, mağaza durumu).
--
-- İkincisi olmadan test bir şey kanıtlamaz: her alanı dolduran bir göç de
-- birinci grubu geçerdi ve elimizde olmayan bir onayı kaydetmiş olurdu.
-- ============================================================================

begin;
select plan(18);

-- --- 1) Yirmisi de eşleşti -------------------------------------------------

select is(
  (select count(*)::int from public.merchants
    where partner_rank is not null and network_advertiser_id is not null),
  20,
  '1) 20 advertiser''in tamami Awin MID ile eslesti'
);

select is(
  (select count(distinct network_advertiser_id)::int from public.merchants
    where partner_rank is not null),
  20,
  '2) MID''ler BENZERSIZ -- iki firma ayni advertiser''a baglanmadi'
);

-- Örnekleme yerine birkaç MID birebir sınanıyor: sayı doğru olup eşleşme
-- yanlış olabilirdi (hepsi aynı satıra yazılsaydı sayı yine 20 çıkardı).
select is((select network_advertiser_id from public.merchants where slug = 'schuh'),
  '2044', '3) Schuh -> MID 2044');
select is((select network_advertiser_id from public.merchants where slug = 'interflora'),
  '1969', '4) Interflora -> MID 1969');
select is((select network_advertiser_id from public.merchants where slug = 'paco-perfumerias-es'),
  '116991', '5) Paco Perfumerias ES -> MID 116991 (alti haneli)');

-- --- 2) Ana sayfa ve ülke ---------------------------------------------------

select is(
  (select count(*)::int from public.merchants
    where partner_rank is not null and (homepage_url is null or country_code is null)),
  0,
  '6) hicbir advertiser ana sayfasiz ya da ulkesiz kalmadi'
);

/*
 * ÜLKE ARTIK KANITA DAYANIYOR. Önceki göç 'TR' varsayılanını kaldırmıştı
 * çünkü adlardaki "DE/PT/ES" ekinden ülke türetmek çıkarımdır. Şimdi değer
 * dizinden geliyor.
 */
select is((select country_code from public.merchants where slug = 'worten-pt'),
  'PT'::char(2), '7) Worten PT -> PT');
select is((select country_code from public.merchants where slug = 'humanic-de'),
  'DE'::char(2), '8) HUMANIC DE -> DE');

-- --- 3) ÇEREZ PENCERESİ -----------------------------------------------------

/*
 * EN PAHALI İDDİA. Sütunun şema varsayılanı 1 gündür ve `record_conversion`
 * pencereyi aşan dönüşümleri REDDEDER. Varsayılanla yayına alınan bir
 * program, ikinci günden sonraki her dönüşümü sessizce kaybederdi.
 */
select is(
  (select count(*)::int from public.merchants
    where partner_rank is not null and cookie_window_days = 1),
  0,
  '9) HICBIRI 1 gunluk varsayilan cerez penceresinde kalmadi'
);

select is((select cookie_window_days from public.merchants where slug = 'worten-pt'),
  7, '10) Worten PT -> 7 gun (dizindeki en kisa pencere)');
select is((select cookie_window_days from public.merchants where slug = 'panda-london'),
  28, '11) Panda London -> 28 gun');
select is((select cookie_window_days from public.merchants where slug = 'avant-skincare'),
  45, '12) Avant Skincare -> 45 gun');
select is((select cookie_window_days from public.merchants where slug = 'humanic-de'),
  60, '13) HUMANIC DE -> 60 gun');

/*
 * Bu iddia bir RAPOR HATASINI kilitliyor. Göçü hazırlayan ilk özet Joe
 * Nimble DE icin 60 gun yazmisti; dizindeki deger 30. Rapor yanlisti, dosya
 * dogruydu. Yanlis bir 60, gercek 30 gunluk pencerenin otesindeki
 * donusumleri kabul edilir sanmamiza yol acardi.
 */
select is((select cookie_window_days from public.merchants where slug = 'joe-nimble-de'),
  30, '14) Joe Nimble DE -> 30 gun (60 DEGIL -- dizin boyle diyor)');

-- --- 4) Komisyon: 14 doğrulandı, 6 doğrulanmadı -----------------------------

select is(
  (select count(*)::int from public.merchants
    where partner_rank is not null and terms_verified_at is not null),
  14,
  '15) 14 firmanin sartlari dogrulandi'
);

/*
 * ALTISI ADIYLA SINANIYOR. Yalnızca sayıya bakmak, yanlış altılının
 * doğrulanmamış kalmasını fark etmezdi. Dizinde `commissionMin/Max = 0/0`
 * "%0 komisyon" değil "yayınlanmamış" demektir.
 */
select is(
  (select string_agg(slug, ', ' order by slug) from public.merchants
    where partner_rank is not null and terms_verified_at is null),
  'grade-mobile, miin-cosmetics-es, paco-perfumerias-es, paper-high, red-gorilla-international, worten-pt',
  '16) komisyonu yayinlanmamis ALTI firma adiyla dogrulanmamis kaldi'
);

-- --- 5) DOKUNULMAMASI GEREKENLERE DOKUNULMADI -------------------------------

/*
 * BU DOSYANIN ASIL SEBEBİ.
 *
 * Dizin hangi programların VAR OLDUĞUNU söyler; bizim başvurumuzun
 * onaylandığını SÖYLEMEZ -- dosyada üyelik sütunu yok. Bir göçün program
 * künyesini yazarken ilişkinin durumunu da yazması, elimizde olmayan bir
 * onayı kaydetmek olurdu ve bu, sonraki her kararı (feed iste, yayına al)
 * yanlış temele oturturdu.
 */
select is(
  (select count(*)::int from public.merchants
    where partner_rank is not null
      and (approved_at is not null or rejected_at is not null or status <> 'prospect')),
  0,
  '17) onay/ret tarihi yazilmadi ve 20 kayit da ADAY (prospect) kaldi'
);

select is(
  (select string_agg(application_status::text || '=' || adet::text, ' ' order by application_status::text)
     from (select application_status, count(*) as adet
             from public.merchants where partner_rank is not null
            group by application_status) s),
  'not_started=10 submitted=10',
  '18) basvuru durumlari degismedi: 10 gonderildi, 10 baslanmadi'
);

select * from finish();
rollback;
