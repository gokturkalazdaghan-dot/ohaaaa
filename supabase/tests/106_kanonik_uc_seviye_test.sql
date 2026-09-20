-- ============================================================================
-- ÜÇ SEVİYELİ KANONİK TAKSONOMİ — sessiz kaymaya karşı
-- ----------------------------------------------------------------------------
-- 99_kanonik_taksonomi_test.sql ağacın BÜTÜNLÜĞÜNÜ koruyor (18 ana kategori,
-- yinelenen yok, yetim yok). Bu dosya SEVİYE sözleşmesini koruyor:
--
--   L1 = Ana Kategori · L2 = Alt Kategori · L3 = Ürün Kategorisi
--
-- Buradaki iddiaların hepsi, bozulduğunda SİTEYİ ÇALIŞIR HÂLDE BIRAKAN
-- türden: sayfa açılır, ürün listeler, hata düşmez -- yalnızca katalogun bir
-- kısmı görünmez olur ya da ürün yanlış rafa düşer. Bu dosyanın var olma
-- sebebi tam olarak o.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1) DERİNLİK ÜÇTE KİLİTLİ
-- ---------------------------------------------------------------------------
-- Dördüncü seviye açılırsa menü ve arama kapsamı (üç seviye varsayıyor) o
-- dalı hiç göstermez: ürünler veritabanında var, vitrinde yok.
do $$
declare n int;
begin
  if exists (select 1 from public.categories where tree_level is null) then
    raise exception 'BAŞARISIZ: tree_level bos kalan kategori var';
  end if;

  select count(*) into n from public.categories where tree_level not between 1 and 3;
  if n > 0 then raise exception 'BAŞARISIZ: uc seviyeyi asan % kategori', n; end if;

  select count(*) into n
    from public.categories c
    left join public.categories p on p.id = c.parent_id
   where c.tree_level <> coalesce(p.tree_level, 0) + 1;
  if n > 0 then
    raise exception 'BAŞARISIZ: % kategoride tree_level ust kategoriyle celisiyor', n;
  end if;

  raise notice '✓ derinlik uc seviye, tree_level agacla tutarli';
end $$;

-- ---------------------------------------------------------------------------
-- 2) DÖRDÜNCÜ SEVİYE VERİTABANI TARAFINDAN REDDEDİLİYOR
-- ---------------------------------------------------------------------------
-- Kuralı yazmak yetmez. Uygulanmadığını ancak deneyerek anlarız; uygulanmasa
-- kural bir yorum satırından ibaret kalırdı.
do $$
declare v_l3 uuid;
begin
  select id into v_l3 from public.categories where tree_level = 3 limit 1;
  if v_l3 is null then
    raise exception 'KURGU HATASI: katalogda hic L3 kategori yok, test anlamsiz';
  end if;

  begin
    insert into public.categories (slug, name, parent_id)
    values ('test-dorduncu-seviye', 'Test Dorduncu Seviye', v_l3);
    raise exception 'BAŞARISIZ: dorduncu seviye kategori KABUL EDILDI';
  exception when raise_exception then
    if sqlerrm like 'BAŞARISIZ:%' then raise; end if;
  end;

  raise notice '✓ dorduncu seviye reddediliyor';
end $$;

