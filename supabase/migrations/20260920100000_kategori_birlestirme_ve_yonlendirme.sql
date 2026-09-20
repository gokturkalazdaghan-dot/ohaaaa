-- ===========================================================================
-- YİNELENEN KATEGORİLERİN BİRLEŞTİRİLMESİ — ürün kaybı yok, adres kaybı yok
-- ===========================================================================
--
-- ÖLÇÜLEN PROBLEM
-- Taksonomi üç ayrı göçte büyüdü (15 üst → 17 → 18 Seviye-1) ve her biri
-- kendi listesini ekledi. Sonuç: AYNI ÜRÜN TİPİ birden fazla kategoride
-- duruyor. Katalogdan sayılan çakışmalar:
--
--   ios-telefonlar (Cep Telefonu)        = android-telefonlar (Akıllı Telefon)
--   projektor (Projektör)                = projeksiyon-sistemleri
--   elektrikli-mutfak-aletleri           = kucuk-mutfak-aletleri (Küçük Ev Aletleri)
--   hijyenik-pedler (Süpermarket)        = kadin-pedleri (Kozmetik)
--   bebek-bezi-islak-mendil (Süpermarket)= bebek-bakim-saglik (Anne & Bebek)
--   kisisel-bakim-urunleri (Süpermarket) = kisisel-bakim (Kozmetik)
--
-- Yinelenen kategori, fiyat karşılaştırmasının tam kalbini vurur: aynı
-- ürünün teklifleri iki sayfaya bölünür ve iki sayfa da yarım katalog
-- gösterir. `ios-telefonlar`/`android-telefonlar` ayrımı ayrıca bir KURAL
-- ihlali: işletim sistemi bir ürün tipi değil, marka ayrımının başka
-- kılıkta hâli.
--
-- ---------------------------------------------------------------------------
-- SİLMİYORUZ: BİRLEŞTİRİYORUZ
-- ---------------------------------------------------------------------------
-- Kategori satırı DURUYOR, yalnızca pasifleşiyor ve `merged_into_id` ile
-- hedefini gösteriyor. Üç sebep:
--
--   1. ÜRÜN KAYBI OLMAZ. Ürün grupları hedefe TAŞINIR, sonra kaynak boşalır.
--      Silseydik `on delete set null` yüzünden ürünler kategorisiz kalırdı.
--   2. ADRES KAYBI OLMAZ. `/kategori/ios-telefonlar` dışarıya verilmiş bir
--      sözdür; 404 dönmek o sözü bozmak ve o sayfanın bütün SEO değerini
--      çöpe atmaktır. `merged_into_id` vitrinin 301 verebilmesi için var.
--   3. GERİ ALINABİLİR. Yanlış bir birleştirme tek `update` ile açılır;
--      silinmiş bir kategori geri gelmez.
--
-- ---------------------------------------------------------------------------
-- TEKLİFLER TAŞINMAZ ÇÜNKÜ TAŞINMASI GEREKMİYOR
-- ---------------------------------------------------------------------------
-- `products` (teklifler) kategoriye DEĞİL `product_groups`a bağlı. Grubun
-- kategorisi değişince teklifler grubuyla birlikte gelir. Yani bu göç tek
-- bir teklif satırına dokunmadan bütün teklifleri doğru kategoriye taşır.
-- ===========================================================================

-- --- 1) BİRLEŞTİRME İZİ ----------------------------------------------------
alter table public.categories
  add column if not exists merged_into_id uuid references public.categories (id) on delete restrict;

comment on column public.categories.merged_into_id is
  'Bu kategori hangi kanonik kategoriye birlestirildi. NULL = birlestirilmedi. '
  'Dolu oldugunda satir PASIFTIR ve vitrin /kategori/<slug> adresini hedefe '
  '301 ile yonlendirir -- silseydik adres 404 doner, SEO degeri giderdi.';

do $$
begin
  -- Kendi kendine birleşemez: sonsuz döngü, çözücüyü kilitlerdi.
  if not exists (select 1 from pg_constraint where conname = 'categories_merged_into_kendine_degil') then
    alter table public.categories
      add constraint categories_merged_into_kendine_degil
        check (merged_into_id is null or merged_into_id <> id);
  end if;

  -- Birleştirilmiş kategori ETKİN OLAMAZ. Aksi hâlde hem menüde durur hem
  -- yönlendirir: kullanıcı tıkladığı bağlantıdan başka bir sayfaya düşer.
  if not exists (select 1 from pg_constraint where conname = 'categories_merged_into_pasif') then
    alter table public.categories
      add constraint categories_merged_into_pasif
        check (merged_into_id is null or is_active = false);
  end if;
