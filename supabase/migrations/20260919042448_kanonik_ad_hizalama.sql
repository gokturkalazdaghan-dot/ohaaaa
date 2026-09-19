-- ============================================================================
-- KANONIK SPEC'E AD HIZALAMASI
-- ============================================================================
-- Taksonomi denetimi, uretimdeki agac ile kanonik spec arasinda ad
-- uyusmazliklari buldu. Hepsi AD duzeyinde: slug'a, kimlige ve urun
-- baglantilarina DOKUNULMUYOR.
--
-- Slug neden degismiyor: `/kategori/<slug>` adresleri disariya verilmis
-- sozler. Ad bir GORUNTU, slug bir ADRES; ikisini birbirine baglamak,
-- her metin duzeltmesini bir SEO kesintisine cevirirdi. Bu yuzden
-- `bebek-giyim` slug'i "Bebek" adiyla da "Bebek Giyim" adiyla da ayni
-- sayfadir.
--
-- ----------------------------------------------------------------------------
-- BIRLESIK KATEGORILERIN AYRILMASI
-- ----------------------------------------------------------------------------
-- Spec "Emzirme Urunleri" ve "Anne Urunleri"ni AYRI iki Seviye-2 olarak
-- sayiyor; uretimde tek bir "Emzirme & Anne Urunleri" vardi. Mevcut satir
-- "Emzirme Urunleri"ne donuyor ve "Anne Urunleri" YENI satir olarak
-- ekleniyor.
--
-- Bu bir tahmin degil: ikisi de spec'te adiyla yaziyor. Ve guvenli:
-- olculdu, o kategoride SIFIR urun grubu var, yani hicbir urun tasinmiyor.
-- Urun olsaydi bolmek, hangi urunun hangi tarafa gidecegine tahminle karar
-- vermek olurdu ve bu yapilmazdi.
--
-- ----------------------------------------------------------------------------
-- KASITLI OLARAK YAPILMAYAN
-- ----------------------------------------------------------------------------
-- Spec "Balikcilik" diyor, uretimde "Balikcilik & Avcilik" var. Ad
-- DARALTILMADI: `av-malzemeleri` slug'i avcilik urunlerini de tasiyor ve
-- adi "Balikcilik"a cekmek, icerigin bir kismini yanlis adlandirmak
-- olurdu. Ustkume, yanlis addan iyidir.
-- ============================================================================

-- --- Ad hizalamalari (slug ve kimlik sabit) ---
update public.categories set name = 'Seks Oyuncakları & Yetişkin Ürünleri'
 where slug = 'yetiskin-urunleri' and name <> 'Seks Oyuncakları & Yetişkin Ürünleri';

update public.categories set name = 'Bebek Giyim'
 where slug = 'bebek-giyim' and name <> 'Bebek Giyim';

update public.categories set name = 'Emzirme Ürünleri'
 where slug = 'emzirme-anne-saglik' and name <> 'Emzirme Ürünleri';

-- --- Spec'te olup uretimde hic olmayan iki Seviye-2 ---
insert into public.categories (slug, name, parent_id, sort_order, is_active)
select v.slug::citext, v.ad,
       (select id from public.categories where slug = v.ust::citext),
       v.sira, true
  from (values
    ('kisisel-bakim-urunleri', 'Kişisel Bakım Ürünleri', 'supermarket', 60),
    ('anne-urunleri',          'Anne Ürünleri',          'anne-bebek',  60)
  ) as v(slug, ad, ust, sira)
on conflict (slug) do nothing;

do $$
declare
  n int;
  eksik text;
begin
  -- Spec'te adiyla gecen her seyin artik var oldugunu KANITLA.
  for eksik in
    select a.ad from (values
      ('Seks Oyuncakları & Yetişkin Ürünleri'), ('Bebek Giyim'),
      ('Emzirme Ürünleri'), ('Anne Ürünleri'), ('Kişisel Bakım Ürünleri')
    ) as a(ad)
    where not exists (select 1 from public.categories c where c.name = a.ad)
  loop
    raise exception 'BASARISIZ: "%" kategorisi yok', eksik;
  end loop;

  -- Yinelenen ad uretilmedigini KANITLA (kural 9).
  select count(*) into n from (
    select parent_id, lower(name) from public.categories group by 1,2 having count(*) > 1
  ) t;
  if n > 0 then
    raise exception 'BASARISIZ: % yinelenen ad olustu', n;
  end if;

  -- Seviye-1 sayisi 18 kalmali: yeni satirlarin ikisi de bir ebeveyne bagli.
  select count(*) into n from public.categories where parent_id is null;
  if n <> 18 then
    raise exception 'BASARISIZ: Seviye-1 sayisi % oldu (18 olmali)', n;
  end if;

  -- Yeni satirlarin gercekten bir ebeveyni var mi (yanlis slug sessizce
  -- NULL ebeveyn birakirdi ve kategori 19. Seviye-1 olurdu).
  select count(*) into n from public.categories
   where slug in ('kisisel-bakim-urunleri','anne-urunleri') and parent_id is null;
  if n > 0 then
    raise exception 'BASARISIZ: % yeni kategori ebeveynsiz kaldi', n;
  end if;

  raise notice 'ad hizalamasi tamam; Seviye-1 = 18, yinelenen ad yok';
end $$;