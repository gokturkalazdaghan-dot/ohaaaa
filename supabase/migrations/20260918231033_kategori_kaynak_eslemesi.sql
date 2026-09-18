-- ===========================================================================
-- KAYNAK KATEGORİSİ -> KANONİK KATEGORİ EŞLEMESİ
-- ===========================================================================
--
-- ÇÖZÜLEN PROBLEM
-- Eşleme bugün `packages/ingest/src/categorize.ts` içinde SABİT YAZILI bir
-- Map. İki sonucu var:
--   1. Yeni bir satıcı bağlandığında eşleme eklemek DAĞITIM gerektiriyor.
--   2. O dosyada ÖLÇÜLEN bir hata var: 'fashion' ve 'clothing' değerleri
--      `moda` slug'ına eşleniyor ama katalogda `moda` diye bir kategori
--      YOK (sorgulandı). Yani giyim satan bir feed'in TAMAMI
--      sınıflandırılamaz olarak düşerdi.
--
-- Bu tablo eşlemeyi veriye taşıyarak o sınıf hatayı İMKÂNSIZ kılıyor:
-- hedef bir YABANCI ANAHTAR, var olmayan bir kategoriye eşlenemez.
--
-- ---------------------------------------------------------------------------
-- "KAPSAM DIŞI" İLE "HENÜZ EŞLENMEDİ" AYRI ŞEYLER
-- ---------------------------------------------------------------------------
--   category_id dolu               -> bu kanonik kategoriye gider
--   category_id NULL + sebep dolu  -> KAPSAM DIŞI, bilerek (gıda, alkol,
--                                     tütün, yetişkin)
--   satır hiç yok                  -> henüz eşlenmedi; başlık kurallarına
--                                     düşer, o da bilmezse NULL
-- ===========================================================================

create or replace function public.kategori_anahtar(p_deger text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        lower(translate(btrim(coalesce(p_deger, '')),
                        'İıĞğÜüŞşÖöÇç', 'iiGgUuSsOoCc')),
        '[^a-z0-9]+', '-', 'g'
      ),
      '^-+|-+$', '', 'g'
    ),
  '');
$$;

comment on function public.kategori_anahtar is
  'Kaynak kategori metnini karsilastirma anahtarina indirger. TypeScript '
  'tarafindaki categorySlugKey ile AYNI kurallari uygular; ayrisirlarsa '
  'ayni feed degeri bir katmanda eslesir digerinde eslesmez ve fark sessiz '
  'kalir. Turkce noktali I kucuk harfe cevrilmeden ONCE ele alinir.';

create table if not exists public.category_source_map (
  id          uuid primary key default gen_random_uuid(),

  /*
   * Kaynak: ağ kodu ('awin'), pazaryeri ('trendyol', 'aliexpress') ya da
   * HER kaynak için geçerli kural: '*'.
   *
   * `affiliate_networks`e yabancı anahtar DEĞİL: Trendyol ve AliExpress
   * birer ortaklık ağı değil, birer pazaryeri. Ağ tablosuna bağlamak, ağ
   * olmayan kaynakları hiç eşleyememek demekti.
   */
  source      text not null,
  source_key  text not null,

  /** NULL = KAPSAM DIŞI. Sebebi zorunlu. */
  category_id uuid references public.categories (id) on delete restrict,
  excluded_reason text,
  note        text not null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint category_source_map_unique unique (source, source_key),
  constraint category_source_map_source_not_blank check (length(btrim(source)) > 0),
  constraint category_source_map_key_not_blank check (length(btrim(source_key)) > 0),
  constraint category_source_map_note_not_blank check (length(btrim(note)) > 0),
  constraint category_source_map_null_needs_reason
    check (category_id is not null or length(btrim(coalesce(excluded_reason, ''))) > 0),
  constraint category_source_map_target_xor
    check (category_id is null or excluded_reason is null)
);

comment on table public.category_source_map is
  'Satici/feed kategorisi -> Ohaaaa kanonik kategorisi. Esleme KODDA degil '
  'VERIDE: yeni satici baglandiginda dagitim gerekmez. Hedef yabanci '
  'anahtar oldugu icin var olmayan bir kategoriye eslemek IMKANSIZ.';

