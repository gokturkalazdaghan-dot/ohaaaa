-- ============================================================================
-- AWIN ADVERTISER DİZİNİ — doğrulanmış program künyeleri
-- ----------------------------------------------------------------------------
-- 20260905110000 göçü 20 advertiser'ı yalnızca ad, ağ ve öncelik sırasıyla
-- kaydetmişti; MID, ana sayfa, ülke, komisyon ve çerez penceresi BOŞ
-- bırakılmıştı çünkü elimizde kanıt yoktu ve uydurmak yasaktı.
--
-- KANIT ARTIK VAR: Awin'in kendi advertiser dizini, hesap sahibi tarafından
-- dışa aktarıldı (66 advertiser). Birincil kaynak -- üçüncü taraf bir özet
-- ya da arama sonucu değil. Bu göç, o dosyadaki YAPISAL alanları yazar.
--
-- NE YAZILIR, NE YAZILMAZ
--
--   yazılır : advertiserId → network_advertiser_id
--             displayUrl   → homepage_url
--             primaryRegion→ country_code
--             cookieLength → cookie_window_days
--             commissionMin→ default_commission_rate   (yalnızca 14 firma)
--             terms_verified_at                        (yalnızca 14 firma)
--
--   YAZILMAZ: application_status, application_submitted_at, approved_at,
--             rejected_at, status, deeplink_template, partner_rank,
--             feed/kaynak bilgisi.
--
-- Sebep: dizin hangi programların VAR OLDUĞUNU söyler; bizim başvurumuzun
-- onaylanıp onaylanmadığını SÖYLEMEZ. Dosyada üyelik/katılım sütunu yok.
-- Onay alanlarına dokunmak, elimizde olmayan bir bilgiyi kaydetmek olurdu.
--
-- ---------------------------------------------------------------------------
-- KOMİSYON: 20'nin 14'ü. Altısı bilerek boş.
-- ---------------------------------------------------------------------------
-- Dizinde `commissionMin/Max = 0/0` "%0 komisyon" DEĞİL, "yayınlanmamış"
-- demektir. Altı firma (paco-perfumerias-es, worten-pt, grade-mobile,
-- miin-cosmetics-es, paper-high, red-gorilla-international) bu durumda ve
-- oranları NULL kalıyor; `default_commission_rate` sütununun şema
-- varsayılanı (%3) onlar için bir İDDİA DEĞİL, dokunulmamış bir varsayılan
-- olarak duruyor ve `terms_verified_at` NULL kaldığı için türetme katmanı
-- onu "doğrulanmadı" gösteriyor.
--
-- AÇIKLAMA METNİNDEN KOMİSYON ÇEKİLMEDİ. Dizindeki serbest metin ile
-- yapısal alan ÇELİŞİYOR: Grade Mobile açıklaması "4% commission" diyor
-- ama yapısal alanı boş; Philip Jones "12.5%" diyor, alanı boş; Schuh
-- "3% full price, 2% sale" diyor, alanı 2-6. Pazarlama metni bir sözleşme
-- değildir; yalnızca yapısal alan kullanıldı.
--
-- ARALIKLARDA ALT SINIR ALINDI (Schuh 2-6 → %2; Aosom 5-10 → %5;
-- The Knitting Network 5-10 → %5; Viovet 2-6 → %2). Bu sütun ürün bazlı
-- oranla ezilen bir VARSAYILANDIR; üst sınırı varsayılan yapmak beklenen
-- geliri sistematik olarak şişirir ve yanlış önceliklendirmeye yol açar.
-- Alt sınır da dizinde yayınlanmış gerçek bir değerdir, tahmin değil.
--
-- ---------------------------------------------------------------------------
-- ÇEREZ PENCERESİ: bu göçün en pahalı düzeltmesi
-- ---------------------------------------------------------------------------
-- Sütunun şema varsayılanı 1 GÜN ve `record_conversion` pencereyi aşan
-- dönüşümleri REDDEDER. Gerçek değerler: 7 (Worten PT), 28 (Panda London),
-- 30 (on altı firma), 45 (Avant Skincare), 60 (HUMANIC DE).
--
-- Yani yirmi firmanın HİÇBİRİ 1 gün değil. Doğrulanmamış varsayılanla
-- yayına alınsalardı ikinci günden sonraki her dönüşüm sessizce çöpe
-- giderdi -- kod hatası olmadan, hiçbir yerde hata görünmeden.
--
-- BİR DÜZELTME KAYDA GEÇİYOR: bu göçü hazırlayan ilk raporda Joe Nimble DE
-- için 60 gün yazılmıştı. Dizindeki değer 30. Rapor yanlıştı, dosya doğru;
-- 60 gün taşıyan üç advertiser var ve Joe Nimble onlardan değil. Yazılan
-- değer dosyadan gelir.
--
-- GERİ ALINABİLİRLİK: göç yalnızca UPDATE yapar; hiçbir sütun, kısıt ya da
-- satır düşürmez. Yeniden çalıştırılabilir -- `terms_verified_at` için
-- `coalesce` kullanıldığı için ilk doğrulama anı korunur, her koşuda
-- tazelenmez.
-- ============================================================================

