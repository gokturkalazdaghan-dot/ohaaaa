-- ===========================================================================
-- YENİDEN DÜZENLEMEDEN SONRA EŞLEME KURALLARININ TAZELENMESİ
-- ===========================================================================
--
-- NEDEN AYRI BİR GÖÇ
-- `category_source_map` kurallarının bir kısmı KATALOĞUN ADLARINDAN
-- türetiliyor (`kategori_ad_kurallarini_tazele`). Üç seviyeli yeniden
-- düzenleme 24 kategorinin adını değiştirdi ve iki yeni kategori açtı:
-- "Gaming & Konsol", "Tabletler", "Elektronik Aksesuarlar", "Kırtasiye",
-- "Dijital Oyun & Oyun Kodları"...
--
-- Tazeleme koşmasaydı, bir kaynak "Gaming & Konsol" ya da "Tabletler"
-- yazdığında HİÇBİR kurala düşmez ve ürün sınıflandırılmamış kalırdı.
-- Yani ad değişikliği eşlemeyi SESSİZCE eksik bırakırdı -- hata düşmez,
-- yalnızca o feed'in ürünleri kategorisiz durur.
--
-- Ayrıca `99_kanonik_taksonomi_test.sql` "ad türetmesi idempotent" diye bir
-- iddia taşıyor: göçler koştuktan sonra tazeleme SIFIR satır eklemeli.
-- Bu göç olmadan o test kırmızıya düşüyordu (ölçüldü: 24 satır eksik).
--
-- İDEMPOTENT: `on conflict do nothing` sayesinde üretimde ikinci kez
-- koştuğunda 0 satır ekler. Elle yazılmış KAPSAM DIŞI kuralları (gıda,
-- alkol, tütün) ezmez -- ezseydi bilerek dışarıda bıraktığımız ürünler
-- sessizce vitrine girerdi.
-- ===========================================================================
do $$
declare n integer;
begin
  select public.kategori_ad_kurallarini_tazele() into n;
  raise notice 'Uc seviyeli taksonomi sonrasi turetilen esleme kurali: %', n;

  -- Tazeleme İKİ KEZ koşmamalı: ikincisi satır eklerse `on conflict`
  -- koruması çalışmıyor demektir ve tablo her dağıtımda şişerdi.
  select public.kategori_ad_kurallarini_tazele() into n;
  if n <> 0 then
    raise exception
      'DOGRULAMA: ad turetmesi idempotent degil (% satir). Tablo her '
      'dagitimda buyurdu.', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- YENİ KANONİK ADLAR GERÇEKTEN ÇÖZÜLÜYOR MU
-- ---------------------------------------------------------------------------
-- Türetmenin koştuğunu görmek yetmez: türetilen kuralın ÇÖZÜCÜDEN geçtiğini
-- de görmek gerek. Aradaki normalleştirme (Türkçe 'İ', '&', boşluk) ayrışırsa
-- kural tabloda durur ama hiçbir zaman eşleşmez.
do $$
declare v_r record;
begin
  select * into v_r from public.kanonik_kategori('yeni-pazaryeri', 'Gaming & Konsol');
  if v_r.slug is distinct from 'gaming-konsol' then
    raise exception
      'DOGRULAMA: yeni ana kategori adi cozulmedi (%).', coalesce(v_r.slug, 'NULL');
  end if;

  select * into v_r from public.kanonik_kategori('yeni-pazaryeri', 'Tabletler');
  if v_r.slug is distinct from 'tablet' then
    raise exception
      'DOGRULAMA: "Tabletler" cozulmedi (%).', coalesce(v_r.slug, 'NULL');
  end if;

  -- Yol biçiminde gelen değer de en spesifik parçadan çözülmeli: üç seviyeli
  -- bir kaynak taksonomisi tam olarak böyle gelir.
  select * into v_r from public.kanonik_kategori(
    'yeni-pazaryeri', 'Bilgisayar & Teknoloji > Bilgisayar Bileşenleri > Ekran Kartı');
  if v_r.slug is distinct from 'ekran-karti' then
    raise exception
      'DOGRULAMA: uc seviyeli kaynak yolu en spesifik parcadan cozulmedi (%) '
      '-- ekran karti, genel bilgisayar kategorisine duserdi.',
      coalesce(v_r.slug, 'NULL');
  end if;

  -- KAPSAM DIŞI kararı türetmeyle EZİLMEDİ.
  select * into v_r from public.kanonik_kategori('awin', 'Food & Drink');
  if not coalesce(v_r.kapsam_disi, false) then
    raise exception
      'DOGRULAMA: gida kurali ad turetmesiyle ezilmis -- bilerek disarida '
      'biraktigimiz urunler vitrine girerdi.';
  end if;

  raise notice 'Yeni kanonik adlar cozucuden geciyor; kapsam disi kararlari korundu.';
end $$;
