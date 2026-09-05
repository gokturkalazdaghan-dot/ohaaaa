-- ============================================================================
-- AWIN ADVERTISER KISA LİSTESİ — 20 firma, yalnızca KANITLANMIŞ alanlarla
-- ----------------------------------------------------------------------------
-- Bu göç veri yazar, şema değiştirmez. Yazdığı her alanın bir kanıtı vardır;
-- kanıtı olmayan hiçbir alan doldurulmamıştır.
--
-- ELİMİZDE OLAN KANIT (tamamı bu kadar):
--   1) Firma adı — Awin advertiser listesinde göründüğü hâliyle.
--   2) Ağ — Awin.
--   3) Bizim önceliklendirme sıra numaramız.
--   4) İlk 10 firma için: BAŞVURUNUN GÖNDERİLDİĞİ (operatör beyanı).
--
-- ELİMİZDE OLMAYAN, BU YÜZDEN NULL BIRAKILAN:
--   awinmid (network_advertiser_id), komisyon oranı/tipi, çerez penceresi,
--   feed adresi, feed biçimi, kabul edilen ülkeler, trafik kısıtları,
--   onay/ret kararı, karar tarihi, başvuru tarihi, ana sayfa adresi.
--
-- BU ALANLARIN HİÇBİRİ TAHMİN EDİLMEDİ. Özellikle üçü açıklama hak ediyor:
--
--   • ÜLKE. Firma adlarının bir kısmı ülke eki taşıyor ("Worten PT",
--     "HUMANIC DE"). Bu ek, ADIN parçasıdır; programın kabul ettiği
--     ülkelerin listesi DEĞİLDİR -- bir Alman advertiser'ı Avusturya'ya da
--     satış yapıyor olabilir, ya da yalnızca Almanya'ya. Addan ülke türetmek
--     çıkarımdır, kanıt değil. `country_code` ve `countries` NULL kaldı.
--
--   • SIRA NUMARASI MID DEĞİLDİR. Listedeki 3, 11, 15... sayıları bizim
--     önceliğimizdir. `network_advertiser_id` sütununa yazılsalardı deeplink
--     şablonuna geçer ve TÜM trafik yanlış advertiser'a giderdi. Bu yüzden
--     ayrı sütunda (`partner_rank`) duruyorlar.
--
--   • BAŞVURU TARİHİ. Başvuruların gönderildiğini biliyoruz, NE ZAMAN
--     gönderildiğini bilmiyoruz. `application_submitted_at` NULL bırakıldı;
--     "yaklaşık bugün" yazmak, sonradan gerçek sanılacak bir tarih üretirdi.
--     Şema bunu zorlamıyor: yalnızca ONAY ve RET tarih ister (çünkü onlar
--     ağdan gelen, tarihi kayıtlı olaylardır).
--
-- HEPSİ `prospect`. Onay kanıtımız yok; "başvuru gönderildi" ile "ortak
-- olduk" farklı şeylerdir ve bu göç ikincisini iddia etmez. `status` ancak
-- ağdan gelen karar kaydedildiğinde ilerler.
--
-- YENİDEN ÇALIŞTIRILABİLİR: `on conflict (slug) do nothing`. Aynı firma iki
-- kez yazılmaz; elle güncellenmiş bir satır bu göçün tekrarıyla EZİLMEZ.
-- ============================================================================

insert into public.merchants
  (slug, display_name, network, status, partner_rank, application_status, notes)