comment on column public.category_source_map.category_id is
  'NULL = KAPSAM DISI (sebep zorunlu). Satirin hic olmamasi "henuz '
  'eslenmedi" demektir; ikisi farkli sey ve karistirilirsa kapsam disi '
  'birakilan urunler sessizce kapsama girer.';

create index if not exists category_source_map_key_idx
  on public.category_source_map (source_key);

drop trigger if exists category_source_map_set_updated_at on public.category_source_map;
create trigger category_source_map_set_updated_at
  before update on public.category_source_map
  for each row execute function public.tg_set_updated_at();

alter table public.category_source_map enable row level security;
revoke all on public.category_source_map from anon, authenticated;
grant select, insert, update, delete on public.category_source_map to service_role;

/**
 * Kaynak kategorisini kanonik kategoriye çözer.
 *
 * SIRA, ÖZELDEN GENELE:
 *   1. kaynağa özgü kural, tam anahtar
 *   2. '*' kuralı, tam anahtar
 *   3. yol parçaları, EN SPESİFİK parçadan başlayarak
 *      ("Retail > Clothing > Menswear" -> menswear, clothing, retail)
 *
 * BULANIK EŞLEŞME YOK. Yanlış kategori, kategorisiz olmaktan zararlıdır.
 */
create or replace function public.kanonik_kategori(
  p_source text,
  p_source_key text
)
returns table (category_id uuid, slug text, kapsam_disi boolean, sebep text)
language sql
stable
security definer
set search_path = ''
as $$
  with parcalar as (
    -- Tam anahtar en yuksek oncelik (0).
    select public.kategori_anahtar(p_source_key) as anahtar, 0 as oncelik
    union all
    -- Yol parcalari: SON parca en spesifik, o yuzden en dusuk oncelik sayisi.
    select public.kategori_anahtar(t.deger), (1000 - t.sira)::int
      from unnest(regexp_split_to_array(coalesce(p_source_key, ''), '[>/|,]'))
             with ordinality as t(deger, sira)
  ),
  adaylar as (
    select m.category_id, m.excluded_reason,
           case when m.source = public.kategori_anahtar(p_source) then 0 else 1 end as kaynak_oncelik,
           pa.oncelik
      from public.category_source_map m
      join parcalar pa on pa.anahtar = m.source_key
     where pa.anahtar is not null
       and (m.source = public.kategori_anahtar(p_source) or m.source = '*')
  )
  select a.category_id,
         (select c.slug::text from public.categories c where c.id = a.category_id),
         a.category_id is null,
         a.excluded_reason
    from adaylar a
   order by a.kaynak_oncelik, a.oncelik
   limit 1;
$$;

comment on function public.kanonik_kategori is
  'Kaynak kategorisini kanonik kategoriye cozer. Once kaynaga ozgu tam '
  'anahtar, sonra ortak kural, sonra yol parcalari EN SPESIFIKTEN. Bulanik '
  'eslesme YOK.';

