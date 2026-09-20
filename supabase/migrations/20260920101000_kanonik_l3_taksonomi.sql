-- ===========================================================================
-- KANONİK TAKSONOMİ — ÜÇ SEVİYE (L1 Ana · L2 Alt · L3 Ürün Kategorisi)
-- ===========================================================================
--
-- ÖLÇÜLEN PROBLEM
-- Taksonomi bugün İKİ seviyeli ama İÇERİĞİ üç seviyelik. `bilgisayar-tablet`
-- altında hem "Bilgisayarlar" (bir alt kategori) hem "RAM" (bir ürün
-- kategorisi) YAN YANA duruyor. Aynı menüde 23 kardeş var ve hiçbiri
-- diğerinden daha genel görünmüyor. Kullanıcı için "Bilgisayarlar" ile
-- "Ekran Kartı" aynı hizada; oysa biri diğerinin içinde.
--
-- Bu göç o içeriği doğru seviyeye taşıyor:
--   L1 = ANA KATEGORİ      (Bilgisayar & Teknoloji)
--   L2 = ALT KATEGORİ      (Bilgisayar Bileşenleri)
--   L3 = ÜRÜN KATEGORİSİ   (Ekran Kartı)
--
-- ---------------------------------------------------------------------------
-- BU GÖÇ HİÇBİR ÜRÜNÜN KATEGORİSİNİ DEĞİŞTİRMEZ
-- ---------------------------------------------------------------------------
-- Değişen tek şey kategorilerin BİRBİRİYLE ilişkisi (`parent_id`) ve görünen
-- adları. `product_groups.category_id` sütununa tek bir update atılmıyor --
-- doğrulama bunu satır sayarak kanıtlıyor. Ürün taşıma işi bir önceki göçte
-- (birleştirme) yapıldı ve orada sayıldı.
--
-- ---------------------------------------------------------------------------
-- SLUG DEĞİŞMİYOR, ADRES KIRILMIYOR
-- ---------------------------------------------------------------------------
-- `/kategori/ram` üç seviyeli ağaçta da AYNI adrestir. Slug'ı hiyerarşiye
-- bağlamak (`/kategori/bilgisayar-teknoloji/bilgisayar-bilesenleri/ram`)
-- her yeniden düzenlemeyi bir SEO kesintisine çevirirdi; ayrıca ülke ve dil
-- kırılımı geldiğinde (`/tr/kategori/ram`, `/de/kategori/ram`) yol öneki
-- zaten değişecek. Düz slug, ikisini de bozmadan taşır.
--
-- ---------------------------------------------------------------------------
-- DERİNLİK ÜÇTE KİLİTLENİYOR
-- ---------------------------------------------------------------------------
-- `tree_level` bir tetikleyiciyle hesaplanıyor ve dördüncü seviye VERİTABANI
-- TARAFINDAN reddediliyor. Kilitlenmeseydi, bir sonraki göç sessizce
-- dördüncü seviyeyi açabilir ve menü/arama kapsamı (üç seviye varsayıyor)
-- o dalı hiç göstermezdi -- ürünler veritabanında var, vitrinde yok.
--
-- ---------------------------------------------------------------------------
-- HEDEF MİMARİDEN SAPMALAR — BİLİNÇLİ
-- ---------------------------------------------------------------------------
--  • "Film" YERİNE "Film & Dizi" kalıyor: slug (`film`) dizi ürünlerini de
--    taşıyor ve adı daraltmak içeriğin bir kısmını yanlış adlandırmak olurdu.
--    Üstküme, yanlış addan iyidir.
--  • Moda, Kozmetik, Spor, Anne & Bebek, Sağlık, Oto, Yapı Market,
--    Süpermarket, Beyaz Eşya, Altın ve Yetişkin ANA KATEGORİLERİ DURUYOR.
--    Hedef listesi yedi ana kategori sayıyor ama bu on bir dal bugün
--    katalogda kategori ve eşleme kuralı taşıyor; kapatmak, çalışan bir
--    sistemi Türkiye dışına açılmadan önce daraltmak olurdu. Üç seviyeli
--    yeniden düzenleme YEDİ hedef dalda yapılıyor; diğerleri iki seviyeli
--    kalıyor ve aynı kısıtlar altında ilerideki bir göçle derinleşebilir.
--  • `android-telefonlar` slug'ı "Akıllı Telefon" adını taşıyor. Ad doğru,
--    slug tarihsel. Slug'ı düzeltmek yayımlanmış bir adresi kırardı.
-- ===========================================================================

