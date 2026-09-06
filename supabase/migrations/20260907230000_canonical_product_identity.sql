-- ===========================================================================
-- KANONİK ÜRÜN KİMLİĞİ — yüz milyonlarca teklifin tekilleştirilmesi
-- ===========================================================================
--
-- MEVCUT YAPI ZATEN DOĞRU AYRIMI TAŞIYOR, EKSİK OLAN ANAHTAR
--
--   product_groups  KANONİK ürün (bir model, bir kitap, bir telefon)
--   products        TEKLİF (bir mağazanın o üründeki SKU'su ve fiyatı)
--
-- Yani "merchant SKU/offer ile canonical product ayrımı" yeniden
-- kurulmuyor -- zaten var. Eksik olan, iki ayrı feed'in AYNI ürünü
-- gönderdiğinde onların AYNI `product_groups` satırına düşmesini sağlayan
-- DETERMİNİSTİK anahtar. O anahtar olmadan `group_id` elle doldurulan bir
-- alan olarak kalır ve pratikte hiç dolmaz: katalog, aynı telefonun 400
-- ayrı "ürün" olarak göründüğü bir listeye döner.
--
-- ---------------------------------------------------------------------------
-- ANAHTAR VERİTABANINDA, KODDA DEĞİL
-- ---------------------------------------------------------------------------
-- Kod tarafında "önce SELECT, eşleşen grup var mı, yoksa INSERT" yapılabilirdi
-- ama o kalıp yüz milyonluk hacimde tam olarak kaçındığımız yarışı üretir:
-- iki alım işçisi aynı anda "yok" görür, ikisi de yazar, kanonik ürün ikiye
-- bölünür. `canonical_key` ÜRETİLMİŞ (generated) ve TEKİL: yarışı kaybeden
-- taraf 23505 alır ve `on conflict` ile birleştirmeye döner.
--
-- Üretilmiş olması ayrıca anahtarın satırla TUTARLI kalmasını garanti eder:
-- başlık düzeltilince anahtar kendiliğinden tazelenir. Uygulama tarafından
-- yazılan bir sütun olsaydı, güncellemeyi unutan tek bir kod yolu iki
-- kanonik ürün üretirdi.
--
-- ---------------------------------------------------------------------------
-- GTIN NEDEN NORMALİZE EDİLİYOR
-- ---------------------------------------------------------------------------
-- Aynı ürün bir feed'de UPC-12 ("012345678905"), diğerinde EAN-13
-- ("0012345678905"), üçüncüsünde tireli ("0-12345-67890-5") gelir. Üçü de
-- AYNI ürünü gösterir. Ham metin karşılaştırması bunları üç ayrı ürün
-- sayar -- ve bu, tekilleştirmenin en sık sessizce kaçırdığı durumdur.
-- GTIN-14'e sola sıfır doldurarak hepsi tek gösterime iniyor.
-- ===========================================================================

/**
 * GTIN'i tek gösterime indirir: yalnız rakamlar, GTIN-14'e sola dolgulu.
 *
 * Geçersiz uzunluk NULL döner -- "0" ya da boş metin DÖNMEZ. İkisi de bir
 * DEĞER gibi davranır ve iki geçersiz GTIN'i birbirine eşitleyerek alakasız
 * iki ürünü birleştirirdi. NULL sızmaz.
 */
create or replace function public.normalize_gtin(p_gtin text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_gtin is null then null
    else (
      select case
        -- GTIN-8, UPC-12, EAN-13 ve GTIN-14 gecerli uzunluklardir.
        when length(d) in (8, 12, 13, 14) then lpad(d, 14, '0')
        else null
      end
      from (select regexp_replace(p_gtin, '[^0-9]', '', 'g') as d) t
    )
  end;
$$;

comment on function public.normalize_gtin is
  'GTIN-14 tek gosterimi. UPC-12 ve EAN-13 ayni urunu gosterir; ham metin '
  'karsilastirmasi onlari iki ayri urun sayardi. Gecersiz uzunluk NULL.';

/**
 * Boşlukları tek gösterime indirir: baştaki/sondaki atılır, aradaki
 * tekrarlar tek boşluğa iner.
 *
 * ŞART, çünkü feed'ler aynı başlığı farklı boşluklarla gönderir:
 * "Urun  cok   bosluklu" ile "Urun cok bosluklu" AYNI üründür. Boşluk
 * farkı anahtara girseydi, aynı ürün her feed'de yeni bir kanonik satır
 * açardı -- tekilleştirmenin sessizce kaçırdığı ikinci en yaygın durum.
 */
create or replace function public.collapse_space(p_input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(coalesce(p_input, ''), '\s+', ' ', 'g'));
$$;

comment on function public.collapse_space is
  'Bosluk tek gosterimi. Feed ler ayni basligi farkli bosluklarla gonderir; '
  'fark anahtara girseydi ayni urun her feed de yeni satir acardi.';

/**
 * Kanonik eşleştirme anahtarı — GÜVENİLİRLİK SIRASIYLA.
 *
 *   1. GTIN    Üretici tarafından atanmış küresel kimlik. En güvenilir.
 *   2. marka + MPN  Üreticinin parça numarası. GTIN yoksa en iyi ikinci.
 *   3. marka + başlık  Son çare. Zayıftır ama HİÇ eşleştirmemekten iyidir:
 *      alternatifi, aynı ürünün her feed'de yeni bir satır açmasıdır.
 *
 * Önek ('gtin:', 'mpn:', 'title:') ŞART: öneksiz, bir ürünün GTIN'i başka
 * bir ürünün MPN'siyle çakışabilir ve iki alakasız ürün birleşirdi.
 */
create or replace function public.canonical_product_key(
  p_gtin  text,
  p_brand text,
  p_mpn   text,
  p_title text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when public.normalize_gtin(p_gtin) is not null
      then 'gtin:' || public.normalize_gtin(p_gtin)

    when nullif(btrim(coalesce(p_brand, '')), '') is not null
     and nullif(btrim(coalesce(p_mpn, '')), '') is not null
      then 'mpn:' || public.collapse_space(public.normalize_search(p_brand))
                  || ':' || public.collapse_space(public.normalize_search(p_mpn))

    else 'title:' || public.collapse_space(public.normalize_search(
           coalesce(p_brand, '') || ' ' || coalesce(p_title, '')))
  end;
$$;

comment on function public.canonical_product_key is
  'Kanonik esleme anahtari: gtin > marka+mpn > marka+baslik. Onek zorunlu -- '
  'onceksiz bir urunun GTIN i baska bir urunun MPN siyle cakisabilirdi.';

-- --- product_groups: MPN ve üretilmiş anahtarlar ---------------------------
alter table public.product_groups
  add column mpn text;

comment on column public.product_groups.mpn is
  'Ureticinin parca numarasi. GTIN yoksa en guvenilir ikinci esleyici.';

alter table public.product_groups
  add column gtin_normalized text
    generated always as (public.normalize_gtin(gtin)) stored,
  add column canonical_key text
    generated always as (public.canonical_product_key(gtin, brand, mpn, title)) stored;

/*
 * TEKİLLİK BURADA KURULUYOR.
 *
 * Bu indeks olmadan `on conflict (canonical_key)` yazılamaz ve alım hattı
 * SELECT-then-INSERT'e mecbur kalır -- yani yarışa. Yüz milyonluk hacimde
 * o yarış nadir değil, sürekli.
 */
create unique index product_groups_canonical_key_idx
  on public.product_groups (canonical_key);

-- Normalize GTIN üzerinden arama: ham `gtin` tekilliği zaten vardı ama
-- "0012345678905" ile "012345678905" onun için iki ayrı değerdi.
create unique index product_groups_gtin_normalized_idx
  on public.product_groups (gtin_normalized)
  where gtin_normalized is not null;

-- ---------------------------------------------------------------------------
-- TEKLİF TARAFI: her teklif bir kanonik ürüne bağlanabilmeli
-- ---------------------------------------------------------------------------
-- `products.group_id` zaten var ve nullable kalıyor: bağlanamamış bir teklif
-- KAYBEDİLMEZ, yalnızca karşılaştırmaya girmez. NOT NULL yapmak, eşleşmeyen
-- tek bir feed satırının tüm partiyi düşürmesi demekti.
create index if not exists products_group_price_idx
  on public.products (group_id, price_cents)
  where group_id is not null and status = 'active';

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid; v_b uuid;
begin
  -- 1) GTIN normalizasyonu: uc farkli gosterim TEK degere iniyor.
  if public.normalize_gtin('012345678905') is distinct from public.normalize_gtin('0012345678905')
     or public.normalize_gtin('0-12345-67890-5') is distinct from public.normalize_gtin('012345678905') then
    raise exception 'DOGRULAMA 1: ayni GTIN farkli gosterimlerde farkli normalize edildi.';
  end if;

  -- 2) Gecersiz uzunluk NULL -- '0' ya da bos metin DEGIL.
  if public.normalize_gtin('123') is not null or public.normalize_gtin('abc') is not null then
    raise exception 'DOGRULAMA 2: gecersiz GTIN bir DEGER dondu; alakasiz urunler birleserdi.';
  end if;

  -- 3) Onek ayrimi: GTIN ile MPN anahtarlari cakisamaz.
  if public.canonical_product_key('012345678905', null, null, 'X')
     = public.canonical_product_key(null, 'Marka', '012345678905', 'X') then
    raise exception 'DOGRULAMA 3: GTIN ve MPN anahtarlari cakisti.';
  end if;

  -- 4) AYNI URUN IKI FEED'DEN: ikinci ekleme TEKILLIK ihlali vermeli.
  insert into public.product_groups (slug, title, brand, gtin)
       values ('goc-kanonik-a', 'Test Telefon 128GB', 'TestMarka', '012345678905')
    returning id into v_a;

  begin
    -- Ayni urun, EAN-13 gosteriminde ve baska slug ile.
    insert into public.product_groups (slug, title, brand, gtin)
         values ('goc-kanonik-b', 'Test Telefon 128GB', 'TestMarka', '0012345678905');
    raise exception
      'DOGRULAMA 4: ayni urun iki kanonik satir acti -- katalog ayni urunu '
      'defalarca gosterirdi.';
  exception when unique_violation then null;
  end;

  -- 5) FARKLI urunler ayri kaliyor: kapatma fazla kapatmamis.
  insert into public.product_groups (slug, title, brand, gtin)
       values ('goc-kanonik-c', 'Test Telefon 256GB', 'TestMarka', '0777000333000')
    returning id into v_b;

  if (select canonical_key from public.product_groups where id = v_a)
     = (select canonical_key from public.product_groups where id = v_b) then
    raise exception 'DOGRULAMA 5: farkli urunler ayni anahtari aldi.';
  end if;

  -- 6a) BOSLUK FARKI ayni urunu bolmuyor.
  if public.canonical_product_key(null, null, null, 'Urun  cok   bosluklu')
     is distinct from public.canonical_product_key(null, null, null, ' Urun cok bosluklu ') then
    raise exception 'DOGRULAMA 6a: bosluk farki iki ayri urun uretti.';
  end if;

  -- 6) GTIN'siz urunler marka+baslik ile eslesiyor.
  if public.canonical_product_key(null, 'Marka', null, 'Baslik')
     is distinct from public.canonical_product_key(null, 'MARKA', null, 'baslik') then
    raise exception 'DOGRULAMA 6: buyuk/kucuk harf farki iki ayri urun uretti.';
  end if;

  delete from public.product_groups where id in (v_a, v_b);

  raise notice
    'Kanonik urun kimligi kuruldu: gtin > marka+mpn > marka+baslik, anahtar '
    'URETILMIS ve TEKIL -- ayni urun iki feed den gelse tek satira duser.';
end $$;
