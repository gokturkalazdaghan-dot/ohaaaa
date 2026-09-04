-- ============================================================================
-- Feed kimlik doğrulama yöntemi
-- ----------------------------------------------------------------------------
-- Sistem yalnızca ADRESE GÖMÜLÜ jetonu destekliyordu. Ortaklık ağlarının
-- önemli bir kısmı `Authorization` başlığı ister; sağlayıcı belli olduğunda
-- yöntemin desteklenmediğini keşfetmek, ilk gerçek bağlantıyı kod beklemeye
-- çevirirdi.
--
-- HİÇBİR SAĞLAYICI VARSAYILMADI. Burada ağ adı, adres ya da jeton biçimi
-- yok -- yalnızca üç taşıyıcı yöntem ve varsayılan mevcut davranış.
--
-- SÜTUNDA SIRRIN KENDİSİ DEĞİL, ADI DURUR.
-- `auth_secret_ref` bir ORTAM DEĞİŞKENİ ADI taşır ("OHAAAA_FEED_TOKEN").
-- Değeri sütuna yazmak, kimlik bilgisini veritabanında düz metin tutmak
-- olurdu: yedeklerde, panelde ve her `select *` çıktısında. Bu, adres
-- şablonunda zaten uygulanan kuralın başlıklara genişletilmiş hâli.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'source_auth_type') then
    create type public.source_auth_type as enum ('query', 'bearer', 'basic');
  end if;
end $$;

comment on type public.source_auth_type is
  'Feed kimlik bilgisinin nasil tasindigi. query = adres sablonundaki '
  '${DEGISKEN}; bearer/basic = Authorization basligi.';

/*
 * VARSAYILAN 'query': mevcut davranış. Varsayılansız bırakmak, bugünkü tek
 * kaynak biçimini yarın bir NOT NULL ihlaline çevirirdi.
 */
alter table public.sources
  add column if not exists auth_type public.source_auth_type not null default 'query';

alter table public.sources
  add column if not exists auth_secret_ref text;

comment on column public.sources.auth_secret_ref is
  'Kimlik bilgisini tasiyan ORTAM DEGISKENININ ADI -- degeri DEGIL. '
  'Deger buraya yazilirsa sir veritabaninda duz metin durur.';

/*
 * SIR SÜTUNA SIZAMAZ.
 *
 * Bu kısıt, sütunun ne için OLMADIĞINI kod dışında da söyler. Ortam
 * değişkeni adları büyük harf, rakam ve alt çizgiden oluşur; bir jeton
 * (nokta, eğik çizgi, tire, iki nokta içerir) bu kalıba UYMAZ ve
 * veritabanı onu reddeder. Yani "yanlışlıkla jetonu yapıştırdım" hatası
 * sessizce değil, yazma anında ortaya çıkar.
 */
alter table public.sources
  drop constraint if exists sources_auth_secret_ref_is_env_name;

alter table public.sources
  add constraint sources_auth_secret_ref_is_env_name
  check (
    auth_secret_ref is null
    or auth_secret_ref ~ '^[A-Z][A-Z0-9_]{2,63}$'
  );

/*
 * BAŞLIK YÖNTEMİ SEÇİLDİYSE KAYNAK ADI ZORUNLU.
 *
 * Aksi hâlde kaynak kimliksiz istek gönderir, 401 alır ve sebep
 * "sağlayıcı reddetti" gibi görünür -- oysa eksik olan yapılandırmadır.
 * Kod bunu zaten CONFIG_ERROR olarak yakalıyor; kısıt o hatanın hiç
 * oluşmamasını sağlıyor.
 */
alter table public.sources
  drop constraint if exists sources_header_auth_needs_secret_ref;

alter table public.sources
  add constraint sources_header_auth_needs_secret_ref
  check (auth_type = 'query' or auth_secret_ref is not null);