revoke all on function public.kanonik_kategori(text, text) from public;
revoke all on function public.kanonik_kategori(text, text) from anon, authenticated;
grant execute on function public.kanonik_kategori(text, text) to service_role;
grant execute on function public.kategori_anahtar(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SÖZLÜK — YALNIZCA GERÇEKTEN GÖRÜLEN DEĞERLER
-- ---------------------------------------------------------------------------
-- Görülmeyen bir değer için kural yazmak, doğrulanmamış bir varsayımı
-- veriye gömmek olurdu. Belirsiz sektörler (Department Stores, Group
-- Buying, Lead Gen, Green (Eco friendly), Business Services, Education,
-- Utilities) BİLEREK eşlenmedi: onlar bir ürün kategorisi değil, bir iş
-- modeli tarifi. Eşlenmeyen değer başlık kurallarına düşer.
insert into public.category_source_map (source, source_key, category_id, excluded_reason, note)
select v.kaynak, v.anahtar,
       (select c.id from public.categories c where c.slug = v.hedef::citext),
       v.sebep, v.not_
  from (values
    -- ---- Awin reklamveren dizininde ÖLÇÜLEN sektörler ----
    ('awin','computers',                  'bilgisayar-tablet',    null, 'Awin: BTO dahil bilgisayar saticilari.'),
    ('awin','electronic-accessories',     'elektronik-aksesuarlar', null, 'Awin: kablo, adaptor, montaj.'),
    ('awin','electronic-superstore',      'elektronik',           null, 'Awin: genel elektronik.'),
    ('awin','audio-visual',               'ses-goruntu-sistemleri', null, 'Awin: ses ve goruntu.'),
    ('awin','office-supplies',            'ofis-teknolojileri',   null, 'Awin: ofis malzemesi.'),
    ('awin','pc-video-games',             'oyun-konsollari',      null, 'Awin: konsol ve oyun.'),
    ('awin','online-gaming',              'video-oyunlari',       null, 'Awin: oyun anahtari/abonelik (Aussui).'),
    ('awin','toys-games',                 'oyuncak',              null, 'Awin: oyuncak.'),
    ('awin','furniture-soft-furnishings', 'mobilya',              null, 'Awin: mobilya (King Koil).'),
    ('awin','home-garden',                'ev-yasam',             null, 'Awin: ev ve bahce.'),
    ('awin','diy',                        'yapi-market',          null, 'Awin: yapi malzemeleri.'),
    ('awin','clothing',                   'giyim-ayakkabi',       null, 'Awin: giyim (Moosehill, Kings Camo).'),
    ('awin','menswear',                   'erkek',                null, 'Awin: erkek giyim.'),
    ('awin','womenswear',                 'kadin',                null, 'Awin: kadin giyim.'),
    ('awin','childrenswear',              'cocuk',                null, 'Awin: cocuk giyim.'),
    ('awin','lingerie',                   'ic-giyim',             null, 'Awin: ic giyim (PURTY BODY).'),
    ('awin','sportswear',                 'spor-giyim-aksesuar',  null, 'Awin: spor giyim (wanayou, FansJerseyHub).'),
    ('awin','clothing-accessories',       'moda-aksesuar',        null, 'Awin: giyim aksesuari.'),
    ('awin','shoes',                      'ayakkabi',             null, 'Awin: ayakkabi.'),
    ('awin','health-beauty',              'kozmetik',             null, 'Awin: kozmetik ve kisisel bakim.'),
    ('awin','pharmaceuticals',            'medikal-urunler',      null, 'Awin: medikal (Brookwood Med). Medikal kisitli kategori.'),
    ('awin','jewellery',                  'taki-mucevher',        null, 'Awin: taki (goettgen.de).'),
    ('awin','automotive',                 'oto-aksesuar',         null, 'Awin: oto (Ottocast).'),
    ('awin','sports-equipment',           'spor-branslari',       null, 'Awin: spor ekipmani.'),
    ('awin','pets-pet-care',              'petshop',              null, 'Awin: evcil hayvan (Nextrition Pet).'),
    ('awin','books-subscriptions',        'kitap',                null, 'Awin: kitap.'),
    ('awin','music-dvd',                  'muzik',                null, 'Awin: muzik ve film.'),
    ('awin','software-downloads',         'yazilim-urunleri',     null, 'Awin: yazilim (Wondershare, EasyClaw).'),
    ('awin','mobile-pay-as-you-go',       'telefon',              null, 'Awin: telefon (Grade Mobile).'),
    ('awin','mobile-contract',            'telefon',              null, 'Awin: telefon.'),
    ('awin','white-goods',                'beyaz-esya-ankastre',  null, 'Awin: beyaz esya.'),
    ('awin','baby-toddler',               'anne-bebek',           null, 'Awin: bebek.'),
    ('awin','photography',                'fotograf-makineleri',  null, 'Awin: fotograf ekipmani (BlazeVideo).'),
    ('awin','gadgets',                    'elektronik',           null, 'Awin: kucuk elektronik (AliExpress PL).'),
    ('awin','erotic',                     'yetiskin-urunleri',    null, 'Awin: yetiskin. +18 kisitli kategori.'),
    -- ---- KAPSAM DISI: hedef YOK, sebep VAR ----
    ('awin','fmcg',                       null, 'gida',        'Hizli tuketim: agirlikli gida. Ohaaaa gida satmiyor.'),
    ('awin','wine-spirits-tobacco',       null, 'alkol-tutun', 'Alkol ve tutun kapsam disi.'),
    -- ---- HER KAYNAK ICIN GECERLI: gida/alkol/tutun kapsam disi ----
    ('*','grocery',                       null, 'gida',        'Market/gida kapsam disi.'),
    ('*','food',                          null, 'gida',        'Gida kapsam disi.'),
    ('*','food-drink',                    null, 'gida',        'Gida ve icecek kapsam disi.'),
    ('*','beverages',                     null, 'gida',        'Icecek kapsam disi.'),
    ('*','drinks',                        null, 'gida',        'Icecek kapsam disi.'),
    ('*','gida',                          null, 'gida',        'Gida kapsam disi.'),
    ('*','icecek',                        null, 'gida',        'Icecek kapsam disi.'),
    ('*','alcohol',                       null, 'alkol-tutun', 'Alkol kapsam disi.'),
    ('*','alkol',                         null, 'alkol-tutun', 'Alkol kapsam disi.'),
    ('*','tobacco',                       null, 'alkol-tutun', 'Tutun kapsam disi.'),
    ('*','tutun',                         null, 'alkol-tutun', 'Tutun kapsam disi.'),
    ('*','vape',                          null, 'alkol-tutun', 'Nikotin urunleri kapsam disi.'),
    ('*','e-cigarette',                   null, 'alkol-tutun', 'Nikotin urunleri kapsam disi.'),
    -- ---- HER KAYNAK ICIN GECERLI: yaygin ortak adlar ----
    ('*','electronics',                   'elektronik',           null, 'Ortak: genel elektronik.'),
    ('*','computers',                     'bilgisayar-tablet',    null, 'Ortak: bilgisayar.'),
    ('*','computing',                     'bilgisayar-tablet',    null, 'Ortak: bilgisayar.'),
    ('*','laptops',                       'laptop',               null, 'Ortak: dizustu.'),
    ('*','tablets',                       'tablet',               null, 'Ortak: tablet.'),
    ('*','phones',                        'telefon',              null, 'Ortak: telefon.'),
    ('*','mobile-phones',                 'telefon',              null, 'Ortak: telefon.'),
    ('*','headphones',                    'kulaklik',             null, 'Ortak: kulaklik.'),
    ('*','fashion',                       'giyim-ayakkabi',       null, 'Ortak: moda. categorize.ts bunu var olmayan moda slug una esliyordu.'),
    ('*','clothing',                      'giyim-ayakkabi',       null, 'Ortak: giyim.'),
    ('*','beauty',                        'kozmetik',             null, 'Ortak: kozmetik.'),
    ('*','sports',                        'spor-outdoor',         null, 'Ortak: spor.'),
    ('*','outdoor',                       'outdoor',              null, 'Ortak: outdoor.'),
    ('*','home',                          'ev-yasam',             null, 'Ortak: ev.'),
    ('*','garden',                        'bahce',                null, 'Ortak: bahce.'),
    ('*','automotive',                    'oto-yedek-parca',      null, 'Ortak: oto.'),
    ('*','jewelry',                       'taki-mucevher',        null, 'Ortak: taki.'),
    ('*','toys',                          'oyuncak',              null, 'Ortak: oyuncak.'),
    ('*','books',                         'kitap',                null, 'Ortak: kitap.'),
    ('*','adult',                         'yetiskin-urunleri',    null, 'Ortak: yetiskin. +18 kisitli.'),
    ('*','sex-toys',                      'yetiskin-urunleri',    null, 'Ortak: yetiskin. +18 kisitli.')
  ) as v(kaynak, anahtar, hedef, sebep, not_)
 where v.hedef is null
    or exists (select 1 from public.categories c where c.slug = v.hedef::citext)
on conflict (source, source_key) do update
  set category_id     = excluded.category_id,
      excluded_reason = excluded.excluded_reason,
      note            = excluded.note;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare v_r record; v_n integer;
begin
  -- 1) Anahtar normallestirme TURKCE I tuzagina dusmuyor.
  if public.kategori_anahtar('ELEKTRONİK') <> 'elektronik' then
    raise exception 'DOGRULAMA 1: noktali I yanlis normallestirildi (%).',
      public.kategori_anahtar('ELEKTRONİK');
  end if;
  if public.kategori_anahtar('Ev & Yaşam') <> 'ev-yasam' then
    raise exception 'DOGRULAMA 1b: aksanli metin yanlis normallestirildi (%).',
      public.kategori_anahtar('Ev & Yaşam');
  end if;

  -- 2) Kaynaga ozgu tam eslesme.
  select * into v_r from public.kanonik_kategori('awin', 'Computers');
  if v_r.slug is distinct from 'bilgisayar-tablet' then
    raise exception 'DOGRULAMA 2: awin/Computers cozulmedi (%).', coalesce(v_r.slug, 'NULL');
  end if;

  -- 3) YOLDA EN SPESIFIK PARCA KAZANIYOR.
  select * into v_r from public.kanonik_kategori('awin', 'Retail & Shopping > Clothing > Menswear');
  if v_r.slug is distinct from 'erkek' then
    raise exception
      'DOGRULAMA 3: yolda en spesifik parca secilmedi (%) -- erkek giyim, '
      'genel giyime dusmus olurdu.', coalesce(v_r.slug, 'NULL');
  end if;

  -- 4) GIDA KAPSAM DISI ve bu bir KARAR.
  select * into v_r from public.kanonik_kategori('awin', 'FMCG');
  if not v_r.kapsam_disi or v_r.sebep is distinct from 'gida' then
    raise exception 'DOGRULAMA 4: gida kapsam disi olarak isaretlenmemis.';
  end if;
  select * into v_r from public.kanonik_kategori('trendyol', 'Gıda');
  if not v_r.kapsam_disi then
    raise exception 'DOGRULAMA 4b: Turkce gida degeri kapsam disi sayilmadi.';
  end if;
  select * into v_r from public.kanonik_kategori('aliexpress', 'Tobacco');
  if not v_r.kapsam_disi or v_r.sebep is distinct from 'alkol-tutun' then
    raise exception 'DOGRULAMA 4c: tutun kapsam disi sayilmadi.';
  end if;

  -- 5) ESLENMEMIS deger HICBIR SEY dondurmuyor.
  select count(*) into v_n from public.kanonik_kategori('awin', 'Department Stores');
  if v_n <> 0 then
    raise exception
      'DOGRULAMA 5: eslenmemis deger sonuc dondurdu -- "henuz eslenmedi" ile '
      '"bilerek almiyoruz" ayirt edilemezdi.';
  end if;

  -- 6) BILINMEYEN kaynak ortak kurallardan yararlaniyor.
  select * into v_r from public.kanonik_kategori('yeni-pazaryeri', 'Fashion');
  if v_r.slug is distinct from 'giyim-ayakkabi' then
    raise exception
      'DOGRULAMA 6: yeni bir kaynak ortak kurali kullanamadi -- her satici '
      'icin sifirdan sozluk gerekirdi.';
  end if;

  -- 7) Sebepsiz bos hedef YAZILAMIYOR.
  begin
    insert into public.category_source_map (source, source_key, note)
         values ('awin', 'goc-dogrulama', 'sebepsiz bos hedef');
    raise exception 'DOGRULAMA 7: sebepsiz kapsam disi satiri kabul edildi.';
  exception when check_violation then null;
  end;

  -- 8) Var olmayan kategoriye esleme IMKANSIZ -- categorize.ts teki `moda`
  --    hatasinin bir daha olamamasinin sebebi bu.
  begin
    insert into public.category_source_map (source, source_key, category_id, note)
         values ('awin', 'goc-dogrulama-2', gen_random_uuid(), 'var olmayan kategori');
    raise exception 'DOGRULAMA 8: var olmayan kategoriye esleme kabul edildi.';
  exception when foreign_key_violation then null;
  end;

  -- 9) Tablo istemciye KAPALI.
  if has_table_privilege('anon', 'public.category_source_map', 'select') then
    raise exception 'DOGRULAMA 9: esleme tablosu istemciye acik.';
  end if;

  select count(*) into v_n from public.category_source_map;
  raise notice
    'Kaynak esleme katmani kuruldu: % satir. Hedef yabanci anahtar, kapsam '
    'disi karar olarak yazili, yol parcalari en spesifikten cozuluyor.', v_n;
end $$;