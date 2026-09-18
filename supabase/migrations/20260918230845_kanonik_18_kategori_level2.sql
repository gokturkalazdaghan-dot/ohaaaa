-- ===========================================================================
-- KANONİK TAKSONOMİ — 18 Level-1, tam Level-2
-- ===========================================================================
-- SLUG'LAR DEĞİŞMİYOR, HİÇBİR KATEGORİ SİLİNMİYOR, HİÇBİR ÜRÜNÜN
-- category_id'si DEĞİŞMİYOR. Değişen: görünen adlar, bazı alt
-- kategorilerin ÜST kategorisi ve yeni alt kategoriler.
--
-- ÇAKIŞAN ADLAR TEK KATEGORİYE BAĞLANDI. Listede bazı adlar iki üst
-- kategoride birden geçiyor (Saat: #9 ve #17; Spor Giyim: #9 ve #12;
-- Oyuncak: #14 ve #16; Gaming Aksesuarları: #7 ve #16; Mutfak Gereçleri:
-- #2 ve #10; Evcil Hayvan Ürünleri: #2 ve #5; Kişisel Bakım: #5 ve #11).
-- Bir slug'ın tek bir üstü olabilir; ikinci bir kopya açmak DUPLICATE
-- kategori demekti. Her biri TEK yere kondu, diğer kaynaklar eşleme
-- tablosuyla aynı kategoriye bağlanacak.
--
-- YAŞ/YASAL KISIT ALANI EKLENDİ. Yetişkin ürünleri ve medikal ürünler
-- vitrinde kontrolsüz listelenmemeli. `access_restriction` bunu VERİDE
-- işaretliyor; uygulama tarafı bu alanı okuyarak kapı kurabilir.
-- ===========================================================================

alter table public.categories
  add column if not exists access_restriction text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'categories_access_restriction_known'
  ) then
    alter table public.categories
      add constraint categories_access_restriction_known
        check (access_restriction is null or access_restriction in ('adult', 'medical'));
  end if;
end $$;

comment on column public.categories.access_restriction is
  'Yas/yasal kisit. adult = +18, medical = ilac/medikal. NULL = kisit yok. '
  'Vitrin bu alani okuyarak kapi kurar; kisitli kategoriyi kontrolsuz '
  'listelemek yasal sorun uretir.';

-- 1) ON SEKIZ KANONIK UST KATEGORI
insert into public.categories (slug, name, parent_id, sort_order, is_active) values
  ('saglik-medikal','Sağlık & Medikal',null,1,true),
  ('ev-yasam','Ev & Yaşam',null,2,true),
  ('yapi-market-bahce-oto','Yapı, Bahçe & Hırdavat',null,3,true),
  ('oto-yedek-parca','Oto & Yedek Parça',null,4,true),
  ('supermarket','Süpermarket',null,5,true),
  ('elektronik','Elektrik & Elektronik',null,6,true),
  ('bilgisayar-tablet','Bilgisayar & Tablet',null,7,true),
  ('telefon','Telefon & Aksesuar',null,8,true),
  ('giyim-ayakkabi','Moda & Giyim',null,9,true),
  ('beyaz-esya-mutfak','Beyaz Eşya & Mutfak',null,10,true),
  ('kozmetik','Kozmetik & Kişisel Bakım',null,11,true),
  ('spor-outdoor','Spor & Outdoor',null,12,true),
  ('ev-elektronigi','Ev Elektroniği',null,13,true),
  ('anne-bebek','Anne & Bebek',null,14,true),
  ('kitap-kirtasiye-ofis','Kitap, Kırtasiye & Ofis',null,15,true),
  ('oyuncak-muzik-film','Oyuncak, Müzik, Film & Oyun',null,16,true),
  ('altin-taki-mucevher','Altın, Takı & Mücevher',null,17,true),
  ('yetiskin-urunleri','Yetişkin Ürünleri',null,18,true)
on conflict (slug) do update set name=excluded.name, parent_id=null, sort_order=excluded.sort_order, is_active=true;

