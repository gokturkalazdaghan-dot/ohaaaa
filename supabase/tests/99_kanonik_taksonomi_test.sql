-- ============================================================================
-- KANONİK TAKSONOMİ — kataloğun omurgası sessizce kaymasın
-- ----------------------------------------------------------------------------
-- Taksonomi üç yerde birden yaşıyor: `categories` ağacı, `category_source_map`
-- eşlemesi ve `/kategori/<slug>` URL'leri. Üçü de bir migration'la değişebilir
-- ve ikisi bozulduğunda site ÇALIŞMAYA DEVAM EDER -- yalnızca ürünler yanlış
-- yere düşer ya da hiç görünmez. Sessiz bozulma, bu dosyanın var olma sebebi.
--
-- Burada iddia edilen her şey ÖLÇÜLDÜ; hiçbiri "böyle olmalı" temennisi değil.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1) 18 SEVİYE-1 KATEGORİ
-- ---------------------------------------------------------------------------
-- Sayı sabitlenmezse yeni bir migration 19'uncuyu ekler, ana menü taşar ve
-- kimse fark etmez. Değiştirmek bir KARAR olsun, kaza olmasın.
do $$
declare n int;
begin
  select count(*) into n from public.categories where parent_id is null;
  if n <> 18 then
    raise exception 'BAŞARISIZ: Seviye-1 kategori sayisi % (18 bekleniyordu)', n;
  end if;
  raise notice '✓ 18 Seviye-1 kategori';
end $$;

-- ---------------------------------------------------------------------------
-- 2) YİNELENEN KATEGORİ YOK
-- ---------------------------------------------------------------------------
-- Aynı kategori iki kez oluşursa ürünler ikiye bölünür: iki sayfa, iki yarım
-- katalog, tek bir doğru sayfa yok.
do $$
declare n int;
begin
  select count(*) into n from (
    select slug from public.categories group by slug having count(*) > 1
  ) t;
  if n > 0 then
    raise exception 'BAŞARISIZ: % yinelenen slug', n;
  end if;

  select count(*) into n from (
    select parent_id, lower(name) from public.categories group by 1, 2 having count(*) > 1
  ) t;
  if n > 0 then
    raise exception 'BAŞARISIZ: ayni ebeveyn altinda % yinelenen ad', n;
  end if;
  raise notice '✓ yinelenen kategori yok';
end $$;

-- ---------------------------------------------------------------------------
-- 3) AĞAÇ BÜTÜNLÜĞÜ
-- ---------------------------------------------------------------------------
-- Yetim `parent_id`, kategori menüsünü sessizce yarım gösterir; yetim
-- `category_id`, ürünü hiçbir sayfada görünmez yapar.
do $$
declare n int;
begin
  select count(*) into n from public.categories c
   where c.parent_id is not null
     and not exists (select 1 from public.categories p where p.id = c.parent_id);
  if n > 0 then raise exception 'BAŞARISIZ: % yetim parent_id', n; end if;

  select count(*) into n from public.product_groups pg
   where pg.category_id is not null
     and not exists (select 1 from public.categories c where c.id = pg.category_id);
  if n > 0 then raise exception 'BAŞARISIZ: % yetim category_id', n; end if;

  select count(*) into n from public.categories
   where slug is null or length(btrim(slug::text)) = 0;
  if n > 0 then raise exception 'BAŞARISIZ: % bos slug (SEO rotasi kirilir)', n; end if;

  raise notice '✓ agac butunlugu: yetim yok, bos slug yok';
end $$;

-- ---------------------------------------------------------------------------
-- 4) GIDA KAPSAM DIŞI
-- ---------------------------------------------------------------------------
-- Ohaaaa gıda satmıyor. "Süpermarket" BİLEREK aktif: gıda dışı market ürünleri
-- (deterjan, kağıt, temizlik) oraya gidiyor. Gıda/içecek ise PASİF olmalı ve
-- içinde ürün bulunmamalı -- ikisinden biri bile kayarsa vitrinde yiyecek çıkar.
do $$
declare aktif boolean; n int;
begin
  for aktif in select is_active from public.categories where slug::text in ('gida','icecek') loop
    if aktif then raise exception 'BAŞARISIZ: gida/icecek kategorisi AKTIF'; end if;
  end loop;

  select count(*) into n
    from public.product_groups pg
    join public.categories c on c.id = pg.category_id
   where c.slug::text in ('gida','icecek');
  if n > 0 then raise exception 'BAŞARISIZ: gida kategorisinde % urun grubu', n; end if;

  raise notice '✓ gida kapsam disi: kategori pasif, icinde urun yok';
