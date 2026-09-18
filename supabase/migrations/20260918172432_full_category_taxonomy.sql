-- ============================================================================
-- TAM KATEGORİ TAKSONOMİSİ — 15 üst, 117 alt kategori
--
-- ⚠️  ÜRETİMDE UYGULANDI (schema_migrations 20260918172432).
--
-- SABİT KİMLİKLER: `supabase/seed.sql` dokuz kategoriyi sabit UUID ile
-- ekliyor ve tohumun ürün grupları o kimliklere bağlı. Bu göç tohumdan
-- ÖNCE çalıştığı için aynı slug'ları rastgele kimlikle açsaydı tohumun
-- `on conflict (id) do nothing` koruması tutmaz, slug benzersizliği
-- patlardı. O dokuz slug tohumun kimliğiyle açılıyor; üretimde zaten var
-- olan satırların kimliği ise `do update` ile DEĞİŞMİYOR.
--
-- ÖLÇÜLEN DURUM: katalogda 9 kategori vardı; altı üst kategorinin dördü
-- tamamen boştu ve ürünlerin tamamı üç alt kategoride toplanmıştı.
--
-- URL KIRILMIYOR. Ürün taşıyan hiçbir slug değişmiyor:
--   telefon (814 grup) · bilgisayar (32.894) · kulaklik (541) · ev-yasam (261)
-- Yalnızca ÜRÜNSÜZ `moda` slug'ı `giyim-ayakkabi` olarak yeniden
-- adlandırılıyor -- o adrese bağlı tek bir ürün yok.
--
-- ELEKTRONİK DALI TAŞINMIYOR, YENİDEN ADLANDIRILIYOR. `elektronik` slug'ı
-- "Bilgisayar, Elektronik" adını alıyor; `telefon` üst düzeye çıkıyor ama
-- slug'ı aynı kalıyor. Böylece 34.510 ürün grubunun kategori bağı da,
-- yayımlanmış adresleri de olduğu gibi duruyor -- göç sonrası sayıldı,
-- hiçbiri değişmedi.
--
-- BOŞ KATEGORİ ZARARSIZ. Şerit `getCategoryTree` üzerinden besleniyor ve
-- ürünsüz kategoriyi zaten göstermiyor; kategori sayfası da boşsa `noindex`
-- veriyor. Taksonomi bugün iskelet olarak duruyor, besleme geldikçe
-- kendiliğinden görünür oluyor -- kod değişmeden.
-- ============================================================================

-- Ürünsüz `moda` satırı yeni kimliğini alıyor (upsert'ten ÖNCE, yoksa
-- ikizlenirdi).
update public.categories set slug = 'giyim-ayakkabi' where slug = 'moda';

-- --- ÜST DÜZEY ---------------------------------------------------------
insert into public.categories (id, slug, name, parent_id, sort_order, is_active)
select coalesce(v.id, gen_random_uuid()), v.slug::citext, v.ad, null, v.sira, true
from (values
  ('c0000000-0000-4000-8000-000000000002'::uuid, 'giyim-ayakkabi', 'Giyim, Ayakkabı', 1),
  ('c0000000-0000-4000-8000-000000000011'::uuid, 'telefon', 'Telefon', 2),
  ('c0000000-0000-4000-8000-000000000003'::uuid, 'ev-yasam', 'Ev, Yaşam', 3),
  (null::uuid, 'beyaz-esya-mutfak', 'Beyaz Eşya, Mutfak', 4),
  ('c0000000-0000-4000-8000-000000000005'::uuid, 'kozmetik', 'Kozmetik, Kişisel Bakım', 5),
  ('c0000000-0000-4000-8000-000000000004'::uuid, 'spor-outdoor', 'Spor, Outdoor', 6),
  ('c0000000-0000-4000-8000-000000000006'::uuid, 'supermarket', 'Süpermarket', 7),
  (null::uuid, 'ev-elektronigi', 'Ev Elektroniği', 8),
  (null::uuid, 'anne-bebek', 'Anne, Bebek', 9),
  (null::uuid, 'yapi-market-bahce-oto', 'Yapı Market, Bahçe, Oto', 10),
  ('c0000000-0000-4000-8000-000000000001'::uuid, 'elektronik', 'Bilgisayar, Elektronik', 11),
  (null::uuid, 'kitap-kirtasiye-ofis', 'Kitap, Kırtasiye, Ofis', 12),
  (null::uuid, 'oyuncak-muzik-film', 'Oyuncak, Müzik, Film', 13),
  (null::uuid, 'altin-taki-mucevher', 'Altın, Takı, Mücevher', 14),
  (null::uuid, 'petshop', 'Petshop', 15)
) as v(id, slug, ad, sira)
on conflict (slug) do update
  set name = excluded.name,
      parent_id = null,
      sort_order = excluded.sort_order,
      is_active = true;