-- 2) MEVCUT KATEGORILERIN ADLARI KANONIK LISTEYE HIZALANIYOR (slug degismiyor)
update public.categories c set name = v.ad from (values
  ('ag-modem','Network & Modem'),
  ('agiz-bakim-urunleri','Ağız Bakımı'),
  ('akilli-bileklik','Akıllı Bileklik'),
  ('akilli-saatler','Akıllı Saat'),
  ('android-telefonlar','Akıllı Telefon'),
  ('av-malzemeleri','Balıkçılık & Avcılık'),
  ('ayak-tirnak-bakimi','Manikür & Pedikür'),
  ('bahce','Bitki & Bahçe Ürünleri'),
  ('banyo-mutfak','Banyo'),
  ('bebek-bakim-saglik','Bebek Bakımı'),
  ('bebek-beslenme','Beslenme Ürünleri'),
  ('bebek-bezi-islak-mendil','Bebek Bakım Ürünleri'),
  ('bebek-guvenlik','Güvenlik Ürünleri'),
  ('bebek-odasi-tekstili','Bebek Odası'),
  ('bebek-tasima','Bebek Arabası'),
  ('beyaz-esya-ankastre','Ankastre'),
  ('cep-telefonu-aksesuarlari','Telefon Aksesuarları'),
  ('cilt-bakimi','Cilt Bakımı'),
  ('cocuk','Çocuk Giyim'),
  ('dekorasyon','Ev Dekorasyonu'),
  ('deterjan-temizlik','Çamaşır & Bulaşık Ürünleri'),
  ('doga-sporlari','Outdoor & Doğa Sporları'),
  ('emzirme-anne-saglik','Emzirme & Anne Ürünleri'),
  ('erkek','Erkek Giyim'),
  ('ev-gerecleri','Yaşam Ürünleri'),
  ('film','Film & Dizi'),
  ('fitness-kondisyon','Fitness'),
  ('fotokopi-kagitlari','Yazıcı Sarf Malzemeleri'),
  ('gram-kulce-altin','Altın'),
  ('gunes-urunleri','Güneş Bakımı'),
  ('hobi-eglence','Koleksiyon'),
  ('ios-telefonlar','Cep Telefonu'),
  ('kadin','Kadın Giyim'),
  ('kamp-malzemeleri','Kamp'),
  ('kisisel-bakim','Vücut Bakımı'),
  ('kucuk-mutfak-aletleri','Küçük Ev Aletleri'),
  ('kulce-gumus','Gümüş'),
  ('makyaj-urunleri','Makyaj'),
  ('motosiklet','Motosiklet Yedek Parça'),
  ('mutfak-sarf-malzemeleri','Ambalaj & Saklama'),
  ('muzik','Müzik Aletleri'),
  ('ofis-mobilyalari','Büro Ekipmanları'),
  ('ofis-okul-kirtasiye','Kırtasiye'),
  ('ofis-teknolojileri','Ofis Malzemeleri'),
  ('oto-koltugu','Oto Koltuğu'),
  ('oyuncu-ozel','Gaming Aksesuarları'),
  ('parfum','Parfüm'),
  ('petshop','Evcil Hayvan Ürünleri'),
  ('sac-bakim-urunleri','Saç Bakımı'),
  ('sanatsal-boya-malzeme','Sanat & Hobi Malzemeleri'),
  ('sarj-cihazlari','Şarj Cihazı'),
  ('sarj-kablolari','Kablo'),
  ('ses-goruntu-sistemleri','Ses Sistemleri'),
  ('spor-branslari','Spor Ekipmanları'),
  ('spor-giyim-aksesuar','Spor Giyim'),
  ('taki-mucevher','Mücevher'),
  ('veri-depolama','SSD & Depolama'),
  ('yapi-market','Yapı Malzemeleri'),
  ('yazici','Yazıcı & Tarayıcı'),
  ('yazilim-urunleri','Yazılım')
) as v(slug, ad) where c.slug = v.slug::citext;

-- 3) DOGRU UST KATEGORIYE TASINANLAR
update public.categories c set parent_id = p.id from (values
  ('dikis-makinalari','beyaz-esya-mutfak'),
  ('hava-temizleme-nem-alma','beyaz-esya-mutfak'),
  ('isitma-sogutma','beyaz-esya-mutfak'),
  ('kucuk-mutfak-aletleri','beyaz-esya-mutfak'),
  ('kulaklik','ev-elektronigi'),
  ('mp3-ses-kayit','ev-elektronigi'),
  ('petshop','ev-yasam'),
  ('supurgeler','beyaz-esya-mutfak'),
  ('utuler','beyaz-esya-mutfak')
) as v(slug, ust), public.categories p
 where c.slug = v.slug::citext and p.slug = v.ust::citext and c.parent_id is distinct from p.id;