-- --- 1) SEVİYE SÜTUNU ------------------------------------------------------
alter table public.categories
  add column if not exists tree_level smallint;

comment on column public.categories.tree_level is
  'Kanonik seviye: 1 = Ana Kategori, 2 = Alt Kategori, 3 = Urun Kategorisi. '
  'Tetikleyici hesaplar, elle yazilmaz. Dorduncu seviye REDDEDILIR: menu ve '
  'arama kapsami uc seviye varsayiyor, dorduncu dal sessizce gorunmez olurdu.';

-- Mevcut ağacın seviyeleri ÖLÇÜLEREK dolduruluyor (tetikleyiciden ÖNCE:
-- sonra olsaydı tetikleyici boş `tree_level` gören bir üst kategoriye
-- bakıp null üretirdi).
with recursive agac as (
  select id, 1::smallint as lv from public.categories where parent_id is null
  union all
  select c.id, (a.lv + 1)::smallint
    from public.categories c
    join agac a on a.id = c.parent_id
)
update public.categories c set tree_level = a.lv from agac a where a.id = c.id;

create or replace function public.tg_categories_seviye_hesapla()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ust smallint;
begin
  if new.parent_id is null then
    new.tree_level := 1;
  else
    select c.tree_level into v_ust from public.categories c where c.id = new.parent_id;
    if v_ust is null then
      raise exception
        'Kategori "%" seviyesi hesaplanamadi: ust kategorinin seviyesi yok.',
        new.slug;
    end if;
    new.tree_level := (v_ust + 1)::smallint;
  end if;

  if new.tree_level > 3 then
    raise exception
      'Kategori "%" dorduncu seviyeye dusuyor. Kanonik taksonomi UC seviyeli: '
      'L1 Ana, L2 Alt, L3 Urun Kategorisi. Dorduncu seviye menude ve arama '
      'kapsaminda gorunmez, yani o daldaki urunler vitrinden kaybolurdu.',
      new.slug;
  end if;

  return new;
end $$;

comment on function public.tg_categories_seviye_hesapla is
  'categories.tree_level i ust kategoriden hesaplar ve dorduncu seviyeyi '
  'reddeder. Derinligi VERIDE kilitler; kod tarafindaki bir varsayima '
  'guvenmek, sessizce gorunmez bir dal uretirdi.';

/*
 * Üst kategori taşındığında ALTI da taşınır.
 *
 * Bu olmasaydı: bir L2 kategoriyi L1'e çıkardığınızda çocukları hâlâ eski
 * seviyeyi taşır ve `tree_level` veriyle çelişirdi -- üstelik sessizce,
 * çünkü hiçbir kısıt ihlal edilmiş olmazdı. Tetikleme zinciri derinlik 3
 * olduğu için en fazla iki tur döner.
 */
create or replace function public.tg_categories_seviye_yay()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.categories set parent_id = parent_id where parent_id = new.id;
  return null;
end $$;

drop trigger if exists categories_seviye_hesapla on public.categories;
create trigger categories_seviye_hesapla
  before insert or update of parent_id on public.categories
  for each row execute function public.tg_categories_seviye_hesapla();

