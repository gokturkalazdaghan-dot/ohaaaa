-- ============================================================================
-- ORTAKLIK BAŞVURU YÖNETİMİ — bir advertiser'ın bize gelene kadarki yolu
-- ----------------------------------------------------------------------------
-- Bugün `merchants` tablosu yalnızca İŞLEYEN bir ortaklığı tarif edebiliyor:
-- deeplink şablonu, takip kimliği, komisyon oranı. Oysa bir advertiser bu
-- alanların hiçbirine sahip olmadan önce uzun bir yoldan geçiyor:
--
--   aday → başvuru gönderildi → onay/ret → feed adresi → alan eşleme →
--   deneme çalışması → yayın → ilk komisyon
--
-- Bu yolun neresinde olduğumuz HİÇBİR YERDE yazmıyordu. Sonuç: 60+ advertiser
-- listesi bir insanın hafızasında duruyor, hangisine başvurulduğu unutuluyor,
-- aynı firmaya iki kez başvuruluyor ya da onaylanmış bir program aylarca
-- bağlanmadan bekliyor. Kaybedilen şey doğrudan gelirdir.
--
-- BU GÖÇÜN TEMEL KURALI: BİLİNMEYEN, VARSAYILANLA DOLDURULMAZ.
--
-- Şema bugüne kadar "her mağazanın ana sayfası ve ülkesi vardır" varsayıyordu
-- (`not null`, `default 'TR'`). Bu varsayım işleyen bir ortaklık için doğru,
-- bir ADAY için yanlış: henüz başvurmadığımız bir İngiliz firmasının ana
-- sayfasını bilmiyoruz ve ülkesini 'TR' yazmak, bilmediğimiz bir şeyi
-- BİLİYORMUŞ gibi kaydetmek olur. Yanlış veri, veri yokluğundan pahalıdır:
-- yokluk fark edilir, yanlışlık edilmez.
--
-- Bu yüzden iki sütun boş bırakılabilir hale getiriliyor ve zorunlulukları
-- KOŞULA bağlanıyor — şemada zaten var olan kalıp:
--   `merchants_active_needs_template` = "aktif bir mağaza link üretebilmeli"
-- Aynı mantık: "aday olmaktan çıkmış bir mağazanın ana sayfası ve ülkesi
-- bilinmelidir."
--
-- KAPSAM DIŞI BIRAKILANLAR VE GEREKÇELERİ
--
--  1) `sources` tablosuna TEK BİR SÜTUN eklenmiyor.
--     Panelin göstereceği "Feed / Eşleme / Deneme / Yayın" durumlarının
--     hepsi ZATEN var olan alanlardan türetilebiliyor:
--       Feed    → sources.endpoint_url
--       Eşleme  → sources.field_mapping (zorunlu alanlar dolu mu)
--       Deneme  → sources.last_run_at / last_status
--       Yayın   → sources.is_enabled + merchants.status
--     Bunları ayrıca bir sütunda saklamak, iki gerçek kaynağı olan tek bir
--     olguya yol açardı; ikisi ayrıştığında hangisinin doğru olduğunu
--     kimse bilemezdi. Durum TÜRETİLİR, saklanmaz.
--
--  2) `feed_format` sütunu eklenmiyor: `sources.kind` (feed_csv/feed_xml/
--     feed_json) biçimi zaten kodluyor.
--
--  3) `feed_compression` eklenmiyor: alım hattında gzip açma desteği YOK.
--     Var olmayan bir yeteneği tarif eden sütun, yapılandırmayı kabul edip
--     çalışma anında sessizce çökmeye davetiyedir.
--
--  4) `integration_status` diye SAKLANAN bir sütun eklenmiyor — 1. maddedeki
--     gerekçenin aynısı.
--
-- MARKETPLACE TARAFINA DOKUNULMUYOR: vendors, orders, order_items,
-- products.fulfillment='marketplace' akışı bu göçün dışındadır.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Başvurunun durumu
-- ---------------------------------------------------------------------------
-- Değerler KANITA karşılık gelir, tahmine değil:
--   not_started — başvurulmadı (varsayılan; iddia içermez)
--   ready       — başvuru için gereken her şey hazır, henüz gönderilmedi
--   submitted   — başvuru GÖNDERİLDİ, ağdan karar gelmedi
--   approved    — ağ onayladı (tarih kanıtı ZORUNLU, aşağıdaki kısıt)
--   rejected    — ağ reddetti (tarih kanıtı ZORUNLU)
--   blocked     — bizden kaynaklanmayan bir engel (program kapalı, ülke dışı)
--
-- `pending` diye AYRI bir değer bilerek yok. "Gönderildi" ile "beklemede"
-- aynı olgudur; ikisini ayırmak, elimizde olmayan bir bilgiyi (ağın kaydı
-- işleme aldığı an) varmış gibi göstermeye zorlardı.
create type public.application_status as enum (
  'not_started',
  'ready',
  'submitted',
  'approved',
  'rejected',
  'blocked'
);