-- ---------------------------------------------------------------------------
-- 3) SEVİYE, ÜST KATEGORİ TAŞINDIĞINDA DA DOĞRU KALIYOR
-- ---------------------------------------------------------------------------
-- Ölçülen hata buydu: `after update of tree_level` yazan tetikleyici hiç
-- koşmuyordu (sütun UPDATE'in SET listesinde geçmiyor) ve bir kategori
-- üstüyle AYNI seviyede kalıyordu. Hiçbir kısıt ihlal edilmediği için
-- sessizdi.
do $$
declare v_l1 uuid; v_a uuid; v_b uuid;
begin
  select id into v_l1 from public.categories where parent_id is null limit 1;

  insert into public.categories (slug, name, parent_id)
       values ('test-seviye-ust', 'Test Seviye Ust', v_l1) returning id into v_a;
  insert into public.categories (slug, name, parent_id)
       values ('test-seviye-alt', 'Test Seviye Alt', v_a) returning id into v_b;

  if (select tree_level from public.categories where id = v_b) <> 3 then
    raise exception 'BAŞARISIZ: yeni cocuk yanlis seviyede acildi';
  end if;

  -- Üstü bir seviye yukarı çıkarıyoruz: çocuğun da yukarı gelmesi gerek.
  update public.categories set parent_id = null where id = v_a;

  if (select tree_level from public.categories where id = v_a) <> 1 then
    raise exception 'BAŞARISIZ: ust kategori seviyesi guncellenmedi';
  end if;
  if (select tree_level from public.categories where id = v_b) <> 2 then
    raise exception
      'BAŞARISIZ: ust tasininca cocugun seviyesi guncellenmedi -- tree_level '
      'veriyle celiserek sessizce yanlis kalirdi';
  end if;

  raise notice '✓ seviye, ust kategori tasindiginda alt agaca yayiliyor';
end $$;

-- ---------------------------------------------------------------------------
-- 4) KAPSAM ÜÇ SEVİYE İNİYOR, YUKARI SIZMIYOR
-- ---------------------------------------------------------------------------
-- İnmezse: ana kategori sayfası L3 ürünlerini gizler.
-- Sızarsa: her kategori sayfası "her şey" sayfasına döner.
do $$
declare v_l1 uuid; v_l2 uuid; v_l3 uuid; n bigint;
begin
  select c.id, p.id, gp.id into v_l3, v_l2, v_l1
    from public.categories c
    join public.categories p  on p.id = c.parent_id
    join public.categories gp on gp.id = p.parent_id
   where c.tree_level = 3 and c.is_active and p.is_active and gp.is_active
   limit 1;

  if v_l3 is null then
    raise exception 'KURGU HATASI: L1>L2>L3 zinciri bulunamadi';
  end if;

  select count(*) into n from public.kategori_kapsami(v_l1) where category_id = v_l3;
  if n <> 1 then raise exception 'BAŞARISIZ: L1 kapsami L3 u gormuyor'; end if;

  select count(*) into n from public.kategori_kapsami(v_l2) where category_id = v_l3;
  if n <> 1 then raise exception 'BAŞARISIZ: L2 kapsami L3 u gormuyor'; end if;

  select count(*) into n from public.kategori_kapsami(v_l3);
  if n <> 1 then
    raise exception 'BAŞARISIZ: L3 kapsami % satir dondurdu (kendisi bekleniyordu)', n;
  end if;

  raise notice '✓ kategori kapsami uc seviye iniyor, yukari sizmiyor';
end $$;