drop trigger if exists categories_seviye_yay on public.categories;
/*
 * `after update` — `after update OF tree_level` DEĞİL.
 *
 * Ölçülen hata: sütun listeli bir AFTER tetikleyicisi yalnızca o sütun
 * UPDATE'in SET listesinde GEÇTİĞİNDE çalışır. `tree_level`'ı BEFORE
 * tetikleyicisi yazıyor, SET listesinde hiç geçmiyor; dolayısıyla yayılım
 * hiç koşmuyordu ve bir kategori üstüyle aynı seviyede kalıyordu
 * (`projektor` = 2, üstü de 2). `when` yan tümcesi zaten gereksiz
 * tekrarları eliyor, yani sütun listesine ihtiyaç yok.
 */
create trigger categories_seviye_yay
  after update on public.categories
  for each row when (old.tree_level is distinct from new.tree_level)
  execute function public.tg_categories_seviye_yay();

-- --- 2) YENİ KANONİK KATEGORİLER ------------------------------------------
-- `gaming-konsol`: hedef mimarinin tek GERÇEKTEN yeni ana kategorisi.
-- Bugün oyun ürünleri üç ayrı dala dağılmış durumda: konsol ve konsol oyunu
-- "Oyuncak, Müzik, Film & Oyun" altında, gaming aksesuarı ise
-- "Bilgisayar & Tablet" altında. Aynı kullanıcı niyetinin üç farklı yerde
-- aranması demek bu.
insert into public.categories (slug, name, parent_id, sort_order, is_active)
values ('gaming-konsol', 'Gaming & Konsol', null, 4, true)
on conflict (slug) do update
  set name = excluded.name, parent_id = null,
      sort_order = excluded.sort_order, is_active = true;

-- `ev-aksesuarlari`: hedef listede var, katalogda yoktu. BOŞ AÇILMIYOR --
-- altına bugün gerçekten var olan iki ürün kategorisi giriyor (aşağıda).
insert into public.categories (slug, name, parent_id, sort_order, is_active)
select 'ev-aksesuarlari', 'Ev Aksesuarları', c.id, 20, true
  from public.categories c where c.slug = 'ev-yasam'
on conflict (slug) do update
  set name = excluded.name, parent_id = excluded.parent_id, is_active = true;

-- --- 3) ANA KATEGORİ ADLARI VE SIRASI -------------------------------------
-- Yedi hedef dal öne alınıyor; kalan on bir dal göreli sırasını koruyarak
-- arkaya geçiyor. `ev-elektronigi` ana kategori OLMAKTAN ÇIKIYOR (aşağıda
-- `elektronik` altına iniyor): hedef mimaride o bir ALT kategori.
update public.categories c set name = v.ad, sort_order = v.sira
  from (values
    ('bilgisayar-tablet',     'Bilgisayar & Teknoloji',       1),
    ('telefon',               'Telefon & Mobil',              2),
    ('elektronik',            'Elektronik',                   3),
    ('gaming-konsol',         'Gaming & Konsol',              4),
    ('ev-yasam',              'Ev & Yaşam',                   5),
    ('kitap-kirtasiye-ofis',  'Kitap & Kırtasiye',            6),
    ('oyuncak-muzik-film',    'Eğlence & Hobi',               7),
    ('saglik-medikal',        'Sağlık & Medikal',             8),
    ('yapi-market-bahce-oto', 'Yapı, Bahçe & Hırdavat',       9),
    ('oto-yedek-parca',       'Oto & Yedek Parça',           10),
    ('supermarket',           'Süpermarket',                 11),
    ('giyim-ayakkabi',        'Moda & Giyim',                12),
    ('beyaz-esya-mutfak',     'Beyaz Eşya & Mutfak',         13),
    ('kozmetik',              'Kozmetik & Kişisel Bakım',    14),
    ('spor-outdoor',          'Spor & Outdoor',              15),
    ('anne-bebek',            'Anne & Bebek',                16),
    ('altin-taki-mucevher',   'Altın, Takı & Mücevher',      17),
    ('yetiskin-urunleri',     'Seks Oyuncakları & Yetişkin Ürünleri', 18)
  ) as v(slug, ad, sira)
 where c.slug = v.slug::citext;