end $$;

-- ---------------------------------------------------------------------------
-- 5) YETİŞKİN VE MEDİKAL AYRIMI
-- ---------------------------------------------------------------------------
-- +18 ürünler AYRI bir Seviye-1'de duruyor ve oraya karışan her şey
-- işaretli olmalı; işaretsiz bir çocuk, yaş kapısını atlatırdı.
-- Aynı şekilde reçeteli ilaç tipi ürünler Sağlık & Medikal altında
-- KONTROLSÜZ listelenmesin diye o dal da işaretli.
do $$
declare n int;
begin
  select count(*) into n
    from public.categories c
    join public.categories p on p.id = c.parent_id
   where p.slug::text = 'yetiskin-urunleri'
     and c.access_restriction is distinct from 'adult';
  if n > 0 then raise exception 'BAŞARISIZ: yetiskin dalinda % isaretsiz kategori', n; end if;

  select count(*) into n from public.categories
   where slug::text = 'yetiskin-urunleri' and (parent_id is not null or access_restriction is distinct from 'adult');
  if n > 0 then raise exception 'BAŞARISIZ: yetiskin-urunleri ayri Seviye-1 degil ya da isaretsiz'; end if;

  select count(*) into n
    from public.categories c
    join public.categories p on p.id = c.parent_id
   where p.slug::text = 'saglik-medikal'
     and c.access_restriction is distinct from 'medical';
  if n > 0 then raise exception 'BAŞARISIZ: saglik dalinda % isaretsiz kategori', n; end if;

  raise notice '✓ yetiskin ayri Seviye-1 ve isaretli; saglik dali medikal isaretli';
end $$;

-- ---------------------------------------------------------------------------
-- 6) EŞLEME TABLOSU TUTARLI
-- ---------------------------------------------------------------------------
-- Bir kuralın ya HEDEFİ vardır ya da KAPSAM DIŞI gerekçesi. İkisi de yoksa
-- kural hiçbir şey yapmıyor ama "eşlendi" gibi görünüyor demektir -- eşlemenin
-- en zararlı hali budur, çünkü eksikliği gizler.
do $$
declare n int;
begin
  select count(*) into n from public.category_source_map
   where category_id is null and length(btrim(coalesce(excluded_reason,''))) = 0;
  if n > 0 then raise exception 'BAŞARISIZ: % kural ne hedefli ne gerekceli', n; end if;

  select count(*) into n from public.category_source_map m
   where m.category_id is not null
     and not exists (select 1 from public.categories c where c.id = m.category_id);
  if n > 0 then raise exception 'BAŞARISIZ: % kural var olmayan kategoriye bakiyor', n; end if;

  raise notice '✓ esleme tablosu tutarli';
end $$;

-- ---------------------------------------------------------------------------
-- 7) ÇÖZÜCÜ: AYNI ÜRÜN, FARKLI KAYNAK, AYNI KATEGORİ
-- ---------------------------------------------------------------------------
-- Karşılaştırma sitesinin tek işi bu: Awin "Menswear" ile Türkçe bir kaynağın
-- "Erkek Giyim"i AYNI kanonik kategoriye düşmezse, aynı ürün iki ayrı sayfada
-- yarımşar durur ve fiyat karşılaştırması ANLAMINI kaybeder.
do $$
declare a uuid; b uuid;
begin
  select category_id into a from public.kanonik_kategori('awin', 'Retail > Clothing > Menswear');
  select category_id into b from public.kanonik_kategori('trendyol', 'Erkek Giyim');
  if a is null or b is null or a <> b then
    raise exception 'BAŞARISIZ: ayni urun farkli kaynakta farkli kategoriye dustu (% vs %)', a, b;
  end if;
  raise notice '✓ kaynaklar arasi tutarlilik: Menswear = Erkek Giyim';
end $$;