update public.merchants as m
set
  network_advertiser_id   = v.mid,
  homepage_url            = v.homepage,
  country_code            = v.ulke,
  cookie_window_days      = v.cerez,
  -- Yayınlanmamışsa (NULL) mevcut değer KORUNUR; sıfırlanmaz.
  default_commission_rate = coalesce(v.oran, m.default_commission_rate),
  -- İlk doğrulama anı korunur: göç tekrar çalışırsa tarih tazelenmez.
  terms_verified_at       = case
                              when v.oran is null then m.terms_verified_at
                              else coalesce(m.terms_verified_at, now())
                            end
from (values
  -- slug,                        mid,      homepage,                              ülke, çerez, oran
  ('avant-skincare',            '19244',  'https://www.avant-skincare.com/en/',    'GB',  45, 0.0900),
  ('best-direct-uk',            '19319',  'https://www.bestdirect.co.uk/',         'GB',  30, 0.0500),
  ('paco-perfumerias-es',       '116991', 'http://www.pacoperfumerias.com/',       'ES',  30, null),
  ('worten-pt',                 '99897',  'https://www.worten.pt/',                'PT',   7, null),
  ('humanic-de',                '13635',  'https://www.humanic.net',               'DE',  60, 0.0900),
  ('aosom-uk',                  '17151',  'https://www.aosom.co.uk/',              'GB',  30, 0.0500),
  ('grade-mobile',              '22069',  'https://grademobile.co.uk/',            'GB',  30, null),
  ('schuh',                     '2044',   'https://www.schuh.co.uk',               'GB',  30, 0.0200),
  ('miin-cosmetics-es',         '22802',  'https://miin-cosmetics.com/',           'ES',  30, null),
  ('sharkninja-uk',             '8059',   'https://www.sharkninja.co.uk/',         'GB',  30, 0.0500),
  ('viovet',                    '6960',   'https://www.viovet.co.uk',              'GB',  30, 0.0200),
  ('joe-nimble-de',             '11321',  'https://www.joe-nimble.com',            'DE',  30, 0.1000),
  ('the-knitting-network',      '18657',  'https://www.theknittingnetwork.co.uk/', 'GB',  30, 0.0500),
  ('panda-london',              '16638',  'https://pandalondon.com',               'GB',  28, 0.0500),
  ('paper-high',                '22799',  'https://www.paperhigh.com/',            'GB',  30, null),
  ('make-my-blinds',            '19309',  'https://www.makemyblinds.co.uk/',       'GB',  30, 0.0500),
  ('red-gorilla-international', '56439',  'https://www.redgorilla.red/',           'GB',  30, null),
  ('velivery-de',               '15953',  'https://www.velivery.com/de/',          'DE',  30, 0.0800),
  ('prive-by-zalando-es',       '15573',  'https://www.zalando-prive.es/',         'ES',  30, 0.0400),
  ('interflora',                '1969',   'https://www.interflora.co.uk',          'GB',  30, 0.0600)
) as v(slug, mid, homepage, ulke, cerez, oran)
where m.slug = v.slug::citext;


