-- ===========================================================================
-- KANONİK LEVEL-1 TAKSONOMİSİ — 17 üst kategori
-- ===========================================================================
--
-- SLUG'LAR DEĞİŞMİYOR. Yalnızca görünen ADLAR standartlaşıyor ve üç yeni
-- kategori açılıyor. Slug değiştirmek `/kategori/<slug>` adreslerini kırar;
-- site haritası, kanonik etiketler ve dış bağlantılar o adreslere bakıyor.
-- Ad değiştirmek hiçbir adresi etkilemez.
--
-- ÜÇ YENİ KATEGORİ
--   saglik-medikal     Listede vardı, katalogda yoktu.
--   bilgisayar-tablet  `elektronik` gerçekte BİLGİSAYAR kataloğu taşıyor
--                      (32.873 grup). Listede ikisi ayrı kategori.
--   oto-yedek-parca    `yapi-market-bahce-oto` altındaki oto/motosiklet
--                      kendi üst kategorisine çıkıyor.
--
-- HİÇBİR ÜRÜN SİLİNMİYOR VE HİÇBİR ÜRÜNÜN KENDİ KATEGORİSİ DEĞİŞMİYOR.
-- Taşınan şey alt kategorilerin ÜST kategorisi; ürünün `category_id`'si
-- olduğu gibi kalıyor. Yani kırılan tek şey ekmek kırıntısındaki üst
-- kategori adı -- adres değil.
--
-- GIDA KAPSAM DIŞI
-- `supermarket` altındaki `gida` ve `icecek` PASİFLEŞTİRİLİYOR, silinmiyor.
-- Süpermarket altında yalnızca gıda dışı ürünler desteklenecek. Silmek
-- geri dönüşü olmayan bir karar olurdu; `is_active = true` tek satırla
-- geri alınır.
-- ===========================================================================

-- --- 1) Üç yeni üst kategori (idempotent) ----------------------------------
insert into public.categories (slug, name, parent_id, sort_order, is_active)
values
  ('saglik-medikal',    'Sağlık & Medikal',    null,  1, true),
  ('bilgisayar-tablet', 'Bilgisayar & Tablet', null,  7, true),
  ('oto-yedek-parca',   'Oto & Yedek Parça',   null,  4, true)
on conflict (slug) do update
  set name = excluded.name, parent_id = null,
      sort_order = excluded.sort_order, is_active = true;

-- --- 2) Mevcut on dördün adı ve sırası standartlaşıyor ---------------------
update public.categories set name = 'Ev & Yaşam',                  sort_order =  2 where slug = 'ev-yasam';
update public.categories set name = 'Yapı, Bahçe & Hırdavat',      sort_order =  3 where slug = 'yapi-market-bahce-oto';
update public.categories set name = 'Süpermarket',                 sort_order =  5 where slug = 'supermarket';
update public.categories set name = 'Elektrik & Elektronik',       sort_order =  6 where slug = 'elektronik';
update public.categories set name = 'Telefon & Aksesuar',          sort_order =  8 where slug = 'telefon';
update public.categories set name = 'Moda & Giyim',                sort_order =  9 where slug = 'giyim-ayakkabi';
update public.categories set name = 'Beyaz Eşya & Mutfak',         sort_order = 10 where slug = 'beyaz-esya-mutfak';
update public.categories set name = 'Kozmetik & Kişisel Bakım',    sort_order = 11 where slug = 'kozmetik';
update public.categories set name = 'Spor & Outdoor',              sort_order = 12 where slug = 'spor-outdoor';
update public.categories set name = 'Ev Elektroniği',              sort_order = 13 where slug = 'ev-elektronigi';
update public.categories set name = 'Anne & Bebek',                sort_order = 14 where slug = 'anne-bebek';
update public.categories set name = 'Kitap, Kırtasiye & Ofis',     sort_order = 15 where slug = 'kitap-kirtasiye-ofis';
update public.categories set name = 'Oyuncak, Müzik, Film & Oyun', sort_order = 16 where slug = 'oyuncak-muzik-film';
update public.categories set name = 'Altın, Takı & Mücevher',      sort_order = 17 where slug = 'altin-taki-mucevher';

-- `petshop` VERDİĞİNİZ 17'LİK LİSTEDE YOK.
-- Silinmiyor ve pasifleştirilmiyor: altında altı alt kategori var ve Awin
-- dizininde "Pets & Pet Care" sektörü gerçekten mevcut (Nextrition Pet).
-- Karar sizin; o karara kadar sıralamanın sonunda duruyor.
update public.categories set sort_order = 99 where slug = 'petshop';

-- --- 3) Bilgisayar ailesi kendi üst kategorisine taşınıyor -----------------
-- `elektronik` bundan sonra GERÇEKTEN elektrik/elektronik: aksesuar,
-- kulaklık, ses kayıt. Bilgisayarla ilgili her şey yeni üste geçiyor.
update public.categories c
   set parent_id = (select id from public.categories where slug = 'bilgisayar-tablet')
 where c.slug in ('bilgisayar', 'bilgisayar-bilesenleri', 'bilgisayar-yedek-parcalari',
                  'cevre-birimleri', 'veri-depolama', 'yazici', 'yazilim-urunleri',
                  'ag-modem', 'oyuncu-ozel')
   and c.parent_id = (select id from public.categories where slug = 'elektronik');