-- ---------------------------------------------------------------------------
-- 8) ÇÖZÜCÜ: GIDA VE TÜTÜN KAPSAM DIŞI KALIYOR
-- ---------------------------------------------------------------------------
-- Ad türetmesi (`kategori_ad_kurallarini_tazele`) kataloğun ADLARINDAN kural
-- üretiyor. Eğer o türetme, elle KAPSAM DIŞI işaretlenmiş gıda/tütün kurallarını
-- ezerse, bilerek dışarıda bıraktığımız ürünler sessizce vitrine girerdi.
do $$
declare d boolean; s text;
begin
  select kapsam_disi, sebep into d, s from public.kanonik_kategori('awin', 'Food & Drink');
  if not coalesce(d, false) then raise exception 'BAŞARISIZ: gida kapsam disi degil (sebep=%)', s; end if;

  select kapsam_disi, sebep into d, s from public.kanonik_kategori('awin', 'Tobacco');
  if not coalesce(d, false) then raise exception 'BAŞARISIZ: tutun kapsam disi degil (sebep=%)', s; end if;

  raise notice '✓ gida ve tutun cozucude de kapsam disi';
end $$;

-- ---------------------------------------------------------------------------
-- 9) ÇÖZÜCÜ BULANIK EŞLEŞME YAPMIYOR
-- ---------------------------------------------------------------------------
-- "Department Stores" bir ürün kategorisi değil, bir iş modeli tarifi. Böyle bir
-- değeri bir kategoriye bağlamak, yazı tura atıp sonucu veri diye kaydetmektir.
-- Yanlış kategori, kategorisizlikten ZARARLIDIR: kullanıcı yanlış sayfada arar.
do $$
declare n int;
begin
  select count(*) into n from public.kanonik_kategori('awin', 'Department Stores')
   where category_id is not null;
  if n > 0 then raise exception 'BAŞARISIZ: belirsiz deger bir kategoriye baglandi'; end if;
  raise notice '✓ bulanik esleme yok';
end $$;

-- ---------------------------------------------------------------------------
-- 10) AD TÜRETMESİ IDEMPOTENT
-- ---------------------------------------------------------------------------
-- Migration'lar yeniden koşabilir. İkinci çalıştırma satır eklerse tablo her
-- dağıtımda şişer ve `on conflict` korumasının çalışmadığı anlaşılmış olur.
do $$
declare n int;
begin
  select public.kategori_ad_kurallarini_tazele() into n;
  if n <> 0 then
    raise exception 'BAŞARISIZ: ad turetmesi idempotent degil (% satir eklendi)', n;
  end if;
  raise notice '✓ ad turetmesi idempotent';
end $$;

-- ---------------------------------------------------------------------------
-- 11) TÜRKÇE 'İ' TUZAĞI
-- ---------------------------------------------------------------------------
-- `'İ'.toLowerCase()` JavaScript'te İKİ karakter üretir (i + U+0307). Anahtar
-- üretimi bunu ele almazsa "İç Giyim" gibi bir değer TS tarafında bir anahtara,
-- SQL tarafında BAŞKA bir anahtara iner; eşleme bir katmanda tutar, diğerinde
-- tutmaz ve fark SESSİZ kalır.
do $$
declare a text;
begin
  select public.kategori_anahtar('İç Giyim') into a;
  if a <> 'ic-giyim' then
    raise exception 'BAŞARISIZ: Turkce I anahtari yanlis: % (ic-giyim bekleniyordu)', a;
  end if;
  select public.kategori_anahtar('Kadın Giyim') into a;
  if a <> 'kadin-giyim' then
    raise exception 'BAŞARISIZ: noktasiz i anahtari yanlis: %', a;
  end if;
  raise notice '✓ Turkce harf normalizasyonu dogru';
end $$;

-- ---------------------------------------------------------------------------
-- 12) ÇÖZÜCÜ İSTEMCİYE KAPALI
-- ---------------------------------------------------------------------------
-- `kanonik_kategori` SECURITY DEFINER. İstemciye açık kalsaydı, RLS'i atlayan
-- bir fonksiyon tarayıcıdan çağrılabilirdi.
do $$
begin
  if has_function_privilege('anon', 'public.kanonik_kategori(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.kanonik_kategori(text, text)', 'execute') then
    raise exception 'BAŞARISIZ: kanonik_kategori istemciye acik';
  end if;
  if has_function_privilege('anon', 'public.kategori_ad_kurallarini_tazele()', 'execute')
     or has_function_privilege('authenticated', 'public.kategori_ad_kurallarini_tazele()', 'execute') then
    raise exception 'BAŞARISIZ: kategori_ad_kurallarini_tazele istemciye acik';
  end if;
  raise notice '✓ cozucu ve tazeleme istemciye kapali';
end $$;

rollback;