end $$;

create index if not exists categories_merged_into_idx
  on public.categories (merged_into_id)
  where merged_into_id is not null;

-- --- 2) BİRLEŞTİRME -------------------------------------------------------
-- Tek bir `do` bloğu: taşıma, eşleme düzeltmesi ve pasifleştirme AYNI
-- işlemde olmalı. Arada düşseydi ürünler eski kategoride, eşleme yeni
-- kategoride kalırdı -- sessiz ve bulunması zor bir ayrışma.
do $$
declare
  v_cift record;
  v_kaynak uuid;
  v_hedef  uuid;
  v_grup   bigint;
  v_teklif bigint;
  v_kural  bigint;
  v_ikincil bigint;
  v_toplam_grup   bigint := 0;
  v_toplam_teklif bigint := 0;
  v_toplam_kural  bigint := 0;
  v_birlesen      int    := 0;
begin
  for v_cift in
    select *
      from (values
        -- kaynak,                      hedef,                    gerekce
        ('ios-telefonlar',              'android-telefonlar',
         'Isletim sistemi bir urun tipi degil: iOS ve Android telefon AYNI urun tipidir. Ayri tutmak, marka ayrimini kategori diye satmakti.'),
        ('projektor',                   'projeksiyon-sistemleri',
         'Ayni urun tipi iki kategoride: "Projektor" (Ev Elektronigi) ve "Projeksiyon Sistemleri" (Ofis).'),
        ('elektrikli-mutfak-aletleri',  'kucuk-mutfak-aletleri',
         'Ayni urun tipi ayni ust kategoride: elektrikli mutfak aleti = kucuk ev aleti.'),
        ('hijyenik-pedler',             'kadin-pedleri',
         'Ayni urun tipi iki ust kategoride: Supermarket "Hijyenik Pedler" ve Kozmetik "Kadin Pedleri".'),
        ('bebek-bezi-islak-mendil',     'bebek-bakim-saglik',
         'Ayni urun tipi iki ust kategoride: Supermarket "Bebek Bakim Urunleri" ve Anne & Bebek "Bebek Bakimi".'),
        ('kisisel-bakim-urunleri',      'kisisel-bakim',
         'Ayni urun tipi iki ust kategoride: Supermarket "Kisisel Bakim Urunleri" ve Kozmetik dali.')
      ) as v(kaynak, hedef, gerekce)
  loop
    select id into v_kaynak from public.categories where slug = v_cift.kaynak::citext;
    select id into v_hedef  from public.categories where slug = v_cift.hedef::citext;

    -- Kaynak ya da hedef yoksa SESSİZCE GEÇME: eksik olan hangisi olursa
    -- olsun taksonomi beklenenden farklı demektir.
    if v_kaynak is null then
      raise notice 'Birlestirme atlandi: kaynak kategori yok (%).', v_cift.kaynak;
      continue;
    end if;
    if v_hedef is null then
      raise exception
        'Birlestirme hedefi yok (% -> %). Hedefsiz birlestirmek, urunleri '
        'kategorisiz birakmakti.', v_cift.kaynak, v_cift.hedef;
    end if;

    -- 2a) ÜRÜN GRUPLARI ÖNCE TAŞINIR. Sıra önemli: önce pasifleştirseydik
    --     ürünler bir an için pasif bir kategoride kalırdı.
    select count(*) into v_grup from public.product_groups where category_id = v_kaynak;
    select count(*) into v_teklif
      from public.products p
      join public.product_groups g on g.id = p.group_id
     where g.category_id = v_kaynak;

    update public.product_groups set category_id = v_hedef where category_id = v_kaynak;

    -- 2b) EŞLEME KURALLARI HEDEFİ GÖSTERSİN. Kalsaydı, bir sonraki alım
    --     ürünleri yeniden pasif kategoriye yazardı ve birleştirme
    --     sessizce geri alınırdı.
    update public.category_source_map set category_id = v_hedef
     where category_id = v_kaynak;
    get diagnostics v_kural = row_count;

    -- 2c) İKİNCİL YERLEŞİM de hedefe taşınır; aksi hâlde menüde pasif bir
    --     kategoriye giden ikinci bir yol kalırdı.
    update public.category_secondary_parents set category_id = v_hedef
     where category_id = v_kaynak
       and not exists (
         select 1 from public.category_secondary_parents x
          where x.category_id = v_hedef and x.parent_id = category_secondary_parents.parent_id
       );
    get diagnostics v_ikincil = row_count;
    delete from public.category_secondary_parents where category_id = v_kaynak;
    delete from public.category_secondary_parents where parent_id = v_kaynak;

    -- 2d) ÇOCUKLARI ÖKSÜZ BIRAKMA. Kaynağın altında kategori varsa hedefe
    --     geçer; yoksa ağaç yarım kalırdı.
    update public.categories set parent_id = v_hedef where parent_id = v_kaynak;

    -- 2e) Kaynak pasifleşir ve hedefini gösterir. `is_active` ile
    --     `merged_into_id` AYNI update'te: kısıt ikisini birlikte istiyor.
    update public.categories
       set is_active = false, merged_into_id = v_hedef
     where id = v_kaynak;

    v_toplam_grup   := v_toplam_grup + v_grup;
    v_toplam_teklif := v_toplam_teklif + v_teklif;
    v_toplam_kural  := v_toplam_kural + v_kural;
    v_birlesen      := v_birlesen + 1;

    raise notice 'Birlestirildi: % -> % (% urun grubu, % teklif, % esleme kurali, % ikincil yerlesim). %',
      v_cift.kaynak, v_cift.hedef, v_grup, v_teklif, v_kural, v_ikincil, v_cift.gerekce;
  end loop;

  raise notice
    'TOPLAM: % kategori birlestirildi, % urun grubu ve % teklif yeniden '
    'eslendi, % esleme kurali hedefe tasindi.',
    v_birlesen, v_toplam_grup, v_toplam_teklif, v_toplam_kural;