comment on type public.application_status is
  'Ortaklik basvurusunun durumu. Her deger bir KANITA karsilik gelir; '
  'tahmin icin deger yoktur -- bilinmiyorsa not_started kalir.';


-- ---------------------------------------------------------------------------
-- 2) merchants — başvuru ve program künyesi
-- ---------------------------------------------------------------------------
alter table public.merchants
  add column if not exists application_status public.application_status
    not null default 'not_started',

  -- Üç ayrı tarih, çünkü üç ayrı olgu. Hiçbiri diğerinden türetilemez ve
  -- hiçbiri "durum şu, demek ki tarih yaklaşık şudur" diye doldurulamaz.
  add column if not exists application_submitted_at timestamptz,
  add column if not exists approved_at              timestamptz,
  add column if not exists rejected_at              timestamptz,

  /*
   * Ağın advertiser kimliği (Awin'de "awinmid").
   *
   * BUGÜN NEREDE DURUYOR: hiçbir yerde -- yalnızca `deeplink_template`
   * metninin İÇİNDE gömülü. Yani "hangi advertiser'ın MID'i var?" sorusu
   * ancak metin araması ile cevaplanabiliyordu ve MID'i olmayan bir
   * şablon (kopyalama hatası) hiçbir yerde fark edilmiyordu.
   *
   * Ayrı sütun olması, aşağıdaki kalite kapısını mümkün kılıyor:
   * bir Awin mağazası MID'i bilinmeden aday olmaktan çıkamaz.
   */
  add column if not exists network_advertiser_id text,

  /*
   * PROGRAM ŞARTLARININ DOĞRULANDIĞI AN.
   *
   * `default_commission_rate` (%3) ve `cookie_window_days` (1 gün) ŞEMA
   * VARSAYILANIDIR -- programın gerçek şartları değil. İkisi de bir iddia
   * gibi okunabilir ve `cookie_window_days` gerçekten OKUNUR:
   * `conversion_attribution_guard`, pencerenin dışındaki dönüşümleri
   * REDDEDER. Yani doğrulanmamış bir 1 gün, 30 günlük gerçek pencereli bir
   * programda hak edilmiş komisyonu sessizce çöpe atardı.
   *
   * Bu sütun o farkı görünür kılar: NULL ise oran ve pencere birer
   * varsayılandır, doğrulanmış şart değildir. Aşağıdaki kısıt, bir mağazanın
   * bu doğrulama olmadan `active` olmasını engelliyor.
   */
  add column if not exists terms_verified_at timestamptz,

  -- Programın kabul ettiği ülkeler. NULL = BİLİNMİYOR (boş dizi ile aynı
  -- şey değildir; boş dizi "hiçbir ülke" demek olurdu).
  add column if not exists countries char(2)[],

  -- Trafik kısıtları (kupon, marka teklifi, e-posta...). NULL = bilinmiyor.
  add column if not exists traffic_restrictions text,

  /*
   * Bizim önceliklendirme sıramız.
   *
   * Ağın verdiği bir numara DEĞİLDİR ve MID ile karıştırılmamalıdır --
   * bu ayrımın kaybolması, listedeki sıra numarasının `network_advertiser_id`
   * sütununa yazılmasına ve oradan deeplink şablonuna geçip TÜM trafiğin
   * yanlış advertiser'a gitmesine yol açardı.
   */
  add column if not exists partner_rank integer;

comment on column public.merchants.network_advertiser_id is
  'Agin advertiser kimligi (Awin: awinmid). BIZIM sira numaramiz DEGILDIR '
  '-- onun icin partner_rank sutunu var.';
comment on column public.merchants.terms_verified_at is
  'Komisyon orani ve cerez penceresi programin gercek sartlariyla '
  'dogrulandiginda doldurulur. NULL ise ikisi de sema varsayilanidir.';
comment on column public.merchants.countries is
  'Programin kabul ettigi ulkeler. NULL = bilinmiyor; bos dizi ile ayni sey degil.';