-- 4) YENI ALT KATEGORILER
insert into public.categories (slug, name, parent_id, sort_order, is_active)
select v.slug::citext, v.ad, p.id, v.sira, true from (values
  ('saglik-medikal','tibbi-cihazlar','Tıbbi Cihazlar',110),
  ('saglik-medikal','ortopedi-destek','Ortopedi & Destek Ürünleri',120),
  ('saglik-medikal','rehabilitasyon','Rehabilitasyon',130),
  ('saglik-medikal','kisisel-saglik','Kişisel Sağlık',140),
  ('saglik-medikal','dis-agiz-sagligi','Diş & Ağız Sağlığı',150),
  ('saglik-medikal','goz-sagligi','Göz Sağlığı',160),
  ('saglik-medikal','isitme-urunleri','İşitme Ürünleri',170),
  ('saglik-medikal','hasta-bakim-urunleri','Hasta & Bakım Ürünleri',180),
  ('ev-yasam','yatak-yatak-odasi','Yatak & Yatak Odası',110),
  ('ev-yasam','depolama-duzenleme','Depolama & Düzenleme',120),
  ('ev-yasam','temizlik-gerecleri','Temizlik Gereçleri',130),
  ('ev-yasam','hobi-el-isi','Hobi & El İşi',140),
  ('ev-yasam','parti-organizasyon','Parti & Organizasyon',150),
  ('yapi-market-bahce-oto','el-aletleri','El Aletleri',110),
  ('yapi-market-bahce-oto','elektrikli-el-aletleri','Elektrikli El Aletleri',120),
  ('yapi-market-bahce-oto','hirdavat','Hırdavat',130),
  ('yapi-market-bahce-oto','boya-yapi-kimyasallari','Boya & Yapı Kimyasalları',140),
  ('yapi-market-bahce-oto','bahce-aletleri','Bahçe Aletleri',150),
  ('yapi-market-bahce-oto','bahce-mobilyalari','Bahçe Mobilyaları',160),
  ('yapi-market-bahce-oto','sulama','Sulama',170),
  ('yapi-market-bahce-oto','guvenlik-sistemleri','Güvenlik Sistemleri',180),
  ('yapi-market-bahce-oto','is-guvenligi','İş Güvenliği',190),
  ('yapi-market-bahce-oto','olcum-test-cihazlari','Ölçüm & Test Cihazları',200),
  ('oto-yedek-parca','oto-yedek-parca-urunleri','Oto Yedek Parça',110),
  ('oto-yedek-parca','motosiklet-aksesuar','Motosiklet Aksesuar',120),
  ('oto-yedek-parca','oto-bakim','Oto Bakım',130),
  ('oto-yedek-parca','lastik-jant','Lastik & Jant',140),
  ('oto-yedek-parca','aku-elektrik','Akü & Elektrik',150),
  ('oto-yedek-parca','oto-elektronigi','Oto Elektroniği',160),
  ('oto-yedek-parca','ic-dis-aksesuar','İç & Dış Aksesuar',170),
  ('oto-yedek-parca','arac-guvenligi','Araç Güvenliği',180),
  ('oto-yedek-parca','garaj-servis-ekipmanlari','Garaj & Servis Ekipmanları',190),
  ('supermarket','ev-temizlik','Ev Temizlik',110),
  ('supermarket','gunluk-tuketim-urunleri','Günlük Tüketim Ürünleri',120),
  ('elektronik','elektrik-malzemeleri','Elektrik Malzemeleri',110),
  ('elektronik','kablo-priz','Kablo & Priz',120),
  ('elektronik','anahtar-aksesuar','Anahtar & Aksesuar',130),
  ('elektronik','guc-kaynaklari','Güç Kaynakları',140),
  ('elektronik','adaptor-sarj-urunleri','Adaptör & Şarj Ürünleri',150),
  ('elektronik','batarya-pil','Batarya & Pil',160),
  ('elektronik','elektronik-bilesenler','Elektronik Bileşenler',170),
  ('elektronik','sensorler','Sensörler',180),
  ('elektronik','akilli-ev','Akıllı Ev',190),
  ('elektronik','guvenlik-elektronigi','Güvenlik Elektroniği',200),
  ('elektronik','endustriyel-elektronik','Endüstriyel Elektronik',210),
  ('bilgisayar-tablet','laptop','Laptop',110),
  ('bilgisayar-tablet','masaustu-bilgisayar','Masaüstü Bilgisayar',120),
  ('bilgisayar-tablet','gaming-bilgisayar','Gaming Bilgisayar',130),
  ('bilgisayar-tablet','tablet','Tablet',140),
  ('bilgisayar-tablet','monitor','Monitör',150),
  ('bilgisayar-tablet','klavye','Klavye',160),
  ('bilgisayar-tablet','mouse','Mouse',170),
  ('bilgisayar-tablet','webcam','Webcam',180),
  ('bilgisayar-tablet','ekran-karti','Ekran Kartı',190),
  ('bilgisayar-tablet','islemci','İşlemci',200),
  ('bilgisayar-tablet','anakart','Anakart',210),
  ('bilgisayar-tablet','ram','RAM',220),
  ('bilgisayar-tablet','bilgisayar-kasasi','Bilgisayar Kasası',230),
  ('bilgisayar-tablet','sogutma','Soğutma',240),
  ('telefon','telefon-kilifi','Telefon Kılıfı',110),
  ('telefon','ekran-koruyucu','Ekran Koruyucu',120),
  ('telefon','powerbank','Powerbank',130),
  ('telefon','telefon-tutucu','Telefon Tutucu',140),
  ('telefon','mobil-teknoloji','Mobil Teknoloji',150),
  ('giyim-ayakkabi','ayakkabi','Ayakkabı',110),
  ('giyim-ayakkabi','kadin-ayakkabi','Kadın Ayakkabı',120),
  ('giyim-ayakkabi','erkek-ayakkabi','Erkek Ayakkabı',130),
  ('giyim-ayakkabi','cocuk-ayakkabi','Çocuk Ayakkabı',140),
  ('giyim-ayakkabi','ic-giyim','İç Giyim & Fantezi Giyim',150),
  ('giyim-ayakkabi','canta','Çanta',160),
  ('giyim-ayakkabi','valiz-seyahat','Valiz & Seyahat',170),
  ('giyim-ayakkabi','moda-aksesuar','Aksesuar',180),
  ('giyim-ayakkabi','sapka','Şapka',190),
  ('giyim-ayakkabi','kemer','Kemer',200),
  ('giyim-ayakkabi','eldiven','Eldiven',210),
  ('giyim-ayakkabi','atki-sal','Atkı & Şal',220),
  ('giyim-ayakkabi','gunes-gozlugu','Güneş Gözlüğü',230),
  ('giyim-ayakkabi','dis-giyim','Dış Giyim',240),
  ('beyaz-esya-mutfak','buzdolabi','Buzdolabı',110),
  ('beyaz-esya-mutfak','derin-dondurucu','Derin Dondurucu',120),
  ('beyaz-esya-mutfak','camasir-makinesi','Çamaşır Makinesi',130),
  ('beyaz-esya-mutfak','kurutma-makinesi','Kurutma Makinesi',140),
  ('beyaz-esya-mutfak','bulasik-makinesi','Bulaşık Makinesi',150),
  ('beyaz-esya-mutfak','firin','Fırın',160),
  ('beyaz-esya-mutfak','ocak','Ocak',170),
  ('beyaz-esya-mutfak','davlumbaz','Davlumbaz',180),
  ('beyaz-esya-mutfak','kahve-makineleri','Kahve Makineleri',190),
  ('beyaz-esya-mutfak','cay-makineleri','Çay Makineleri',200),
  ('beyaz-esya-mutfak','blender-mikser','Blender & Mikser',210),
  ('beyaz-esya-mutfak','air-fryer','Air Fryer',220),
  ('kozmetik','sac-sekillendirme','Saç Şekillendirme',110),
  ('kozmetik','tiras-erkek-bakimi','Tıraş & Erkek Bakımı',120),
  ('kozmetik','kisisel-bakim-cihazlari','Kişisel Bakım Cihazları',130),
  ('kozmetik','kozmetik-aksesuarlari','Kozmetik Aksesuarları',140),
  ('spor-outdoor','kosu','Koşu',110),
  ('spor-outdoor','futbol','Futbol',120),
  ('spor-outdoor','basketbol','Basketbol',130),
  ('spor-outdoor','voleybol','Voleybol',140),
  ('spor-outdoor','tenis','Tenis',150),
  ('spor-outdoor','bisiklet','Bisiklet',160),
  ('spor-outdoor','dagcilik','Dağcılık',170),
  ('spor-outdoor','su-sporlari','Su Sporları',180),
  ('spor-outdoor','yoga-pilates','Yoga & Pilates',190),
  ('spor-outdoor','spor-ayakkabi','Spor Ayakkabı',200),
  ('spor-outdoor','spor-aksesuarlari','Spor Aksesuarları',210),
  ('ev-elektronigi','televizyon','Televizyon',110),
  ('ev-elektronigi','projektor','Projektör',120),
  ('ev-elektronigi','hoparlor','Hoparlör',130),
  ('ev-elektronigi','soundbar','Soundbar',140),
  ('ev-elektronigi','kamera','Kamera',150),
  ('ev-elektronigi','fotograf-makineleri','Fotoğraf Makineleri',160),
  ('ev-elektronigi','video-kamera','Video Kamera',170),
  ('ev-elektronigi','drone','Drone',180),
  ('ev-elektronigi','elektronik-eglence','Elektronik Eğlence',190),
  ('anne-bebek','bebek-mobilyasi','Bebek Mobilyası',110),
  ('anne-bebek','bebek-ayakkabisi','Bebek Ayakkabısı',120),
  ('kitap-kirtasiye-ofis','e-kitap','E-Kitap',110),
  ('kitap-kirtasiye-ofis','defter-ajanda','Defter & Ajanda',120),
  ('kitap-kirtasiye-ofis','kalem','Kalem',130),
  ('kitap-kirtasiye-ofis','okul-urunleri','Okul Ürünleri',140),
  ('kitap-kirtasiye-ofis','egitim-urunleri','Eğitim Ürünleri',150),
  ('oyuncak-muzik-film','egitici-oyuncak','Eğitici Oyuncak',110),
  ('oyuncak-muzik-film','lego-yapi-oyuncaklari','LEGO & Yapı Oyuncakları',120),
  ('oyuncak-muzik-film','kutu-oyunlari','Kutu Oyunları',130),
  ('oyuncak-muzik-film','muzik-ekipmanlari','Müzik Ekipmanları',140),
  ('oyuncak-muzik-film','video-oyunlari','Video Oyunları',150),
  ('oyuncak-muzik-film','konsol-oyunlari','Konsol Oyunları',160),
  ('oyuncak-muzik-film','pc-oyunlari','PC Oyunları',170),
  ('altin-taki-mucevher','pirlanta','Pırlanta',110),
  ('altin-taki-mucevher','kolye','Kolye',120),
  ('altin-taki-mucevher','bileklik','Bileklik',130),
  ('altin-taki-mucevher','kupe','Küpe',140),
  ('altin-taki-mucevher','yuzuk','Yüzük',150),
  ('altin-taki-mucevher','bros','Broş',160),
  ('altin-taki-mucevher','taki-aksesuarlari','Takı Aksesuarları',170),
  ('altin-taki-mucevher','saat','Saat',180),
  ('yetiskin-urunleri','vibratorler','Vibratörler',110),
  ('yetiskin-urunleri','masturbatorler','Mastürbatörler',120),
  ('yetiskin-urunleri','ciftler-icin-urunler','Çiftler İçin Ürünler',130),
  ('yetiskin-urunleri','anal-urunler','Anal Ürünler',140),
  ('yetiskin-urunleri','bdsm-urunleri','BDSM Ürünleri',150),
  ('yetiskin-urunleri','erotik-aksesuarlar','Erotik Aksesuarlar',160),
  ('yetiskin-urunleri','yetiskin-giyim-kostum','Yetişkin Giyim & Kostüm',170),
  ('yetiskin-urunleri','kayganlastiricilar','Kayganlaştırıcılar',180),
  ('yetiskin-urunleri','diger-yetiskin-urunleri','Diğer Yetişkin Ürünleri',190)
) as v(ust, slug, ad, sira) join public.categories p on p.slug = v.ust::citext
on conflict (slug) do update set name=excluded.name, parent_id=excluded.parent_id, is_active=true;