-- ---------------------------------------------------------------------------
-- 5) ARAMA KAPSAMI DA ÜÇ SEVİYE — FONKSİYON DEĞİL, SONUÇ ÖLÇÜLÜYOR
-- ---------------------------------------------------------------------------
-- `kategori_kapsami` doğru olup arama onu kullanmıyor olabilirdi. Tek kanıt,
-- gerçek bir ürünün ana kategori aramasında çıkması.
do $$
declare v_l1 uuid; v_l3 uuid; v_g uuid; v_baska uuid; n bigint;
begin
  select c.id, gp.id into v_l3, v_l1
    from public.categories c
    join public.categories p  on p.id = c.parent_id
    join public.categories gp on gp.id = p.parent_id
   where c.tree_level = 3 and c.is_active
   limit 1;

  select id into v_baska from public.categories
   where parent_id is null and is_active and id <> v_l1 limit 1;

  -- Deneme urunu BASLIKLA araniyor, sayfanin ilk 100'unde DEGIL: bu dosya
  -- tohum kataloguyla kosuyor ama ayni iddia uretim olceginde de
  -- gecerli olmali. Sayfaya bakan bir iddia, katalog buyudugunde kapsam
  -- DOGRUYKEN kirmiziya doner.
  insert into public.product_groups (slug, title, category_id, offer_count, min_price_cents)
       values ('test-l3-arama', 'zztestl3arama', v_l3, 1, 1000)
    returning id into v_g;

  select count(*) into n
    from public.search_products('zztestl3arama', v_l1, null, null, 'relevance', 100, 0)
   where group_id = v_g;
  if n <> 1 then
    raise exception
      'BAŞARISIZ: urun kategorisindeki (L3) urun ANA kategori aramasinda '
      'cikmadi -- katalogun bir kismi sessizce gorunmez olurdu';
  end if;

  select count(*) into n
    from public.search_products('zztestl3arama', v_baska, null, null, 'relevance', 100, 0)
   where group_id = v_g;
  if n <> 0 then
    raise exception 'BAŞARISIZ: urun baska bir ana kategoride de gorundu';
  end if;

  -- Filtre sayacı da aynı kapsamı kullanmalı: sayı ile liste ayrışırsa
  -- kullanıcı dolu bir kategoriyi sıfır sanıp hiç tıklamaz.
  if coalesce((
       select (e ->> 'count')::bigint
         from jsonb_array_elements(public.search_facets() -> 'categories') e
        where (e ->> 'id')::uuid = v_l1
     ), 0) < 1 then
    raise exception 'BAŞARISIZ: filtre sayaci L3 urununu saymadi';
  end if;

  raise notice '✓ arama ve filtre sayaclari L3 urunlerini goruyor';
end $$;

-- ---------------------------------------------------------------------------
-- 6) BİRLEŞTİRİLEN KATEGORİ: ÜRÜN YOK, ADRES VAR
-- ---------------------------------------------------------------------------
-- Birleştirilen bir kategoride ürün kalırsa o ürünler vitrinde görünmez.
-- Yönlendirme çalışmazsa eski adres 404 döner ve o sayfanın SEO değeri gider.
do $$
declare n bigint; v_hedef text;
begin
  select count(*) into n
    from public.product_groups g
    join public.categories c on c.id = g.category_id
   where c.merged_into_id is not null;
  if n > 0 then
    raise exception 'BAŞARISIZ: % urun grubu birlestirilmis kategoride', n;
  end if;

  if exists (select 1 from public.categories where merged_into_id is not null and is_active) then
    raise exception 'BAŞARISIZ: birlestirilmis bir kategori hala ETKIN';
  end if;

  -- Yönlendirme her birleştirilmiş slug için ETKİN bir hedef vermeli.
  select count(*) into n
    from public.categories c
    left join lateral public.kategori_yonlendirme(c.slug::text) y on true
    left join public.categories h on h.id = y.hedef_id
   where c.merged_into_id is not null
     and (y.hedef_id is null or not h.is_active);
  if n > 0 then
    raise exception
      'BAŞARISIZ: % birlestirilmis kategori etkin bir hedefe yonlendirmiyor '
      '-- eski adres 404 donerdi', n;
  end if;

  -- Birleştirilmemiş slug yönlendirmez: her sayfada gereksiz 301 kurmayalım.
  select count(*) into n from public.kategori_yonlendirme('telefon');
  if n <> 0 then
    raise exception 'BAŞARISIZ: birlestirilmemis slug yonlendirme dondurdu';
  end if;

  raise notice '✓ birlestirme: urun kaybi yok, eski adresler hedefe yonleniyor';
end $$;