-- --- 4) ALT (L2) VE ÜRÜN (L3) KATEGORİLERİ --------------------------------
/*
 * Tek bir liste: her satır bir kategorinin KANONİK EVİNİ söylüyor.
 *
 * Ayrı ayrı `update`ler yerine tek liste olmasının sebebi: taksonomiyi
 * okurken bütününü görebilmek. Dağınık update'lerde bir kategorinin nereye
 * gittiği ancak dosyayı baştan sona okuyarak anlaşılır ve iki update aynı
 * satıra dokunduğunda hangisinin kazandığı görünmez olur.
 *
 * SIRA ÖNEMLİ DEĞİL çünkü hedefler slug ile çözülüyor ve `tree_level`
 * tetikleyici tarafından her taşımadan sonra yeniden hesaplanıyor.
 */
update public.categories c
   set parent_id  = p.id,
       name       = v.ad,
       sort_order = v.sira,
       is_active  = true
  from (values
    -- ============ L1: Bilgisayar & Teknoloji ============
    ('bilgisayar-tablet', 'bilgisayar',                 'Bilgisayarlar',                 10),
    ('bilgisayar-tablet', 'tablet',                     'Tabletler',                     20),
    ('bilgisayar-tablet', 'bilgisayar-bilesenleri',     'Bilgisayar Bileşenleri',        30),
    ('bilgisayar-tablet', 'bilgisayar-yedek-parcalari', 'Bilgisayar Yedek Parçaları',    40),
    ('bilgisayar-tablet', 'veri-depolama',              'SSD & Depolama',                50),
    ('bilgisayar-tablet', 'cevre-birimleri',            'Çevre Birimleri',               60),
    ('bilgisayar-tablet', 'ag-modem',                   'Network & Modem',               70),
    ('bilgisayar-tablet', 'yazici',                     'Yazıcı & Tarayıcı',             80),
    ('bilgisayar-tablet', 'yazilim-urunleri',           'Yazılım',                       90),
    --   L3
    ('bilgisayar',             'laptop',              'Laptop',              10),
    ('bilgisayar',             'masaustu-bilgisayar', 'Masaüstü Bilgisayar', 20),
    ('bilgisayar',             'gaming-bilgisayar',   'Gaming Bilgisayar',   30),
    ('bilgisayar-bilesenleri', 'islemci',             'İşlemci',             10),
    ('bilgisayar-bilesenleri', 'ekran-karti',         'Ekran Kartı',         20),
    ('bilgisayar-bilesenleri', 'anakart',             'Anakart',             30),
    ('bilgisayar-bilesenleri', 'ram',                 'RAM',                 40),
    ('bilgisayar-bilesenleri', 'bilgisayar-kasasi',   'Bilgisayar Kasası',   50),
    ('bilgisayar-bilesenleri', 'sogutma',             'Soğutma',             60),
    ('cevre-birimleri',        'monitor',             'Monitör',             10),
    ('cevre-birimleri',        'klavye',              'Klavye',              20),
    ('cevre-birimleri',        'mouse',               'Mouse',               30),
    ('cevre-birimleri',        'webcam',              'Webcam',              40),

    -- ============ L1: Telefon & Mobil ============
    ('telefon', 'android-telefonlar',           'Akıllı Telefon',               10),
    ('telefon', 'cep-telefonu-aksesuarlari',    'Telefon Aksesuarları',         20),
    ('telefon', 'cep-telefonu-yedek-parcalari', 'Cep Telefonu Yedek Parçaları', 30),
    ('telefon', 'mobil-teknoloji',              'Mobil Teknoloji',              40),
    ('telefon', 'telsiz-masaustu-telefonlar',   'Telsiz & Masaüstü Telefonlar', 50),
    --   L3
    ('cep-telefonu-aksesuarlari',    'telefon-kilifi',   'Telefon Kılıfı',       10),
    ('cep-telefonu-aksesuarlari',    'ekran-koruyucu',   'Ekran Koruyucu',       20),
    ('cep-telefonu-aksesuarlari',    'powerbank',        'Powerbank',            30),
    ('cep-telefonu-aksesuarlari',    'telefon-tutucu',   'Telefon Tutucu',       40),
    ('cep-telefonu-aksesuarlari',    'sarj-cihazlari',   'Telefon Şarj Cihazı',  50),
    ('cep-telefonu-aksesuarlari',    'sarj-kablolari',   'Şarj Kablosu',         60),
    ('cep-telefonu-yedek-parcalari', 'bataryalar',       'Telefon Bataryası',    10),
    ('mobil-teknoloji',              'akilli-saatler',   'Akıllı Saat',          10),
    ('mobil-teknoloji',              'akilli-bileklik',  'Akıllı Bileklik',      20),
    ('mobil-teknoloji',              'akilli-gozlukler', 'Akıllı Gözlük',        30),
    ('mobil-teknoloji',              'akilli-yuzukler',  'Akıllı Yüzük',         40),

    -- ============ L1: Elektronik ============
    -- `ev-elektronigi` ANA KATEGORİ OLMAKTAN ÇIKIYOR. Hedef mimaride
    -- "Ev Elektroniği" bir ALT kategori; ana kategori olarak durması
    -- "Elektronik" ile aynı rafı iki kez açmaktı.
    ('elektronik', 'ev-elektronigi',         'Ev Elektroniği',         10),
    ('elektronik', 'ses-goruntu-sistemleri', 'Ses Sistemleri',         20),
    ('elektronik', 'kulaklik',               'Kulaklık',               30),
    ('elektronik', 'aydinlatma',             'Aydınlatma',             40),
    ('elektronik', 'elektronik-aksesuarlar', 'Elektronik Aksesuarlar', 50),
    ('elektronik', 'elektrik-malzemeleri',   'Elektrik Malzemeleri',   60),
    --   L3
    ('ev-elektronigi',         'televizyon',             'Televizyon',             10),
    ('ev-elektronigi',         'kamera',                 'Kamera',                 20),
    ('ev-elektronigi',         'fotograf-makineleri',    'Fotoğraf Makineleri',    30),
    ('ev-elektronigi',         'video-kamera',           'Video Kamera',           40),
    ('ev-elektronigi',         'drone',                  'Drone',                  50),
    ('ev-elektronigi',         'akilli-ev',              'Akıllı Ev',              60),
    ('ev-elektronigi',         'guvenlik-elektronigi',   'Güvenlik Elektroniği',   70),
    ('ev-elektronigi',         'elektronik-eglence',     'Elektronik Eğlence',     80),
    ('ses-goruntu-sistemleri', 'hoparlor',               'Hoparlör',               10),
    ('ses-goruntu-sistemleri', 'soundbar',               'Soundbar',               20),
    ('ses-goruntu-sistemleri', 'mp3-ses-kayit',          'MP3 & Ses Kayıt Cihazı', 30),
    ('elektronik-aksesuarlar', 'adaptor-sarj-urunleri',  'Adaptör & Şarj Ürünleri',10),
    ('elektrik-malzemeleri',   'kablo-priz',             'Kablo & Priz',           10),
    ('elektrik-malzemeleri',   'anahtar-aksesuar',       'Anahtar & Aksesuar',     20),
    ('elektrik-malzemeleri',   'guc-kaynaklari',         'Güç Kaynakları',         30),
    ('elektrik-malzemeleri',   'batarya-pil',            'Batarya & Pil',          40),
    ('elektrik-malzemeleri',   'elektronik-bilesenler',  'Elektronik Bileşenler',  50),
    ('elektrik-malzemeleri',   'sensorler',              'Sensörler',              60),
    ('elektrik-malzemeleri',   'endustriyel-elektronik', 'Endüstriyel Elektronik', 70),

    -- ============ L1: Gaming & Konsol ============
    -- "Oyun & Oyun Konsolları" TEK BAŞINA iki ürün tipi taşıyordu: konsolun
    -- kendisi ve konsol oyunu. Ayrı raflar; ayrı arama niyeti.
    ('gaming-konsol', 'oyun-konsollari', 'Oyun Konsolları',             10),
    ('gaming-konsol', 'konsol-oyunlari', 'Konsol Oyunları',             20),
    ('gaming-konsol', 'pc-oyunlari',     'PC Oyunları',                 30),
    ('gaming-konsol', 'video-oyunlari',  'Dijital Oyun & Oyun Kodları', 40),
    ('gaming-konsol', 'oyuncu-ozel',     'Gaming Aksesuarları',         50),

    -- ============ L1: Ev & Yaşam ============
    ('ev-yasam', 'ev-gerecleri',      'Yaşam Ürünleri',          10),
    ('ev-yasam', 'ev-aksesuarlari',   'Ev Aksesuarları',         20),
    ('ev-yasam', 'ev-tekstili',       'Ev Tekstili',             30),
    ('ev-yasam', 'mobilya',           'Mobilya',                 40),
    ('ev-yasam', 'dekorasyon',        'Ev Dekorasyonu',          50),
    ('ev-yasam', 'banyo-mutfak',      'Banyo',                   60),
    ('ev-yasam', 'temizlik-gerecleri','Temizlik Gereçleri',      70),
    ('ev-yasam', 'petshop',           'Evcil Hayvan Ürünleri',   80),
    --   L3
    ('ev-aksesuarlari', 'depolama-duzenleme', 'Depolama & Düzenleme',  10),
    ('ev-aksesuarlari', 'parti-organizasyon', 'Parti & Organizasyon',  20),
    ('ev-tekstili',     'yatak-yatak-odasi',  'Yatak & Yatak Odası',   10),

    -- ============ L1: Kitap & Kırtasiye ============
    ('kitap-kirtasiye-ofis', 'kitap',                  'Kitap',                    10),
    ('kitap-kirtasiye-ofis', 'ofis-okul-kirtasiye',    'Kırtasiye',                20),
    ('kitap-kirtasiye-ofis', 'fotokopi-kagitlari',     'Yazıcı Sarf Malzemeleri',  30),
    ('kitap-kirtasiye-ofis', 'ofis-mobilyalari',       'Büro Ekipmanları',         40),
    ('kitap-kirtasiye-ofis', 'projeksiyon-sistemleri', 'Projeksiyon Sistemleri',   50),
    --   L3
    ('kitap',               'e-kitap',               'E-Kitap',                  10),
    ('ofis-okul-kirtasiye', 'defter-ajanda',         'Defter & Ajanda',          10),
    ('ofis-okul-kirtasiye', 'kalem',                 'Kalem',                    20),
    ('ofis-okul-kirtasiye', 'okul-urunleri',         'Okul Ürünleri',            30),
    ('ofis-okul-kirtasiye', 'egitim-urunleri',       'Eğitim Ürünleri',          40),
    ('ofis-okul-kirtasiye', 'sanatsal-boya-malzeme', 'Sanat & Hobi Malzemeleri', 50),
    ('ofis-mobilyalari',    'ofis-teknolojileri',    'Ofis Malzemeleri',         10),

    -- ============ L1: Eğlence & Hobi ============
    -- "Oyuncak, Müzik, Film & Oyun" dört ürün tipini tek adda topluyordu.
    -- Oyun dalı Gaming & Konsol'a gitti; kalan üçü kendi alt kategorisinde.
    ('oyuncak-muzik-film', 'oyuncak',     'Oyuncak',           10),
    ('oyuncak-muzik-film', 'muzik',       'Müzik',             20),
    ('oyuncak-muzik-film', 'film',        'Film & Dizi',       30),
    ('oyuncak-muzik-film', 'hobi-eglence','Hobi & Koleksiyon', 40),
    --   L3
    ('oyuncak',      'egitici-oyuncak',          'Eğitici Oyuncak',              10),
    ('oyuncak',      'lego-yapi-oyuncaklari',    'LEGO & Yapı Oyuncakları',      20),
    ('oyuncak',      'kutu-oyunlari',            'Kutu Oyunları',                30),
    ('muzik',        'muzik-ekipmanlari',        'Müzik Aletleri & Ekipmanları', 10),
    ('hobi-eglence', 'hobi-el-isi',              'El İşi & El Sanatları',        10),
    ('hobi-eglence', 'elektronik-devre-robotik', 'Elektronik Devre & Robotik',   20)
  ) as v(ust, slug, ad, sira),
  public.categories p
 where c.slug = v.slug::citext
   and p.slug = v.ust::citext;