-- 5) YAS/YASAL KISIT ISARETLERI
update public.categories set access_restriction = 'adult'
 where slug = 'yetiskin-urunleri'
    or parent_id = (select id from public.categories where slug = 'yetiskin-urunleri');

update public.categories set access_restriction = 'medical'
 where slug = 'saglik-medikal'
    or parent_id = (select id from public.categories where slug = 'saglik-medikal');

-- 6) GIDA VE ICECEK KAPSAM DISI (silinmedi, pasif)
update public.categories set is_active = false
 where slug in ('gida', 'icecek');

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_eksik text; v_n integer;
  v_kanonik text[] := array[
    'saglik-medikal','ev-yasam','yapi-market-bahce-oto','oto-yedek-parca','supermarket',
    'elektronik','bilgisayar-tablet','telefon','giyim-ayakkabi','beyaz-esya-mutfak',
    'kozmetik','spor-outdoor','ev-elektronigi','anne-bebek','kitap-kirtasiye-ofis',
    'oyuncak-muzik-film','altin-taki-mucevher','yetiskin-urunleri'];
begin
  -- 1) On sekizi de ETKIN ve UST SEVIYE.
  select string_agg(s, ', ') into v_eksik from unnest(v_kanonik) s
   where not exists (select 1 from public.categories c
                      where c.slug = s and c.parent_id is null and c.is_active);
  if v_eksik is not null then
    raise exception 'DOGRULAMA 1: kanonik ust kategoriler eksik: %', v_eksik;
  end if;

  -- 2) BASKA ETKIN UST KATEGORI YOK -- yani duplicate/artik Level-1 kalmadi.
  select count(*) into v_n from public.categories
   where parent_id is null and is_active and not (slug = any(v_kanonik));
  if v_n > 0 then
    raise exception
      'DOGRULAMA 2: kanonik listede olmayan % etkin ust kategori var -- '
      'Level-1 taksonomisi 18 degil.', v_n;
  end if;

  -- 3) HIC URUN KAYBOLMADI. Bu gocun tek bir urunun kategorisine
  --    dokunmamasi gerekiyordu.
  select count(*) into v_n from public.product_groups g
   where g.category_id is not null
     and not exists (select 1 from public.categories c where c.id = g.category_id);
  if v_n > 0 then
    raise exception 'DOGRULAMA 3: % urun grubunun kategorisi artik yok.', v_n;
  end if;

  -- 4) URUNLU HICBIR KATEGORI PASIFLESMEDI.
  select count(*) into v_n from public.categories c
   where not c.is_active
     and exists (select 1 from public.product_groups g where g.category_id = c.id);
  if v_n > 0 then
    raise exception
      'DOGRULAMA 4: urun tasiyan % kategori pasiflestirildi -- o urunler '
      'vitrinden sessizce kaybolurdu.', v_n;
  end if;

  -- 5) SLUG TEKILLIGI: duplicate kategori yok.
  select count(*) into v_n from (
    select slug from public.categories group by slug having count(*) > 1
  ) t;
  if v_n > 0 then
    raise exception 'DOGRULAMA 5: % slug birden fazla kategoride.', v_n;
  end if;

  -- 6) GIDA/ICECEK KAPSAM DISI AMA SILINMEDI.
  if exists (select 1 from public.categories where slug in ('gida','icecek') and is_active) then
    raise exception 'DOGRULAMA 6: gida/icecek hala etkin.';
  end if;
  if (select count(*) from public.categories where slug in ('gida','icecek')) <> 2 then
    raise exception 'DOGRULAMA 6b: gida/icecek SILINMIS -- geri alinamaz karar.';
  end if;

  -- 7) +18 ve MEDIKAL ISARETLENDI.
  if (select count(*) from public.categories where access_restriction = 'adult') < 10 then
    raise exception 'DOGRULAMA 7: yetiskin kategorileri isaretlenmedi.';
  end if;
  if (select access_restriction from public.categories where slug = 'saglik-medikal')
     is distinct from 'medical' then
    raise exception 'DOGRULAMA 7b: saglik kategorisi medikal olarak isaretlenmedi.';
  end if;

  -- 8) AGACTA DONGU YOK.
  if exists (
    with recursive z(id, ata, d) as (
      select c.id, c.parent_id, 1 from public.categories c
      union all
      select z.id, c.parent_id, z.d + 1 from z
        join public.categories c on c.id = z.ata where z.ata is not null and z.d < 10
    ) select 1 from z where d >= 10
  ) then
    raise exception 'DOGRULAMA 8: kategori agacinda dongu.';
  end if;

  select count(*) into v_n from public.categories;
  raise notice
    'Kanonik taksonomi kuruldu: 18 Level-1, toplam % kategori. Slug degismedi, '
    'urun kategorisi degismedi, gida/icecek pasif (silinmedi), +18 ve medikal '
    'isaretli.', v_n;
end $$;