-- ---------------------------------------------------------------------------
-- 6b) YÖNLENDİRME VİTRİNİN ROLÜNDEN DE GÖRÜNÜYOR
-- ---------------------------------------------------------------------------
-- ÖLÇÜLEN ARIZA. Yukarıdaki iddia SÜPER KULLANICI olarak koşuyordu ve süper
-- kullanıcı RLS'i ATLAR. Fonksiyon doğru cevabı veriyordu, testler yeşildi --
-- ama canlıda altı adres 301 yerine 404 döndü.
--
-- Sebep: `categories` politikası `using (is_active)` ve birleştirilen kategori
-- TANIMI GEREĞİ pasif. `SECURITY INVOKER` bir çözücü, tam da yönlendirmesi
-- gereken satırı göremiyordu.
--
-- Bu iddia asıl soruyu soruyor: VİTRİN ne görüyor? Rol değiştirmeden sormak,
-- kullanıcının hiç yaşamadığı bir dünyayı test etmekti.
do $$
declare v_kaynak text; v_super text; v_anon text;
begin
  select c.slug::text into v_kaynak
    from public.categories c where c.merged_into_id is not null limit 1;

  if v_kaynak is null then
    raise notice '- atlandi: birlestirilmis kategori yok';
    return;
  end if;

  select y.hedef_slug into v_super from public.kategori_yonlendirme(v_kaynak) y;

  set local role anon;
  select y.hedef_slug into v_anon from public.kategori_yonlendirme(v_kaynak) y;
  reset role;

  if v_anon is null or v_anon is distinct from v_super then
    raise exception
      'BAŞARISIZ: anon yonlendirmeyi goremiyor (super "%", anon "%"). '
      'Vitrin 301 yerine 404 dondurur ve o adreslerin arama degeri gider.',
      coalesce(v_super, 'NULL'), coalesce(v_anon, 'NULL');
  end if;

  -- HARF DUYARSIZ OLMALI. Olculen tuzak: fonksiyon `set search_path = ''`
  -- ile yazili ve citext eklentisi `public` semasinda kurulu, yani citext'in
  -- `=` operatoru arama yolunda DEGIL. PostgreSQL hata vermek yerine ortuk
  -- cast ile harf DUYARLI `text =` operatorune duser. Sonuc: `citext` sutunu
  -- citext gibi davranmayi birakir ve harf farki tasiyan eski adresler 301
  -- yerine 404 alir. Hata dusmez -- yanlis cevap doner.
  if (select y.hedef_slug from public.kategori_yonlendirme(upper(v_kaynak)) y)
     is distinct from v_anon then
    raise exception
      'BAŞARISIZ: yonlendirme harf duyarli. Bos arama yolunda citext '
      'operatoru bulunamiyor olabilir -- karsilastirmayi acikca lower() ile yap.';
  end if;

  raise notice '✓ yonlendirme anon rolunden gorunuyor ve harf duyarsiz (% -> %)', v_kaynak, v_anon;
end $$;

-- ---------------------------------------------------------------------------
-- 7) MARKA KATEGORİ DEĞİL, İŞLETİM SİSTEMİ DE DEĞİL
-- ---------------------------------------------------------------------------
-- Kanonik taksonominin taşıdığı söz bu. Bir marka adı kategori olursa
-- karşılaştırma biter: aynı ürün tipi markaya göre ayrı sayfalara bölünür.
do $$
declare v_n int; v_ad text;
begin
  for v_ad in
    select c.name from public.categories c
     where c.is_active
       and lower(c.name) ~ '\m(apple|samsung|xiaomi|huawei|sony|lenovo|asus|hp|dell|lg|nike|adidas|android|ios)\M'
  loop
    raise exception
      'BAŞARISIZ: "%" bir marka/isletim sistemi adi tasiyor. Marka kategori '
      'olamaz: ayni urun tipi markaya gore ayri sayfalara bolunur ve fiyat '
      'karsilastirmasi anlamini kaybeder.', v_ad;
  end loop;

  -- Belirsiz tek kelimelik "Aksesuar(lar)" da kalmamalı: kullanıcı da arama
  -- motoru da içinde ne olduğunu bilemez.
  select count(*) into v_n from public.categories
   where is_active and lower(btrim(name)) in ('aksesuar', 'aksesuarlar');
  if v_n > 0 then
    raise exception 'BAŞARISIZ: % adet tek basina "Aksesuarlar" kategorisi var', v_n;
  end if;

  raise notice '✓ marka ve isletim sistemi kategori degil; belirsiz "Aksesuarlar" yok';