-- ---------------------------------------------------------------------------
-- KENDİ KENDİNİ DOĞRULAYAN KONTROL
-- ---------------------------------------------------------------------------
-- Yorum yalan söyleyebilir; iddia söyleyemez. Bu blok yanılıyorsa göç düşer.
do $$
declare
  v_eslesen   int;
  v_dogrulanan int;
  v_eksik     text;
begin
  -- 1) YİRMİSİ DE EŞLEŞMELİ. Bir slug tutmazsa göç TAMAMLANMIŞ SAYILMAZ.
  select count(*) into v_eslesen
    from public.merchants
   where partner_rank is not null and network_advertiser_id is not null;

  if v_eslesen <> 20 then
    raise exception 'BASARISIZ: 20 advertiser MID ile eslesmeliydi, % eslesti', v_eslesen;
  end if;

  -- 2) Hiçbir zorunlu alan boş kalmamalı.
  select string_agg(slug, ', ') into v_eksik
    from public.merchants
   where partner_rank is not null
     and (homepage_url is null or country_code is null or cookie_window_days is null);

  if v_eksik is not null then
    raise exception 'BASARISIZ: su kayitlarda ana sayfa/ulke/cerez eksik: %', v_eksik;
  end if;

  -- 3) HİÇBİRİ VARSAYILAN 1 GÜNDE KALMAMALI -- göçün asıl sebebi buydu.
  select string_agg(slug, ', ') into v_eksik
    from public.merchants
   where partner_rank is not null and cookie_window_days = 1;

  if v_eksik is not null then
    raise exception 'BASARISIZ: su kayitlar hala 1 gunluk varsayilan cerezde: %', v_eksik;
  end if;

  -- 4) Tam olarak 14 firma doğrulanmış şart taşımalı.
  select count(*) into v_dogrulanan
    from public.merchants
   where partner_rank is not null and terms_verified_at is not null;

  if v_dogrulanan <> 14 then
    raise exception
      'BASARISIZ: 14 dogrulanmis sart bekleniyordu, % bulundu', v_dogrulanan;
  end if;

  -- 5) Altısı komisyon açısından DOĞRULANMAMIŞ kalmalı -- adlarıyla.
  select string_agg(slug, ', ' order by slug) into v_eksik
    from public.merchants
   where partner_rank is not null and terms_verified_at is null;

  if v_eksik <> 'grade-mobile, miin-cosmetics-es, paco-perfumerias-es, paper-high, red-gorilla-international, worten-pt' then
    raise exception 'BASARISIZ: dogrulanmamis komisyon listesi beklenenden farkli: %', v_eksik;
  end if;

  -- 6) BAŞVURU VE ONAY ALANLARINA DOKUNULMADI.
  --    Bu göç program KÜNYESİNİ yazar; ilişkinin durumunu değil.
  if exists (select 1 from public.merchants
              where partner_rank is not null
                and (approved_at is not null or rejected_at is not null
                     or status <> 'prospect')) then
    raise exception 'BASARISIZ: bu goc onay/durum alanlarina dokunmus olamaz';
  end if;

  select count(*) into v_eslesen
    from public.merchants
   where partner_rank is not null and application_status = 'submitted';

  if v_eslesen <> 10 then
    raise exception
      'BASARISIZ: 10 gonderilmis basvuru korunmaliydi, % bulundu', v_eslesen;
  end if;

  raise notice
    '✓ 20 advertiser dizin verisiyle eslesti; % firma sartlari dogrulandi, '
    '% firma komisyonsuz (yayinlanmamis). Basvuru/onay alanlari degismedi.',
    v_dogrulanan, 20 - v_dogrulanan;
end $$;