-- --- 4) Oto ve motosiklet kendi üst kategorisine ---------------------------
update public.categories c
   set parent_id = (select id from public.categories where slug = 'oto-yedek-parca')
 where c.slug in ('motosiklet', 'oto-aksesuar')
   and c.parent_id = (select id from public.categories where slug = 'yapi-market-bahce-oto');

-- --- 5) Sağlık ve medikal kendi üst kategorisine ---------------------------
-- Yalnızca ADI TARTIŞMASIZ olan ikisi taşınıyor. `besin-takviyeleri-vitaminler`
-- kozmetikte BIRAKILDI: takviye ürünü hem kişisel bakım hem sağlık rafında
-- durabilir ve emin olmadan taşımak, ürünleri sessizce başka bir vitrine
-- göndermek olurdu.
update public.categories c
   set parent_id = (select id from public.categories where slug = 'saglik-medikal')
 where c.slug in ('saglik-urunleri', 'medikal-urunler')
   and c.parent_id = (select id from public.categories where slug = 'kozmetik');

-- --- 6) GIDA KAPSAM DIŞI ---------------------------------------------------
update public.categories set is_active = false
 where slug in ('gida', 'icecek')
   and parent_id = (select id from public.categories where slug = 'supermarket');

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_eksik text;
  v_urun_once bigint;
  v_kanonik text[] := array[
    'saglik-medikal','ev-yasam','yapi-market-bahce-oto','oto-yedek-parca',
    'supermarket','elektronik','bilgisayar-tablet','telefon','giyim-ayakkabi',
    'beyaz-esya-mutfak','kozmetik','spor-outdoor','ev-elektronigi','anne-bebek',
    'kitap-kirtasiye-ofis','oyuncak-muzik-film','altin-taki-mucevher'];
begin
  -- 1) On yedisi de var, ETKİN ve ÜST SEVİYE.
  select string_agg(s, ', ') into v_eksik
    from unnest(v_kanonik) s
   where not exists (
     select 1 from public.categories c
      where c.slug = s and c.parent_id is null and c.is_active
   );
  if v_eksik is not null then
    raise exception 'DOGRULAMA 1: kanonik kategoriler eksik ya da ust seviyede degil: %', v_eksik;
  end if;

  -- 2) Sıra 1..17 ve ÇAKIŞMASIZ. Aynı sırayı iki kategoriye vermek, menüde
  --    turdan tura degisen bir dizilim demekti.
  if (select count(distinct sort_order) from public.categories
       where slug = any(v_kanonik)) <> 17 then
    raise exception 'DOGRULAMA 2: kanonik kategorilerde sira cakismasi var.';
  end if;

  -- 3) HİÇBİR ÜRÜN GRUBU KATEGORİSİZ KALMADI. Bu gocun tek bir urunun
  --    category_id sine dokunmamasi gerekiyordu.
  select count(*) into v_urun_once
    from public.product_groups g
   where g.category_id is not null
     and not exists (select 1 from public.categories c where c.id = g.category_id);
  if v_urun_once > 0 then
    raise exception 'DOGRULAMA 3: % urun grubunun kategorisi artik yok.', v_urun_once;
  end if;

  -- 4) Bilgisayar ailesi tasindi ve ELEKTRONIK BOSALMADI.
  if (select count(*) from public.categories c
       join public.categories p on p.id = c.parent_id
      where p.slug = 'bilgisayar-tablet') < 9 then
    raise exception 'DOGRULAMA 4: bilgisayar ailesi yeni ust kategoriye tasinmadi.';
  end if;
  if (select count(*) from public.categories c
       join public.categories p on p.id = c.parent_id
      where p.slug = 'elektronik') = 0 then
    raise exception 'DOGRULAMA 4b: elektronik tamamen bosaldi.';
  end if;

  -- 5) Gida kapsam disi ama SILINMEDI.
  if exists (select 1 from public.categories where slug in ('gida','icecek') and is_active) then
    raise exception 'DOGRULAMA 5: gida kategorileri hala etkin.';
  end if;
  if (select count(*) from public.categories where slug in ('gida','icecek')) <> 2 then
    raise exception 'DOGRULAMA 5b: gida kategorileri SILINMIS -- geri alinamaz bir karar verilmis.';
  end if;

  -- 6) Dongu yok: hicbir kategori kendi atasi olamaz.
  if exists (
    with recursive z(id, ata, derinlik) as (
      select c.id, c.parent_id, 1 from public.categories c
      union all
      select z.id, c.parent_id, z.derinlik + 1
        from z join public.categories c on c.id = z.ata
       where z.ata is not null and z.derinlik < 10
    )
    select 1 from z where derinlik >= 10
  ) then
    raise exception 'DOGRULAMA 6: kategori agacinda dongu olustu.';
  end if;

  raise notice
    'Kanonik 17 kategori kuruldu. Slug degismedi, urun kategorisi degismedi, '
    'gida kapsam disi (silinmedi), petshop listede olmadigi icin sona alindi.';
end $$;