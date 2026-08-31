-- ============================================================================
-- TEST · Arama filtreleri (marka, ücretsiz kargo) ve sayaç kuralı
-- ============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  toplam int; sonuc int; markalar jsonb; n int;
begin
  -- --- Marka filtresi süzüyor mu -------------------------------------------
  select count(*) into toplam from public.search_products();
  select count(*) into sonuc
    from public.search_products(null,null,null,null,'relevance',100,0, array['Sony'], false);

  if sonuc = 0 or sonuc >= toplam then
    raise exception 'BAŞARISIZ: marka filtresi süzmedi (% / %)', sonuc, toplam;
  end if;
  raise notice '✓ marka filtresi sonucu daraltiyor';

  -- --- Büyük/küçük harf ------------------------------------------------------
  -- Besleme "Sony", "SONY" ve "sony" gönderebilir; kullanıcıya bunların ayrı
  -- marka gibi görünmesi hata olurdu.
  if (select count(*) from public.search_products(null,null,null,null,'relevance',100,0, array['sony'], false))
     <> sonuc then
    raise exception 'BAŞARISIZ: marka eşleşmesi büyük/küçük harfe duyarlı';
  end if;
  raise notice '✓ marka eslesmesi buyuk/kucuk harften bagimsiz';

  -- --- Boş dizi filtre SAYILMAZ ---------------------------------------------
  -- İstemci "hiç marka seçilmedi" durumunu boş dizi olarak gönderebilir;
  -- bunun sonucu sıfırlamaması gerekir.
  if (select count(*) from public.search_products(null,null,null,null,'relevance',100,0, array[]::text[], false))
     <> toplam then
    raise exception 'BAŞARISIZ: bos marka dizisi sonucu daraltti';
  end if;
  raise notice '✓ bos marka dizisi filtre sayilmiyor';

  -- --- Ücretsiz kargo filtresi ----------------------------------------------
  select count(*) into sonuc
    from public.search_products(null,null,null,null,'relevance',100,0, null, true);
  if sonuc = 0 then
    raise exception 'BAŞARISIZ: ucretsiz kargo filtresi hicbir sonuc vermedi';
  end if;

  -- Dönen her grubun GERÇEKTEN kargosuz bir aktif teklifi olmalı.
  if exists (
    select 1
    from public.search_products(null,null,null,null,'relevance',100,0, null, true) s
    where not exists (
      select 1 from public.products p
      where p.group_id = s.group_id and p.status = 'active' and p.shipping_fee_cents = 0
    )
  ) then
    raise exception 'BAŞARISIZ: kargosuz olmayan grup sonuca girdi';
  end if;
  raise notice '✓ ucretsiz kargo filtresi yalnizca kargosuz teklifi olan gruplari veriyor';

  -- --- total_count filtreyle tutarlı ----------------------------------------
  -- Sayfalama bu değere dayanır; filtreyi yok sayarsa kullanıcı var olmayan
  -- sayfalara yönlendirilir.
  if (select distinct total_count
        from public.search_products(null,null,null,null,'relevance',1,0, array['Sony'], false))
     <> (select count(*) from public.search_products(null,null,null,null,'relevance',100,0, array['Sony'], false))
  then
    raise exception 'BAŞARISIZ: total_count marka filtresini yok sayiyor';
  end if;
  raise notice '✓ total_count filtreli toplami dogru veriyor';

  -- --- SAYAÇ KURALI: bir filtre KENDİ sayacını daraltmaz --------------------
  -- Kullanıcı "Sony" seçtiğinde diğer markaların sayıları görünür kalmalı;
  -- yoksa seçimini genişletemez, filtreyi kaldırıp baştan denemek zorunda
  -- kalır.
  select public.search_facets() -> 'brands' into markalar;
  select jsonb_array_length(markalar) into n;
  if n < 2 then
    raise exception 'BAŞARISIZ: test verisinde en az iki marka olmali (% adet)', n;
  end if;

  if jsonb_array_length(public.search_facets(null,null,array['Sony'],false) -> 'brands') <> n then
    raise exception 'BAŞARISIZ: marka secimi marka sayacini darallti';
  end if;
  raise notice '✓ marka secimi diger markalarin sayacini daraltmiyor';

  -- Aynı kural kargo için.
  if (public.search_facets(null,null,null,true) ->> 'free_shipping_count')::int
     <> (public.search_facets() ->> 'free_shipping_count')::int then
    raise exception 'BAŞARISIZ: kargo secimi kendi sayacini daraltti';
  end if;
  raise notice '✓ kargo secimi kendi sayacini daraltmiyor';

  -- --- Marka sayacı kargo filtresine UYAR -----------------------------------
  -- Kendi sayacını daraltmaması, DİĞER filtreleri yok sayması demek değil.
  if (public.search_facets(null,null,null,true) -> 'brands') = (public.search_facets() -> 'brands')
     and (select count(*) from public.search_products(null,null,null,null,'relevance',100,0,null,true))
         <> (select count(*) from public.search_products())
  then
    raise exception 'BAŞARISIZ: marka sayaci kargo filtresini yok sayiyor';
  end if;
  raise notice '✓ marka sayaci diger filtreleri uyguluyor';
end $$;

rollback;