end $$;

-- ---------------------------------------------------------------------------
-- 8) HEDEF MİMARİNİN YEDİ ANA DALI KURULU VE ÜÇ SEVİYELİ
-- ---------------------------------------------------------------------------
do $$
declare v_slug text; v_l2 int; v_l3 int;
begin
  for v_slug in
    select unnest(array['bilgisayar-tablet','telefon','elektronik','gaming-konsol',
                        'ev-yasam','kitap-kirtasiye-ofis','oyuncak-muzik-film'])
  loop
    if not exists (
      select 1 from public.categories
       where slug::text = v_slug and parent_id is null and is_active
    ) then
      raise exception 'BAŞARISIZ: hedef ana kategori "%" yok ya da ust seviyede degil', v_slug;
    end if;

    select count(*) into v_l2
      from public.categories c join public.categories p on p.id = c.parent_id
     where p.slug::text = v_slug and c.is_active;
    if v_l2 = 0 then
      raise exception 'BAŞARISIZ: "%" altinda hic alt kategori yok', v_slug;
    end if;
  end loop;

  -- Yedi daldan en az beşi ÜRÜN KATEGORİSİ (L3) taşımalı. Hiçbiri
  -- taşımıyorsa yeniden düzenleme uygulanmamış demektir.
  select count(distinct gp.slug::text) into v_l3
    from public.categories c
    join public.categories p  on p.id = c.parent_id
    join public.categories gp on gp.id = p.parent_id
   where c.tree_level = 3 and c.is_active
     and gp.slug::text in ('bilgisayar-tablet','telefon','elektronik','gaming-konsol',
                           'ev-yasam','kitap-kirtasiye-ofis','oyuncak-muzik-film');
  if v_l3 < 5 then
    raise exception
      'BAŞARISIZ: yedi hedef daldan yalnizca %si urun kategorisi (L3) tasiyor', v_l3;
  end if;

  raise notice '✓ hedef mimarinin yedi ana dali kurulu ve uc seviyeli';
end $$;

-- ---------------------------------------------------------------------------
-- 9) KAYNAK TAKSONOMİSİ KANONİK TAKSONOMİYE KARIŞMIYOR
-- ---------------------------------------------------------------------------
-- `category_source_map` satıcının kendi ağacını taşır; `categories` bizim
-- ağacımızı. İkisi karışırsa bir satıcı feed'i taksonomimizi yeniden yazar.
do $$
declare n bigint;
begin
  -- Her kural ya ETKİN bir kanonik kategoriye bakar ya da KAPSAM DIŞI
  -- gerekçesi taşır. Pasif bir kategoriye bakan kural, ürünü görünmez
  -- bir rafa yazardı.
  select count(*) into n
    from public.category_source_map m
    join public.categories c on c.id = m.category_id
   where not c.is_active;
  if n > 0 then
    raise exception
      'BAŞARISIZ: % esleme kurali PASIF kategoriye bakiyor -- o feed in '
      'urunleri veritabaninda var, vitrinde yok olurdu', n;
  end if;

  -- Üç seviyeli bir kaynak yolu EN SPESİFİK parçadan çözülmeli.
  if (select slug from public.kanonik_kategori(
        'yeni-pazaryeri', 'Bilgisayar & Teknoloji > Bilgisayar Bileşenleri > Ekran Kartı'))
     is distinct from 'ekran-karti' then
    raise exception
      'BAŞARISIZ: uc seviyeli kaynak yolu en spesifik parcadan cozulmuyor';
  end if;

  -- Tanınmayan kaynak yine ortak kurallardan yararlanabilmeli: yoksa her
  -- yeni satıcı için sıfırdan sözlük yazmak gerekirdi.
  if (select slug from public.kanonik_kategori('bugun-eklenen-feed', 'Gaming & Konsol'))
     is distinct from 'gaming-konsol' then
    raise exception 'BAŞARISIZ: yeni bir kaynak ortak kurali kullanamadi';
  end if;

  raise notice '✓ kaynak taksonomisi kanonik taksonomiden ayri ve dogru cozuluyor';