values
  -- --- BAŞVURUSU GÖNDERİLMİŞ ON FİRMA ---------------------------------------
  -- `submitted`: başvurunun GÖNDERİLDİĞİ operatör tarafından beyan edildi.
  -- Ağın kararı hakkında hiçbir şey söylemez; onay/ret alanları boş.
  ('avant-skincare',            'Avant Skincare',            'awin', 'prospect',  3, 'submitted', 'Awin advertiser kisa listesi. Basvuru gonderildi (operator beyani); onay/ret karari, MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('best-direct-uk',            'Best Direct UK',            'awin', 'prospect', 11, 'submitted', 'Awin advertiser kisa listesi. Basvuru gonderildi (operator beyani); onay/ret karari, MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('paco-perfumerias-es',       'Paco Perfumerias ES',       'awin', 'prospect', 15, 'submitted', 'Awin advertiser kisa listesi. Basvuru gonderildi (operator beyani); onay/ret karari, MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('worten-pt',                 'Worten PT',                 'awin', 'prospect', 30, 'submitted', 'Awin advertiser kisa listesi. Basvuru gonderildi (operator beyani); onay/ret karari, MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('humanic-de',                'HUMANIC DE',                'awin', 'prospect', 33, 'submitted', 'Awin advertiser kisa listesi. Basvuru gonderildi (operator beyani); onay/ret karari, MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('aosom-uk',                  'Aosom UK',                  'awin', 'prospect', 45, 'submitted', 'Awin advertiser kisa listesi. Basvuru gonderildi (operator beyani); onay/ret karari, MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('grade-mobile',              'Grade Mobile',              'awin', 'prospect', 49, 'submitted', 'Awin advertiser kisa listesi. Basvuru gonderildi (operator beyani); onay/ret karari, MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('schuh',                     'Schuh',                     'awin', 'prospect', 61, 'submitted', 'Awin advertiser kisa listesi. Basvuru gonderildi (operator beyani); onay/ret karari, MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('miin-cosmetics-es',         'MiiN Cosmetics ES',         'awin', 'prospect', 62, 'submitted', 'Awin advertiser kisa listesi. Basvuru gonderildi (operator beyani); onay/ret karari, MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('sharkninja-uk',             'SharkNinja UK',             'awin', 'prospect', 65, 'submitted', 'Awin advertiser kisa listesi. Basvuru gonderildi (operator beyani); onay/ret karari, MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),

  -- --- İKİNCİ DALGA: HENÜZ BAŞVURULMADI -------------------------------------
  -- `not_started`: bu bir iddia değil, iddianın YOKLUĞUDUR. Başvurulduğuna
  -- dair kanıt olmadığı için "gönderildi" yazılmadı.
  ('viovet',                    'Viovet',                    'awin', 'prospect', 14, 'not_started', 'Awin advertiser kisa listesi, ikinci dalga. Basvuru YAPILMADI; MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('joe-nimble-de',             'Joe Nimble DE',             'awin', 'prospect', 16, 'not_started', 'Awin advertiser kisa listesi, ikinci dalga. Basvuru YAPILMADI; MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('the-knitting-network',      'The Knitting Network',      'awin', 'prospect', 17, 'not_started', 'Awin advertiser kisa listesi, ikinci dalga. Basvuru YAPILMADI; MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('panda-london',              'Panda London',              'awin', 'prospect', 24, 'not_started', 'Awin advertiser kisa listesi, ikinci dalga. Basvuru YAPILMADI; MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('paper-high',                'Paper High',                'awin', 'prospect', 25, 'not_started', 'Awin advertiser kisa listesi, ikinci dalga. Basvuru YAPILMADI; MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('make-my-blinds',            'Make My Blinds',            'awin', 'prospect', 28, 'not_started', 'Awin advertiser kisa listesi, ikinci dalga. Basvuru YAPILMADI; MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('red-gorilla-international', 'Red Gorilla International', 'awin', 'prospect', 29, 'not_started', 'Awin advertiser kisa listesi, ikinci dalga. Basvuru YAPILMADI; MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('velivery-de',               'Velivery DE',               'awin', 'prospect', 52, 'not_started', 'Awin advertiser kisa listesi, ikinci dalga. Basvuru YAPILMADI; MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('prive-by-zalando-es',       'Privé by Zalando ES',       'awin', 'prospect', 58, 'not_started', 'Awin advertiser kisa listesi, ikinci dalga. Basvuru YAPILMADI; MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.'),
  ('interflora',                'Interflora',                'awin', 'prospect', 59, 'not_started', 'Awin advertiser kisa listesi, ikinci dalga. Basvuru YAPILMADI; MID, komisyon, cerez penceresi ve feed bilgisi BILINMIYOR.')
on conflict (slug) do nothing;


-- ---------------------------------------------------------------------------
-- KENDİ KENDİNİ DOĞRULAYAN KONTROL
-- ---------------------------------------------------------------------------
-- Bu blok, göçün sessizce yanlış bir şey yazmadığını KANITLAR. Yorum
-- yalanlayabilir; iddia yalanlayamaz.
do $$
declare
  v_toplam    int;
  v_gonderilen int;
  v_kirli     text;
begin
  select count(*) into v_toplam
    from public.merchants where network = 'awin' and partner_rank is not null;

  if v_toplam <> 20 then
    raise exception 'BASARISIZ: 20 advertiser bekleniyordu, % bulundu', v_toplam;
  end if;

  select count(*) into v_gonderilen
    from public.merchants
   where partner_rank is not null and application_status = 'submitted';

  if v_gonderilen <> 10 then
    raise exception 'BASARISIZ: 10 gonderilmis basvuru bekleniyordu, % bulundu', v_gonderilen;
  end if;

  /*
   * EN ÖNEMLİ İDDİA: hiçbir satır, elimizde olmayan bir bilgiyi taşımıyor.
   * Bu kontrol olmadan, ileride biri "eksik alanları dolduralım" diye
   * varsayılan değerler yazabilir ve kimse fark etmezdi.
   */
  select string_agg(slug, ', ') into v_kirli
    from public.merchants
   where partner_rank is not null
     and (network_advertiser_id is not null
       or country_code          is not null
       or countries             is not null
       or homepage_url          is not null
       or approved_at           is not null
       or rejected_at           is not null
       or terms_verified_at     is not null
       or deeplink_template     is not null
       or traffic_restrictions  is not null);

  if v_kirli is not null then
    raise exception
      'BASARISIZ: su advertiser satirlari KANITI OLMAYAN alan tasiyor: %', v_kirli;
  end if;

  -- Sıra numarası MID'e sızmış olabilir mi? Ayrı ve açık kontrol.
  if exists (
    select 1 from public.merchants
     where partner_rank is not null
       and network_advertiser_id = partner_rank::text
  ) then
    raise exception 'BASARISIZ: sira numarasi network_advertiser_id sutununa yazilmis';
  end if;

  raise notice
    '✓ % Awin advertiser adayi kaydedildi (% basvuru gonderildi, % baslanmadi); '
    'MID/komisyon/cerez/feed/ulke alanlari BOS -- kaniti yok.',
    v_toplam, v_gonderilen, v_toplam - v_gonderilen;
end $$;
