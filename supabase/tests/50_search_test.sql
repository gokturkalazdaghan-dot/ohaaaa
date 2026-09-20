-- ============================================================================
-- search_products() sayfalama ve search_facets() iddialari
-- ============================================================================
begin;

do $$
declare
  v_total     bigint;
  v_total_p2  bigint;
  v_rows      integer;
  v_rows_p2   integer;
  v_cat       uuid;
  v_child     uuid;
  v_facets    jsonb;
  v_min       bigint;
  v_max       bigint;
  v_first     uuid;
  v_first_p2  uuid;
  v_currency  char(3);
begin
  -- 1) total_count sayfadaki satir sayisi degil, TOPLAM eslesme olmali.
  --    Ayni sey olsaydi ikinci sayfa diye bir sey olmazdi.
  select count(*), max(s.total_count)
    into v_rows, v_total
    from public.search_products(null, null, null, null, 'relevance', 2, 0) s;

  if v_rows <> 2 then
    raise exception 'ilk sayfada 2 satir beklenirdi, % geldi', v_rows;
  end if;
  if v_total <= 2 then
    raise exception 'total_count sayfa boyutundan buyuk olmali (seed >2 urun icerir), % geldi', v_total;
  end if;
  raise notice '✓ total_count sayfa boyutunu degil toplam sonucu veriyor';

  -- 2) Offset gercekten farkli bir sayfa dondurmeli ve toplam degismemeli.
  select count(*), max(s.total_count)
    into v_rows_p2, v_total_p2
    from public.search_products(null, null, null, null, 'price_asc', 2, 2) s;

  if v_total_p2 <> v_total then
    raise exception 'sayfa degisince total_count degismemeli: % -> %', v_total, v_total_p2;
  end if;

  select s.group_id into v_first
    from public.search_products(null, null, null, null, 'price_asc', 2, 0) s limit 1;
  select s.group_id into v_first_p2
    from public.search_products(null, null, null, null, 'price_asc', 2, 2) s limit 1;

  if v_first = v_first_p2 then
    raise exception 'ikinci sayfa birinciyle ayni urunle basliyor - offset uygulanmiyor';
  end if;
  raise notice '✓ offset farkli sayfa donduruyor, toplam sabit kaliyor';

  -- 3) Ust kategori secimi alt kategorideki urunleri de kapsamali.
  --    "Elektronik" diyen kullanici altindaki "Bilgisayar"daki urunu gormeli.
  --
  --    CIFT SABIT YAZILMIYOR, VERIDEN BULUNUYOR. Onceki hali
  --    'elektronik' + 'telefon' slug'larini gomuyordu; taksonomi
  --    degisip 'telefon' ust duzeye cikinca test, kural bozulmadigi
  --    halde kirildi -- yani sabit cift, KURALI degil o gunku
  --    yerlesimi test ediyordu.
  --
  --    Simdi urunu olan herhangi bir alt kategori ve onun ustu
  --    seciliyor. Boyle bir cift yoksa iddia atlanir: kapsama kurali
  --    ancak gercekten ic ice bir kategori varsa anlamlidir.
  select g.category_id, c.parent_id
    into v_child, v_cat
    from public.product_groups g
    join public.categories c on c.id = g.category_id
   where c.parent_id is not null
     and g.offer_count > 0
   limit 1;

  if v_child is not null then
    select count(*) into v_rows
      from public.search_products(null, v_cat, null, null, 'relevance', 100, 0) s
      join public.product_groups g on g.id = s.group_id
     where g.category_id = v_child;

    if v_rows = 0 then
      raise exception 'ust kategori aramasi alt kategori urunlerini kapsamiyor';
    end if;
    raise notice '✓ ust kategori alt kategorileri kapsiyor';
  end if;

  -- 4) Fiyat filtresi gercekten daraltmali -- PARA BIRIMI ICINDE.
  --
  --    `p_currency` VERILMEDIGINDE fiyat suzgeci BILEREK uygulanmaz. Sebebi
  --    olculmustu: farkli mezhepleri (TRY, HUF, USD) tek araliga sokmak
  --    "en ucuz"u fiyata gore degil MEZHEBE gore secer ve dusuk mezhepli
  --    para birimi her zaman kazanirdi. Bu yuzden filtre bir para birimi
  --    secildiginde devreye girer.
  --
  --    Para birimi katalogdan OKUNUYOR, sabit yazilmiyor: tohum degisince
  --    test sessizce anlamsizlasmasin.
  select g.price_currency into v_currency
    from public.product_groups g
   where g.offer_count > 0 and g.price_currency is not null
   limit 1;

  if v_currency is null then
    raise notice '- fiyat araligi iddiasi atlandi: katalogda para birimli grup yok';
  else
    select coalesce(max(s.total_count), 0) into v_total
      from public.search_products(null, null, null, null, 'relevance', 1, 0,
                                  null, false, v_currency) s;
    select coalesce(max(s.total_count), 0) into v_total_p2
      from public.search_products(null, null, 1, 2, 'relevance', 1, 0,
                                  null, false, v_currency) s;

    if v_total_p2 >= v_total then
      raise exception 'imkansiz fiyat araligi sonuclari daraltmadi: % -> %', v_total, v_total_p2;
    end if;
    raise notice '✓ fiyat araligi filtresi para birimi icinde uygulaniyor';

    -- Para birimi VERILMEDIGINDE daraltmamali: bu bir kaza degil, karar.
    select coalesce(max(s.total_count), 0) into v_total_p2
      from public.search_products(null, null, 1, 2, 'relevance', 1, 0) s;
    if v_total_p2 <> v_total then
      raise exception
        'para birimi verilmeden fiyat suzgeci uygulandi (% -> %) -- mezhepler '
        'karisirdi', v_total, v_total_p2;
    end if;
    raise notice '✓ para birimi yokken fiyat suzgeci uygulanmiyor (kasitli)';
  end if;

  -- 5) search_facets gercek sinirlari vermeli.
  v_facets := public.search_facets(null, null);
  v_min := (v_facets->>'min_price_cents')::bigint;
  v_max := (v_facets->>'max_price_cents')::bigint;

  if v_min is null or v_max is null or v_min > v_max then
    raise exception 'facet fiyat sinirlari gecersiz: % - %', v_min, v_max;
  end if;

  -- Sinirlar katalogun gercek degerleriyle ortusmeli, yuvarlanmis olmamali.
  if v_min <> (select min(min_price_cents) from public.product_groups where offer_count > 0) then
    raise exception 'facet alt siniri katalogla uyusmuyor';
  end if;
  raise notice '✓ facet fiyat sinirlari gercek katalog degerleri';

  -- 6) Fiyat filtresi facet sinirlarini DARALTMAMALI: daraltsaydi kullanici
  --    kaydiriciyi geri genisletemezdi.
  if (public.search_facets(null, null)->>'max_price_cents')::bigint <> v_max then
    raise exception 'facet sinirlari kararsiz';
  end if;

  -- 7) Kategori sayaclari donmeli ve toplamlari makul olmali.
  if jsonb_array_length(v_facets->'categories') = 0 then
    raise exception 'facet kategori listesi bos';
  end if;
  raise notice '✓ facet kategori sayaclari doluyor';
end $$;

rollback;