end $$;

-- ---------------------------------------------------------------------------
-- 10) AŞIRI YÜKLENMİŞ (OVERLOADED) UYGULAMA FONKSİYONU YOK
-- ---------------------------------------------------------------------------
-- ÖLÇÜLEN ARIZA. Üretimdeki `search_products` ve `search_facets`, depoda
-- karşılığı olmayan bir göçle fazladan bir `p_currency` parametresi almıştı.
-- Kapsam göçü dar imzayla yazıldığında `create or replace` üretimdeki
-- fonksiyonu DEĞİŞTİRMEZ, yanına İKİNCİ bir sürüm açar; PostgREST o noktada
-- "could not choose the best candidate function" der ve ARAMA TAMAMEN DURUR
-- -- göç "başarılı" görünürken.
--
-- Bu iddia o sınıf hatayı derlemede yakalar. Bugün hiçbir uygulama
-- fonksiyonunun birden fazla imzası yok (ölçüldü); kural bunu SABİTLİYOR.
-- Gerçekten aşırı yükleme gerekirse burası bilinçli olarak gevşetilir --
-- kaza eseri değil.
--
-- Eklenti fonksiyonları (citext, pg_trgm, pgTAP) HARİÇ: onlar tasarımı gereği
-- aşırı yüklü ve bizim kararımız değil.
do $$
declare v_liste text;
begin
  select string_agg(proname || ' (' || adet || ' surum)', ', ' order by proname)
    into v_liste
    from (
      select p.proname, count(*) as adet
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prokind in ('f', 'p')
         and not exists (
           select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
         )
       group by p.proname
      having count(*) > 1
    ) t;

  if v_liste is not null then
    raise exception
      'BAŞARISIZ: asiri yuklenmis uygulama fonksiyonu var: %. PostgREST '
      'bunlari cagiramaz ("could not choose the best candidate function") ve '
      'ilgili uc sessizce calismaz. Yeni bir imza yaziyorsan ESKISINI dusur.',
      v_liste;
  end if;

  raise notice '✓ asiri yuklenmis uygulama fonksiyonu yok';
end $$;

-- ---------------------------------------------------------------------------
-- 11) DEPO ŞEMASI ÜRETİMLE HİZALI KALIYOR
-- ---------------------------------------------------------------------------
-- `20260920104000_uretim_ile_sema_hizalamasi` göçü, üretimde olup depoda
-- olmayan nesneleri depoya taşıdı. Buradaki iddia onların yeniden
-- kaybolmamasını sağlıyor: kaybolurlarsa temiz replay üretimden farklı bir
-- şema üretir ve bir sonraki uyuşmazlık yine ÜRETİMDE ortaya çıkar.
do $$
declare v_eksik text;
begin
  select string_agg(ad, ', ') into v_eksik from (
    select 'programs.feed_access NOT NULL' as ad
     where exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name='programs'
          and column_name='feed_access' and is_nullable='YES')
    union all
    select 'order_items_currency_matches tetikleyicisi'
     where not exists (
       select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where c.relname='order_items' and t.tgname='order_items_currency_matches')
    union all
    select i.ad from (values
        ('product_groups_category_offers_idx'),
        ('product_groups_offers_idx'),
        ('programs_network_feed_unique')
      ) as i(ad)
     where not exists (
       select 1 from pg_indexes where schemaname='public' and indexname = i.ad)
  ) t;

  if v_eksik is not null then
    raise exception 'BAŞARISIZ: uretimle hizalanan nesneler kaybolmus: %', v_eksik;
  end if;

  raise notice '✓ depo semasi uretimle hizali';
end $$;

rollback;
