-- ============================================================================
-- FİYATI DÜŞENLER — "fırsat" iddiasının dayanağı var mı?
-- ----------------------------------------------------------------------------
-- Bu dosyanın tek işi şunu kanıtlamak: price_drops() bir düşüşü ancak KENDİ
-- ölçtüğümüz iki farklı fiyat gözlemi varsa bildiriyor. Mağazanın üstü çizili
-- fiyatından ("compare_at_price_cents") fırsat üretmiyor, tek ölçümden düşüş
-- çıkarmıyor, eşiğin altındaki oynamaya fırsat demiyor.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

do $$
declare
  v_grup   uuid := '4f000000-0000-4000-8000-0000000000d1';
  v_grup2  uuid := '4f000000-0000-4000-8000-0000000000d2';
  v_urun   uuid := '5f000000-0000-4000-8000-0000000000d1';
  v_urun2  uuid := '5f000000-0000-4000-8000-0000000000d2';
  v_elektronik uuid := 'c0000000-0000-4000-8000-000000000001';
  v_moda       uuid := 'c0000000-0000-4000-8000-000000000002';
  v_satici uuid;
  n     int;
  oran  numeric;
  ref   bigint;
  govde text;
begin
  select id into v_satici from public.vendors where status = 'approved' limit 1;
  if v_satici is null then
    raise exception 'BAŞARISIZ: testin dayanacagi onayli satici yok';
  end if;

  -- Kurulum: tek teklifli bir grup. Fiyat 1.000 TL, ustu cizili fiyat 1.500 TL.
  -- Ustu cizili fiyat KASITLI olarak yuksek: eger price_drops o alani
  -- kullanirsa bu urun daha fiyati hic degismeden %33 "dusus" ile listeye
  -- girer ve asagidaki 2. iddia patlar.
  --
  -- Neden 1.500 TL, daha da abartili bir deger degil? Cunku sitenin kendi
  -- ilan risk kapisi (`imkansiz_indirim`) ustu cizili fiyata gore %90'dan
  -- buyuk indirim iddiasini zaten engelliyor ve ilani taslaga cekiyor. Boyle
  -- bir urun hicbir listede gorunmeyecegi icin test bir sey kanitlamazdi.
  insert into public.product_groups (id, slug, title, category_id)
  values (v_grup, 'test-firsat-dusen', 'Test Fırsat Ürünü', v_elektronik);

  insert into public.products
    (id, vendor_id, group_id, external_id, title, category_id,
     price_cents, compare_at_price_cents, stock, status)
  values (v_urun, v_satici, v_grup, 'TEST-FIRSAT-1', 'Test Fırsat Ürünü',
          v_elektronik, 100000, 150000, 10, 'active');

  ---------------------------------------------------------------------------
  -- 1) TEK ÖLÇÜM = DÜŞÜŞ YOK
  --    Bu noktada elimizde tek bir fiyat gözlemi var. Karşılaştırılacak
  --    önceki değer olmadığı için "düştü" denemez. Üstü çizili fiyat 5 kat
  --    yüksek; fonksiyon ona baksaydı burada satır dönerdi.
  ---------------------------------------------------------------------------
  select count(*) into n from public.price_drops(30, 0.05, null, 100)
   where group_id = v_grup;
  if n <> 0 then
    raise exception 'BAŞARISIZ: tek olcumle dusus uretildi (% satir)', n;
  end if;
  raise notice '✓ tek olcumden dusus uretilmiyor';

  ---------------------------------------------------------------------------
  -- 2) MAĞAZANIN ÜSTÜ ÇİZİLİ FİYATI REFERANS DEĞİL
  --    Fiyat degismeden ikinci bir gozlem eklendiginde de dusus olmamali:
  --    iki olcum var ama ikisi de ayni. Tek "dusus" kaynagi olarak geriye
  --    compare_at_price_cents kaliyor; o kullanilmadigi icin satir yok.
  ---------------------------------------------------------------------------
  insert into public.price_points (product_id, price_cents, in_stock, observed_at)
  values (v_urun, 100000, true, now() - interval '3 days');

  select count(*) into n from public.price_drops(30, 0.05, null, 100)
   where group_id = v_grup;
  if n <> 0 then
    raise exception 'BAŞARISIZ: fiyat sabitken dusus uretildi — magazanin ustu cizili fiyati kullanilmis olabilir';
  end if;
  raise notice '✓ magazanin ustu cizili fiyatindan firsat uretilmiyor';

  ---------------------------------------------------------------------------
  -- 3) GERÇEK DÜŞÜŞ ÖLÇÜLDÜĞÜNDE LİSTELENİR
  --    1.000 TL -> 400 TL: %60 dusus, iki farkli gozlem.
  ---------------------------------------------------------------------------
  update public.products set price_cents = 40000 where id = v_urun;

  select count(*), max(drop_ratio), max(reference_price_cents)
    into n, oran, ref
    from public.price_drops(30, 0.05, null, 100)
   where group_id = v_grup;

  if n <> 1 then
    raise exception 'BAŞARISIZ: gercek dusus listelenmedi (% satir)', n;
  end if;
  -- Referans, GÖRÜLMÜŞ en yüksek fiyat olmalı (100000) — 500000 degil.
  if ref <> 100000 then
    raise exception 'BAŞARISIZ: referans fiyat gozlenen en yuksek fiyat degil (%)', ref;
  end if;
  if round(oran, 2) <> 0.60 then
    raise exception 'BAŞARISIZ: dusus orani yanlis hesaplandi (%)', oran;
  end if;
  raise notice '✓ olculen dusus dogru oranla listeleniyor';

  ---------------------------------------------------------------------------
  -- 4) EŞİĞİN ALTINDAKİ DÜŞÜŞ FIRSAT DEĞİL
  ---------------------------------------------------------------------------
  select count(*) into n from public.price_drops(30, 0.75, null, 100)
   where group_id = v_grup;
  if n <> 0 then
    raise exception 'BAŞARISIZ: esigin altindaki dusus listelendi';
  end if;
  raise notice '✓ esik altindaki dusus listelenmiyor';

  ---------------------------------------------------------------------------
  -- 5) PENCERE DIŞINDAKİ GÖZLEM SAYILMAZ
  --    Gozlemleri 90 gun geriye alirsak 30 gunluk pencerede hicbir olcum
  --    kalmaz; eski bir dususu bugunun firsati gibi gostermek yasak.
  ---------------------------------------------------------------------------
  update public.price_points
     set observed_at = observed_at - interval '90 days'
   where product_id = v_urun;

  select count(*) into n from public.price_drops(30, 0.05, null, 100)
   where group_id = v_grup;
  if n <> 0 then
    raise exception 'BAŞARISIZ: pencere disindaki gozlemden firsat uretildi';
  end if;

  select count(*) into n from public.price_drops(180, 0.05, null, 100)
   where group_id = v_grup;
  if n <> 1 then
    raise exception 'BAŞARISIZ: pencere genisletilince gozlem bulunamadi';
  end if;
  raise notice '✓ gozlem penceresi uygulaniyor';

  -- Gozlemleri pencere icine geri al.
  update public.price_points
     set observed_at = observed_at + interval '90 days'
   where product_id = v_urun;

  ---------------------------------------------------------------------------
  -- 6) KATEGORİ SÜZGECİ
  ---------------------------------------------------------------------------
  insert into public.product_groups (id, slug, title, category_id)
  values (v_grup2, 'test-firsat-moda', 'Test Moda Ürünü', v_moda);

  insert into public.products
    (id, vendor_id, group_id, external_id, title, category_id,
     price_cents, stock, status)
  values (v_urun2, v_satici, v_grup2, 'TEST-FIRSAT-2', 'Test Moda Ürünü',
          v_moda, 20000, 10, 'active');
  update public.products set price_cents = 10000 where id = v_urun2;

  select count(*) into n from public.price_drops(30, 0.05, v_elektronik, 100)
   where group_id = v_grup2;
  if n <> 0 then
    raise exception 'BAŞARISIZ: kategori suzgeci baska kategoriyi sizdirdi';
  end if;

  select count(*) into n from public.price_drops(30, 0.05, v_moda, 100)
   where group_id = v_grup2;
  if n <> 1 then
    raise exception 'BAŞARISIZ: kategori suzgeci dogru urunu elemis';
  end if;
  raise notice '✓ kategori suzgeci calisiyor';

  ---------------------------------------------------------------------------
  -- 7) LİMİT UYGULANIYOR
  ---------------------------------------------------------------------------
  select count(*) into n from public.price_drops(365, 0.01, null, 1);
  if n > 1 then
    raise exception 'BAŞARISIZ: limit asildi (% satir)', n;
  end if;
  raise notice '✓ limit uygulaniyor';

  ---------------------------------------------------------------------------
  -- 8) YAPISAL GÜVENCE: fonksiyon govdesi magazanin fiyat alanina bakmiyor.
  --    Yukaridaki davranis testleri bugunku veriyle geciyor; bu kontrol
  --    yarin biri "referans olsun" diye o alani eklerse derlemeyi dusurur.
  ---------------------------------------------------------------------------
  select pg_get_functiondef(p.oid) into govde
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'price_drops';

  if govde ilike '%compare_at_price_cents%' then
    raise exception 'BAŞARISIZ: price_drops magazanin ustu cizili fiyatini kullaniyor';
  end if;
  raise notice '✓ fonksiyon govdesi magazanin ustu cizili fiyatini kullanmiyor';
end $$;

-- Fırsat listesi vitrin: giriş yapmamış ziyaretçi de çağırabilmeli.
do $$
begin
  if not has_function_privilege('anon', 'public.price_drops(int, numeric, uuid, int)', 'execute') then
    raise exception 'BAŞARISIZ: anon firsat listesini cagiramiyor';
  end if;
  raise notice '✓ firsat listesi anon icin acik';
end $$;

rollback;