end $$;

-- --- 3) BELİRSİZ ADLARIN TEKİLLEŞTİRİLMESİ --------------------------------
-- Birleştirme sonrası aynı ad iki kategoride kalmamalı. "Aksesuar" tek
-- başına hiçbir şey söylemez: kullanıcı telefon kılıfı mı, kablo mu, kemer
-- mi bulacağını bilmez ve arama motoru da bilmez.
update public.categories c set name = v.ad
  from (values
    ('elektronik-aksesuarlar', 'Elektronik Aksesuarlar'),
    ('moda-aksesuar',          'Moda Aksesuarları'),
    ('kadin-pedleri',          'Kadın Hijyen Ürünleri'),
    ('kisisel-bakim',          'Kişisel Bakım & Vücut Bakımı'),
    ('sarj-cihazlari',         'Telefon Şarj Cihazı'),
    ('sarj-kablolari',         'Şarj Kablosu'),
    ('bataryalar',             'Telefon Bataryası')
  ) as v(slug, ad)
 where c.slug = v.slug::citext and c.name is distinct from v.ad;

-- --- 4) YÖNLENDİRME ÇÖZÜCÜSÜ ----------------------------------------------
/*
 * Birleştirilmiş bir slug'ın KANONİK hedefini verir.
 *
 * Zinciri takip eder (a -> b -> c): bugün zincir yok ama yarın ikinci bir
 * birleştirme olursa, tek adım çözen bir fonksiyon kullanıcıyı yine pasif
 * bir sayfaya gönderirdi. Derinlik sınırlı: bozuk bir veri döngüsü
 * fonksiyonu kilitlemesin.
 *
 * Birleştirilmemiş slug için HİÇBİR ŞEY dönmez -- "yönlendirme yok"
 * demektir. Kendini döndürseydi vitrin her sayfada gereksiz bir 301 kurardı.
 */
create or replace function public.kategori_yonlendirme(p_slug text)
returns table (hedef_slug text, hedef_id uuid)
language sql
stable
set search_path = ''
as $$
  with recursive zincir(id, slug, merged_into_id, derinlik) as (
    select c.id, c.slug::text, c.merged_into_id, 0
      from public.categories c
     where c.slug = p_slug::public.citext
       and c.merged_into_id is not null
    union all
    select c.id, c.slug::text, c.merged_into_id, z.derinlik + 1
      from zincir z
      join public.categories c on c.id = z.merged_into_id
     where z.derinlik < 8
  )
  select z.slug, z.id
    from zincir z
   where z.merged_into_id is null
   order by z.derinlik desc
   limit 1;
$$;