comment on column public.merchants.partner_rank is
  'Bizim onceliklendirme siramiz. Aga ait bir numara degildir.';


-- ---------------------------------------------------------------------------
-- 3) "Bilinmiyor" yazılabilsin: iki NOT NULL kaldırılıyor
-- ---------------------------------------------------------------------------
-- Bu, kısıtı GEVŞETMEK değil KOŞULA BAĞLAMAKTIR; hemen aşağıda geri
-- veriliyor. Gevşeme yalnızca `status = 'prospect'` satırları için geçerli
-- ve o satırlar:
--   - anon'a görünmez (RLS: merchants_public_read_active, status = 'active')
--   - `/git/:offerId` tarafından reddedilir (merchant.status !== 'active')
--   - alım hattı tarafından okunmaz (supabaseRepository: .eq status active)
-- Yani boş bırakılan alanın okunacağı tek bir kod yolu yoktur.
alter table public.merchants alter column homepage_url drop not null;
alter table public.merchants alter column country_code drop not null;

/*
 * VARSAYILAN DA KALDIRILIYOR -- ASIL TEHLİKE BURADAYDI.
 *
 * `country_code` yalnızca NOT NULL değil, `default 'TR'` idi. NOT NULL'ı
 * kaldırmak tek başına HİÇBİR ŞEY çözmezdi: ülkesi belirtilmeden eklenen
 * bir İngiliz advertiser'ı veritabanı sessizce 'TR' yapardı ve satır,
 * sonradan bakan herkese "bu firma Türkiye'de" diye okunurdu. Boş bir alan
 * fark edilir; yanlış doldurulmuş bir alan edilmez.
 *
 * Bu, eşlik eden testin 10. iddiasıyla yakalandı: NOT NULL kalkmış olmasına
 * rağmen aday satır 'TR' taşıyordu.
 *
 * Bedeli: ülkesi belirtilmeden eklenen bir mağaza artık aday olmaktan
 * çıkamaz (yukarıdaki kısıt). Bu bir kayıp değil, kuralın kendisidir.
 */
alter table public.merchants alter column country_code drop default;

alter table public.merchants
  drop constraint if exists merchants_known_needs_homepage;
alter table public.merchants
  add constraint merchants_known_needs_homepage
  check (status = 'prospect' or homepage_url is not null);

alter table public.merchants
  drop constraint if exists merchants_known_needs_country;
alter table public.merchants
  add constraint merchants_known_needs_country
  check (status = 'prospect' or country_code is not null);


-- ---------------------------------------------------------------------------
-- 4) Kalite kapıları
-- ---------------------------------------------------------------------------

-- MID rakamdır. Bir firma adının ya da sıra numarasının bu sütuna
-- yapıştırılması yazma anında düşer, aylar sonra bozuk bir linkte değil.
alter table public.merchants
  drop constraint if exists merchants_advertiser_id_numeric;
alter table public.merchants
  add constraint merchants_advertiser_id_numeric
  check (network_advertiser_id is null or network_advertiser_id ~ '^[0-9]{1,12}$');

/*
 * Awin mağazası MID'siz aday olmaktan ÇIKAMAZ.
 *
 * Awin deeplink'i advertiser kimliği olmadan üretilemez; MID'siz bir
 * `awin` mağazasını `pending`/`active` yapmak, üretilemeyecek bir linki
 * üretilebilirmiş gibi kaydetmektir. Kapı veritabanında duruyor, çünkü
 * arayüzde durursa bir sonraki arayüz onu atlar.
 */
alter table public.merchants
  drop constraint if exists merchants_awin_known_needs_mid;
alter table public.merchants
  add constraint merchants_awin_known_needs_mid
  check (network <> 'awin' or status = 'prospect' or network_advertiser_id is not null);

/*
 * Onay ve ret birer OLAYDIR; olayın tarihi vardır.
 *
 * Tarihsiz bir "onaylandı", kaynağı olmayan bir iddiadır: kim, ne zaman,
 * neye bakarak? Çerez penceresi ve ödeme dönemi hesapları bu tarihe
 * dayanır. Tarihi zorunlu kılmak, "galiba onaylanmıştı" kaydını imkânsız
 * kılar.
 */
alter table public.merchants
  drop constraint if exists merchants_decision_needs_date;
alter table public.merchants
  add constraint merchants_decision_needs_date
  check (
    (application_status <> 'approved' or approved_at is not null) and
    (application_status <> 'rejected' or rejected_at is not null)
  );