-- --- 5) YENİ DALLARIN KISIT MİRASI ----------------------------------------
-- `access_restriction` üst kategoriden gelir: Sağlık & Medikal ve Yetişkin
-- dallarına bu göçte yeni satır girmiyor, ama bir sonraki göç girerse
-- işaretsiz kalmasın diye kural burada da uygulanıyor. İşaretsiz bir çocuk,
-- yaş/yasal kapısını atlatırdı.
update public.categories c set access_restriction = p.access_restriction
  from public.categories p
 where c.parent_id = p.id
   and p.access_restriction is not null
   and c.access_restriction is distinct from p.access_restriction;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_n bigint;
  v_eksik text;
  v_l1 text[] := array[
    'bilgisayar-tablet','telefon','elektronik','gaming-konsol','ev-yasam',
    'kitap-kirtasiye-ofis','oyuncak-muzik-film','saglik-medikal',
    'yapi-market-bahce-oto','oto-yedek-parca','supermarket','giyim-ayakkabi',
    'beyaz-esya-mutfak','kozmetik','spor-outdoor','anne-bebek',
    'altin-taki-mucevher','yetiskin-urunleri'];
begin
  -- 1) HİÇBİR ÜRÜN KATEGORİSİZ VEYA YETİM KALMADI. Bu göçün tek bir ürünün
  --    category_id'sine dokunmamasi gerekiyordu.
  select count(*) into v_n
    from public.product_groups g
   where g.category_id is not null
     and not exists (select 1 from public.categories c where c.id = g.category_id);
  if v_n > 0 then
    raise exception 'DOGRULAMA 1: % urun grubunun kategorisi artik yok.', v_n;
  end if;

  -- 2) ÜRÜN TAŞIYAN HİÇBİR KATEGORİ PASİFLEŞMEDİ. Pasifleşseydi o ürünler
  --    vitrinden SESSİZCE kaybolurdu.
  select count(*) into v_n
    from public.categories c
   where not c.is_active
     and exists (select 1 from public.product_groups g where g.category_id = c.id);
  if v_n > 0 then
    raise exception
      'DOGRULAMA 2: urun tasiyan % kategori pasiflestirildi.', v_n;
  end if;

  -- 3) ON SEKİZ ANA KATEGORİ, TAM OLARAK BU LİSTE.
  select string_agg(s, ', ') into v_eksik from unnest(v_l1) s
   where not exists (select 1 from public.categories c
                      where c.slug = s::citext and c.parent_id is null and c.is_active);
  if v_eksik is not null then
    raise exception 'DOGRULAMA 3: ana kategori eksik ya da ust seviyede degil: %', v_eksik;
  end if;

  select count(*) into v_n from public.categories
   where parent_id is null and is_active and not (slug::text = any(v_l1));
  if v_n > 0 then
    raise exception
      'DOGRULAMA 3b: listede olmayan % etkin ana kategori var -- L1 taksonomisi '
      'kacak buyumus.', v_n;
  end if;

  -- 4) DERİNLİK ÜÇÜ AŞMIYOR ve tree_level veriyle ÇELİŞMİYOR.
  if exists (select 1 from public.categories where tree_level is null) then
    raise exception 'DOGRULAMA 4: tree_level bos kalan kategori var.';
  end if;
  if exists (select 1 from public.categories where tree_level not between 1 and 3) then
    raise exception 'DOGRULAMA 4b: uc seviyeyi asan kategori var.';
  end if;
  select count(*) into v_n
    from public.categories c
    left join public.categories p on p.id = c.parent_id
   where c.tree_level <> coalesce(p.tree_level, 0) + 1;
  if v_n > 0 then
    raise exception
      'DOGRULAMA 4c: % kategoride tree_level ust kategoriyle celisiyor.', v_n;
  end if;

  -- 5) DÖRDÜNCÜ SEVİYE GERÇEKTEN REDDEDİLİYOR. Kısıt yazmak yetmez;
  --    çalıştığını denemeden bilemeyiz.
  begin
    insert into public.categories (slug, name, parent_id)
    select 'goc-derinlik-denemesi', 'Derinlik Denemesi', c.id
      from public.categories c where c.slug = 'ram';
    raise exception 'DOGRULAMA 5: dorduncu seviye kategori KABUL EDILDI.';
  exception when raise_exception then
    if sqlerrm like 'DOGRULAMA 5:%' then raise; end if;
  end;

  -- 6) HEDEF MİMARİNİN ÜÇ SEVİYESİ GERÇEKTEN KURULDU.
  select count(*) into v_n from public.categories where tree_level = 3 and is_active;
  if v_n < 50 then
    raise exception
      'DOGRULAMA 6: yalnizca % urun kategorisi (L3) var -- yeniden duzenleme '
      'uygulanmamis.', v_n;
  end if;

  -- 7) "Aksesuarlar" GİBİ TEK BAŞINA BELİRSİZ AD KALMADI.
  if exists (
    select 1 from public.categories
     where is_active and lower(btrim(name)) in ('aksesuar', 'aksesuarlar')
  ) then
    raise exception
      'DOGRULAMA 7: tek basina "Aksesuarlar" adli etkin kategori var -- '
      'kullanici da arama motoru da icinde ne oldugunu bilemez.';
  end if;

  -- 8) AYNI ÜST ALTINDA YİNELENEN AD YOK.
  select count(*) into v_n from (
    select parent_id, lower(name) from public.categories where is_active
     group by 1, 2 having count(*) > 1
  ) t;
  if v_n > 0 then
    raise exception 'DOGRULAMA 8: ayni ust altinda % yinelenen ad.', v_n;
  end if;

  -- 9) HEDEF DALLARIN L2 İSKELETİ YERİNDE.
  select count(*) into v_n
    from public.categories c join public.categories p on p.id = c.parent_id
   where p.slug::text = 'gaming-konsol' and c.is_active;
  if v_n < 5 then
    raise exception 'DOGRULAMA 9: Gaming & Konsol altinda yalnizca % alt kategori.', v_n;
  end if;

  if (select tree_level from public.categories where slug::text = 'ev-elektronigi') <> 2 then
    raise exception
      'DOGRULAMA 9b: "Ev Elektronigi" hala ana kategori -- Elektronik ile ayni '
      'rafi iki kez acmis olurduk.';
  end if;
  if (select tree_level from public.categories where slug::text = 'ram') <> 3 then
    raise exception 'DOGRULAMA 9c: "RAM" urun kategorisi (L3) seviyesine inmedi.';
  end if;

  select count(*) into v_n from public.categories;
  raise notice
    'Kanonik uc seviyeli taksonomi kuruldu: 18 ana kategori, toplam % kategori '
    '(L1 %, L2 %, L3 %). Slug degismedi, urun kategorisi degismedi.',
    v_n,
    (select count(*) from public.categories where tree_level = 1 and is_active),
    (select count(*) from public.categories where tree_level = 2 and is_active),
    (select count(*) from public.categories where tree_level = 3 and is_active);
end $$;