comment on function public.kategori_yonlendirme is
  'Birlestirilmis kategori slug u icin kanonik hedefi verir. Vitrin bunu '
  'okuyup 301 yonlendirir; okumasaydi eski adres 404 doner ve o sayfanin '
  'SEO degeri giderdi. Birlestirilmemis slug icin bos doner.';

grant execute on function public.kategori_yonlendirme(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare v_n bigint; v_r record;
begin
  -- 1) HİÇBİR ÜRÜN GRUBU BİRLEŞTİRİLMİŞ KATEGORİDE KALMADI.
  select count(*) into v_n
    from public.product_groups g
    join public.categories c on c.id = g.category_id
   where c.merged_into_id is not null;
  if v_n > 0 then
    raise exception
      'DOGRULAMA 1: % urun grubu birlestirilmis kategoride kaldi -- vitrinde '
      'gorunmez olurlardi.', v_n;
  end if;

  -- 2) HİÇBİR ÜRÜN KATEGORİSİZ KALMADI ve HİÇBİRİ YETİM DEĞİL.
  select count(*) into v_n
    from public.product_groups g
   where g.category_id is not null
     and not exists (select 1 from public.categories c where c.id = g.category_id);
  if v_n > 0 then
    raise exception 'DOGRULAMA 2: % urun grubunun kategorisi artik yok.', v_n;
  end if;

  -- 3) BİRLEŞTİRİLEN SATIRLAR DURUYOR (silinmediler) ve PASİFLER.
  select count(*) into v_n from public.categories where merged_into_id is not null;
  if v_n = 0 then
    raise exception
      'DOGRULAMA 3: hicbir kategori birlestirilmemis -- bu goc hicbir sey '
      'yapmamis demektir.';
  end if;
  if exists (select 1 from public.categories where merged_into_id is not null and is_active) then
    raise exception 'DOGRULAMA 3b: birlestirilmis bir kategori hala ETKIN.';
  end if;

  -- 4) YÖNLENDİRME GERÇEKTEN ÇALIŞIYOR. Bu kontrol olmasaydı sessizce
  --    404 üreten bir birleştirme yapmış olabilirdik.
  select * into v_r from public.kategori_yonlendirme('ios-telefonlar');
  if v_r.hedef_slug is distinct from 'android-telefonlar' then
    raise exception
      'DOGRULAMA 4: birlestirilmis slug yonlendirilmiyor (%) -- eski adres '
      '404 donerdi.', coalesce(v_r.hedef_slug, 'NULL');
  end if;

  -- 5) BİRLEŞTİRİLMEMİŞ SLUG YÖNLENDİRMEZ. Kendini döndürseydi vitrin
  --    her kategori sayfasında gereksiz bir 301 kurardı.
  select count(*) into v_n from public.kategori_yonlendirme('telefon');
  if v_n <> 0 then
    raise exception 'DOGRULAMA 5: birlestirilmemis slug yonlendirme dondurdu.';
  end if;

  -- 6) ESKİ HEDEFE BAKAN EŞLEME KURALI KALMADI.
  select count(*) into v_n
    from public.category_source_map m
    join public.categories c on c.id = m.category_id
   where c.merged_into_id is not null;
  if v_n > 0 then
    raise exception
      'DOGRULAMA 6: % esleme kurali hala birlestirilmis kategoriyi '
      'gosteriyor -- bir sonraki alim birlestirmeyi geri alirdi.', v_n;
  end if;

  -- 7) MENÜDE PASİF KATEGORİYE GİDEN İKİNCİL YOL KALMADI.
  select count(*) into v_n
    from public.category_secondary_parents s
    join public.categories c on c.id = s.category_id
   where c.merged_into_id is not null or not c.is_active;
  if v_n > 0 then
    raise exception 'DOGRULAMA 7: % ikincil yerlesim pasif kategoriye gidiyor.', v_n;
  end if;

  -- 8) ÖKSÜZ ÇOCUK YOK: birleştirilen kategorinin altında kategori kalmadı.
  select count(*) into v_n
    from public.categories c
    join public.categories p on p.id = c.parent_id
   where p.merged_into_id is not null;
  if v_n > 0 then
    raise exception 'DOGRULAMA 8: % kategori birlestirilmis bir ustun altinda kaldi.', v_n;
  end if;

  raise notice 'Birlestirme tamam: urun kaybi yok, adres kaybi yok, eslemeler hedefe tasindi.';
end $$;