-- Ters yön: karar verilmemişken karar tarihi taşınamaz.
alter table public.merchants
  drop constraint if exists merchants_dates_match_decision;
alter table public.merchants
  add constraint merchants_dates_match_decision
  check (
    (approved_at is null or application_status = 'approved') and
    (rejected_at is null or application_status in ('rejected', 'blocked'))
  );

/*
 * Başvurulmamış bir programdan onay gelemez.
 *
 * Sıralama kısıtı: gönderim tarihi biliniyorsa karar tarihinden önce
 * olmalıdır. Gönderim tarihi BİLİNMİYORSA (bizde olan durum) kısıt
 * sessizce geçer -- bilinmeyen bir tarih uydurmaya zorlamaz.
 */
alter table public.merchants
  drop constraint if exists merchants_decision_after_submission;
alter table public.merchants
  add constraint merchants_decision_after_submission
  check (
    application_submitted_at is null
    or (
      (approved_at is null or approved_at >= application_submitted_at) and
      (rejected_at is null or rejected_at >= application_submitted_at)
    )
  );

/*
 * AKTİF OLMAK, ŞARTLARIN DOĞRULANMIŞ OLMASINI GEREKTİRİR.
 *
 * Bu kısıt olmadan bir mağaza %3 komisyon ve 1 günlük çerez varsayılanıyla
 * yayına alınabilirdi. İkinci sayı gerçekten uygulanır (dönüşüm
 * ilişkilendirme koruması) ve gerçek pencere 30 günse, aradaki 29 günün
 * dönüşümleri REDDEDİLİR. Sessiz gelir kaybının tam tanımı budur.
 */
alter table public.merchants
  drop constraint if exists merchants_active_needs_verified_terms;
alter table public.merchants
  add constraint merchants_active_needs_verified_terms
  check (status <> 'active' or terms_verified_at is not null);

alter table public.merchants
  drop constraint if exists merchants_partner_rank_positive;
alter table public.merchants
  add constraint merchants_partner_rank_positive
  check (partner_rank is null or partner_rank > 0);

-- Aynı sıra numarası iki firmaya verilemez: liste bir ÖNCELİK sırasıdır,
-- iki firma aynı önceliğe sahipse sıra anlamını yitirir.
create unique index if not exists merchants_partner_rank_key
  on public.merchants (partner_rank) where partner_rank is not null;

-- Panelin ana sorgusu: aday olmayanları değil, HEPSİNİ sıraya göre okur.
create index if not exists merchants_partner_pipeline_idx
  on public.merchants (application_status, partner_rank);


-- ---------------------------------------------------------------------------
-- 5) YENİ SÜTUNLAR İSTEMCİYE AÇILMIYOR
-- ---------------------------------------------------------------------------
-- `merchants` üzerindeki yetki SÜTUN BAZLIDIR (20260903130000). Yani yeni
-- sütunlar kendiliğinden anon/authenticated'a açılmaz ve burada da
-- açılmıyor: hangi firmaya başvurduğumuz, hangisinin bizi reddettiği ve
-- öncelik sıramız işletme bilgisidir. Panel bunları service_role ile okur.
--
-- Bu, bir yorum değil bir İDDİA: aşağıdaki blok yanılıyorsak göçü düşürür.
do $$
declare
  gizli text[] := array[
    'application_status', 'application_submitted_at', 'approved_at',
    'rejected_at', 'network_advertiser_id', 'terms_verified_at',
    'countries', 'traffic_restrictions', 'partner_rank'
  ];
  rol   text;
  sutun text;
begin
  foreach rol in array array['anon', 'authenticated'] loop
    foreach sutun in array gizli loop
      if has_column_privilege(rol, 'public.merchants', sutun, 'select') then
        raise exception
          'BASARISIZ: % rolu merchants.% sutununu okuyabiliyor -- ortaklik bilgisi isletme sirridir',
          rol, sutun;
      end if;
    end loop;
  end loop;

  -- Ters yön: vitrinin okuduğu alanlar kapanmadı.
  if not has_column_privilege('anon', 'public.merchants', 'display_name', 'select') then
    raise exception 'BASARISIZ: vitrin magaza adini okuyamiyor';
  end if;
  if not has_column_privilege('service_role', 'public.merchants', 'partner_rank', 'select') then
    raise exception 'BASARISIZ: service_role ortaklik alanlarini okuyamiyor -- panel coker';
  end if;
end $$;