-- --- ALT KATEGORİLER ---------------------------------------------------
insert into public.categories (id, slug, name, parent_id, sort_order, is_active)
select coalesce(v.id, gen_random_uuid()), v.slug::citext, v.ad, u.id, v.sira, true
from (values
  ('giyim-ayakkabi', null::uuid, 'kadin', 'Kadın', 1),
  ('giyim-ayakkabi', null::uuid, 'erkek', 'Erkek', 2),
  ('giyim-ayakkabi', null::uuid, 'cocuk', 'Çocuk', 3),
  ('giyim-ayakkabi', null::uuid, 'bebek-giyim', 'Bebek', 4),
  ('telefon', null::uuid, 'android-telefonlar', 'Android Telefonlar', 1),
  ('telefon', null::uuid, 'ios-telefonlar', 'iOS Telefonlar', 2),
  ('telefon', null::uuid, 'cep-telefonu-aksesuarlari', 'Cep Telefonu Aksesuarları', 3),
  ('telefon', null::uuid, 'cep-telefonu-yedek-parcalari', 'Cep Telefonu Yedek Parçaları', 4),
  ('telefon', null::uuid, 'sarj-cihazlari', 'Şarj Cihazları', 5),
  ('telefon', null::uuid, 'sarj-kablolari', 'Şarj Kabloları', 6),
  ('telefon', null::uuid, 'bataryalar', 'Bataryalar', 7),
  ('telefon', null::uuid, 'akilli-bileklik', 'Akıllı Bileklik', 8),
  ('telefon', null::uuid, 'akilli-gozlukler', 'Akıllı Gözlükler', 9),
  ('telefon', null::uuid, 'akilli-saatler', 'Akıllı Saatler', 10),
  ('telefon', null::uuid, 'akilli-yuzukler', 'Akıllı Yüzükler', 11),
  ('telefon', null::uuid, 'telsiz-masaustu-telefonlar', 'Telsiz & Masaüstü Telefonlar', 12),
  ('ev-yasam', null::uuid, 'ev-tekstili', 'Ev Tekstili', 1),
  ('ev-yasam', null::uuid, 'ev-gerecleri', 'Ev Gereçleri', 2),
  ('ev-yasam', null::uuid, 'aydinlatma', 'Aydınlatma', 3),
  ('ev-yasam', null::uuid, 'banyo-mutfak', 'Banyo & Mutfak', 4),
  ('ev-yasam', null::uuid, 'mobilya', 'Mobilya', 5),
  ('ev-yasam', null::uuid, 'dekorasyon', 'Dekorasyon', 6),
  ('beyaz-esya-mutfak', null::uuid, 'beyaz-esya-ankastre', 'Beyaz Eşya & Ankastre', 1),
  ('beyaz-esya-mutfak', null::uuid, 'elektrikli-mutfak-aletleri', 'Elektrikli Mutfak Aletleri', 2),
  ('beyaz-esya-mutfak', null::uuid, 'mutfak-gerecleri', 'Mutfak Gereçleri', 3),
  ('kozmetik', null::uuid, 'makyaj-urunleri', 'Makyaj Ürünleri', 1),
  ('kozmetik', null::uuid, 'cilt-bakimi', 'Cilt Bakımı', 2),
  ('kozmetik', null::uuid, 'kisisel-bakim', 'Kişisel Bakım', 3),
  ('kozmetik', null::uuid, 'parfum', 'Parfüm', 4),
  ('kozmetik', null::uuid, 'gunes-urunleri', 'Güneş Ürünleri', 5),
  ('kozmetik', null::uuid, 'sac-bakim-urunleri', 'Saç Bakım Ürünleri', 6),
  ('kozmetik', null::uuid, 'ayak-tirnak-bakimi', 'Ayak & Tırnak Bakımı', 7),
  ('kozmetik', null::uuid, 'agiz-bakim-urunleri', 'Ağız Bakım Ürünleri', 8),
  ('kozmetik', null::uuid, 'besin-takviyeleri-vitaminler', 'Besin (Gıda) Takviyeleri & Vitaminler', 9),
  ('kozmetik', null::uuid, 'hijyen-urunleri', 'Hijyen Ürünleri', 10),
  ('kozmetik', null::uuid, 'kadin-pedleri', 'Kadın Pedleri & Hijyen Ürünleri', 11),
  ('kozmetik', null::uuid, 'saglik-urunleri', 'Sağlık Ürünleri', 12),
  ('kozmetik', null::uuid, 'medikal-urunler', 'Medikal Ürünler', 13),
  ('spor-outdoor', null::uuid, 'doga-sporlari', 'Doğa Sporları', 1),
  ('spor-outdoor', null::uuid, 'kis-sporlari', 'Kış Sporları', 2),
  ('spor-outdoor', null::uuid, 'spor-giyim-aksesuar', 'Spor Giyim & Aksesuar', 3),
  ('spor-outdoor', null::uuid, 'outdoor', 'Outdoor', 4),
  ('spor-outdoor', null::uuid, 'kamp-malzemeleri', 'Kamp & Kampçılık Malzemeleri', 5),
  ('spor-outdoor', null::uuid, 'av-malzemeleri', 'Kara & Balık Av Malzemeleri', 6),
  ('spor-outdoor', null::uuid, 'fitness-kondisyon', 'Fitness & Kondisyon', 7),
  ('spor-outdoor', null::uuid, 'taraftar-urunleri', 'Taraftar Ürünleri', 8),
  ('spor-outdoor', null::uuid, 'spor-branslari', 'Spor Branşları', 9),
  ('supermarket', null::uuid, 'gida', 'Gıda', 1),
  ('supermarket', null::uuid, 'icecek', 'İçecek', 2),
  ('supermarket', null::uuid, 'deterjan-temizlik', 'Deterjan, Temizlik Ürünleri', 3),
  ('supermarket', null::uuid, 'kagit-urunleri', 'Kağıt Ürünleri', 4),
  ('supermarket', null::uuid, 'bebek-bezi-islak-mendil', 'Bebek Bezi, Islak Mendil', 5),
  ('supermarket', null::uuid, 'hijyenik-pedler', 'Hijyenik Pedler', 6),
  ('supermarket', null::uuid, 'mutfak-sarf-malzemeleri', 'Mutfak Sarf Malzemeleri', 7),
  ('supermarket', null::uuid, 'ofis-tuketim-malzemeleri', 'Ofis Tüketim Malzemeleri', 8),
  ('ev-elektronigi', null::uuid, 'supurgeler', 'Süpürgeler', 1),
  ('ev-elektronigi', null::uuid, 'hava-temizleme-nem-alma', 'Hava Temizleme & Nem Alma Cihazları', 2),
  ('ev-elektronigi', null::uuid, 'ses-goruntu-sistemleri', 'Ses ve Görüntü Sistemleri', 3),
  ('ev-elektronigi', null::uuid, 'kucuk-mutfak-aletleri', 'Küçük Mutfak Aletleri', 4),
  ('ev-elektronigi', null::uuid, 'isitma-sogutma', 'Isıtma ve Soğutma', 5),
  ('ev-elektronigi', null::uuid, 'dikis-makinalari', 'Dikiş Makinaları & Aksesuarları', 6),
  ('ev-elektronigi', null::uuid, 'utuler', 'Ütüler', 7),
  ('anne-bebek', null::uuid, 'bebek-aktivite-eglence', 'Bebek Aktivite ve Eğlence', 1),
  ('anne-bebek', null::uuid, 'bebek-bakim-saglik', 'Bebek Bakım ve Sağlık', 2),
  ('anne-bebek', null::uuid, 'bebek-banyo-tuvalet', 'Bebek Banyo ve Tuvalet', 3),
  ('anne-bebek', null::uuid, 'bebek-beslenme', 'Bebek Beslenme', 4),
  ('anne-bebek', null::uuid, 'bebek-guvenlik', 'Bebek Güvenlik', 5),
  ('anne-bebek', null::uuid, 'bebek-hediyelik', 'Bebek Hediyelik', 6),
  ('anne-bebek', null::uuid, 'bebek-odasi-tekstili', 'Bebek Odası ve Tekstili', 7),
  ('anne-bebek', null::uuid, 'bebek-tasima', 'Bebek Taşıma', 8),
  ('anne-bebek', null::uuid, 'emzirme-anne-saglik', 'Emzirme ve Anne Sağlık', 9),
  ('anne-bebek', null::uuid, 'mama-sandalyesi', 'Mama Sandalyesi ve Aksesuarı', 10),
  ('anne-bebek', null::uuid, 'oto-koltugu', 'Oto Koltuğu & Aksesuar', 11),
  ('yapi-market-bahce-oto', null::uuid, 'yapi-market', 'Yapı Market', 1),
  ('yapi-market-bahce-oto', null::uuid, 'bahce', 'Bahçe', 2),
  ('yapi-market-bahce-oto', null::uuid, 'motosiklet', 'Motosiklet', 3),
  ('yapi-market-bahce-oto', null::uuid, 'oto-aksesuar', 'Oto Aksesuar', 4),
  ('elektronik', null::uuid, 'ag-modem', 'Ağ / Modem', 1),
  ('elektronik', null::uuid, 'elektronik-aksesuarlar', 'Aksesuarlar', 2),
  ('elektronik', null::uuid, 'bilgisayar-bilesenleri', 'Bilgisayar Bileşenleri', 3),
  ('elektronik', 'c0000000-0000-4000-8000-000000000012'::uuid, 'bilgisayar', 'Bilgisayarlar', 4),
  ('elektronik', null::uuid, 'bilgisayar-yedek-parcalari', 'Bilgisayar Yedek Parçaları', 5),
  ('elektronik', null::uuid, 'cevre-birimleri', 'Çevre Birimleri', 6),
  ('elektronik', null::uuid, 'mp3-ses-kayit', 'MP3 / Ses Kayıt Cihazları', 7),
  ('elektronik', null::uuid, 'veri-depolama', 'Veri Depolama', 8),
  ('elektronik', null::uuid, 'yazici', 'Yazıcı', 9),
  ('elektronik', null::uuid, 'yazilim-urunleri', 'Yazılım Ürünleri', 10),
  ('elektronik', null::uuid, 'oyuncu-ozel', 'Oyuncu Özel', 11),
  ('elektronik', 'c0000000-0000-4000-8000-000000000013'::uuid, 'kulaklik', 'Kulaklık', 12),
  ('kitap-kirtasiye-ofis', null::uuid, 'kitap', 'Kitap', 1),
  ('kitap-kirtasiye-ofis', null::uuid, 'fotokopi-kagitlari', 'Fotokopi Kağıtları', 2),
  ('kitap-kirtasiye-ofis', null::uuid, 'ofis-mobilyalari', 'Ofis Mobilyaları', 3),
  ('kitap-kirtasiye-ofis', null::uuid, 'ofis-teknolojileri', 'Ofis Teknolojileri', 4),
  ('kitap-kirtasiye-ofis', null::uuid, 'ofis-okul-kirtasiye', 'Ofis ve Okul Kırtasiye', 5),
  ('kitap-kirtasiye-ofis', null::uuid, 'projeksiyon-sistemleri', 'Projeksiyon Sistemleri', 6),
  ('kitap-kirtasiye-ofis', null::uuid, 'sanatsal-boya-malzeme', 'Sanatsal Boya ve Malzeme', 7),
  ('oyuncak-muzik-film', null::uuid, 'muzik', 'Müzik', 1),
  ('oyuncak-muzik-film', null::uuid, 'film', 'Film', 2),
  ('oyuncak-muzik-film', null::uuid, 'oyuncak', 'Oyuncak', 3),
  ('oyuncak-muzik-film', null::uuid, 'hobi-eglence', 'Hobi & Eğlence', 4),
  ('oyuncak-muzik-film', null::uuid, 'elektronik-devre-robotik', 'Elektronik Devre & Robotik', 5),
  ('oyuncak-muzik-film', null::uuid, 'oyun-konsollari', 'Oyun & Oyun Konsolları', 6),
  ('altin-taki-mucevher', null::uuid, '22-ayar-takilar', '22 Ayar Takılar', 1),
  ('altin-taki-mucevher', null::uuid, '22-ayar-yatirimlik-bilezik', '22 Ayar Yatırımlık Bilezik', 2),
  ('altin-taki-mucevher', null::uuid, 'cumhuriyet-altini', 'Cumhuriyet Altını', 3),
  ('altin-taki-mucevher', null::uuid, 'gram-kulce-altin', 'Gram Külçe Altın', 4),
  ('altin-taki-mucevher', null::uuid, 'hediyelik-altin', 'Hediyelik Altın', 5),
  ('altin-taki-mucevher', null::uuid, 'kulce-gumus', 'Külçe Gümüş', 6),
  ('altin-taki-mucevher', null::uuid, 'resat-altin', 'Reşat Altın', 7),
  ('altin-taki-mucevher', null::uuid, 'ziynet-altin', 'Ziynet Altın', 8),
  ('altin-taki-mucevher', null::uuid, 'taki-mucevher', 'Takı & Mücevher', 9),
  ('petshop', null::uuid, 'kopek', 'Köpek', 1),
  ('petshop', null::uuid, 'kedi', 'Kedi', 2),
  ('petshop', null::uuid, 'balik', 'Balık', 3),
  ('petshop', null::uuid, 'kus', 'Kuş', 4),
  ('petshop', null::uuid, 'hamster-tavsan', 'Hamster & Tavşan', 5),
  ('petshop', null::uuid, 'kaplumbaga', 'Kaplumbağa', 6)
) as v(ust, id, slug, ad, sira)
join public.categories u on u.slug = v.ust::citext
on conflict (slug) do update
  set name = excluded.name,
      parent_id = excluded.parent_id,
      sort_order = excluded.sort_order,
      is_active = true;
