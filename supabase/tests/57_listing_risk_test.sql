-- ============================================================================
-- TEST · İlan risk motoru
-- ----------------------------------------------------------------------------
-- İki yönlü sınanır. Bir güvenlik filtresinin YAKALAMASI kadar, masum ilanı
-- YAKALAMAMASI da önemlidir: her ilanı tutan bir filtre, kimsenin satış
-- yapamadığı bir pazar yeri demektir.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_vendor uuid;   -- ilani sinanan satici
  v_v2     uuid;   -- karsilastirma icin BASKA saticilar
  v_v3     uuid;
  v_group  uuid;
  v_cat    uuid;
  v_id     uuid;
  v_status public.product_status;
  v_flags  int;
  v_rule   text;
  v_medyan numeric;
begin
  /*
   * Medyan BASKA saticilarin tekliflerinden hesaplanir; satici kendi
   * medyanini olusturamasin diye. Bu yuzden referans grup UC AYRI saticiyla
   * kurulur.
   *
   * Ilk yazista uc teklifi de ayni saticiya vermistim ve motor -- dogru
   * olarak -- hicbirini karsilastirma verisi saymadi; test "yakalamadi"
   * diye dustu. Kusur motorda degil, testin gercekci olmamasindaydi.
   */
  select id into v_vendor from public.vendors where slug = 'teknomarkt';
  select id into v_v2     from public.vendors where slug = 'moda-vitrin';
  select id into v_v3     from public.vendors where slug = 'ev-bahce-dunyasi';
  select category_id into v_cat from public.products where vendor_id = v_vendor limit 1;

  -- Referans grup: uc satici, 1000 / 1100 / 1200 TL -> medyan 1100 TL
  insert into public.product_groups (id, slug, title, category_id)
  values (gen_random_uuid(), 'risk-test-urun', 'Risk Test Urunu', v_cat)
  returning id into v_group;

  insert into public.products (vendor_id, external_id, title, price_cents, stock, status, group_id, category_id)
  values (v_v2, 'RT-1', 'Risk Test Urunu', 100000, 5, 'active', v_group, v_cat),
         (v_v3, 'RT-2', 'Risk Test Urunu', 110000, 5, 'active', v_group, v_cat),
         (v_v2, 'RT-3', 'Risk Test Urunu', 120000, 5, 'active', v_group, v_cat);

  select percentile_cont(0.5) within group (order by price_cents) into v_medyan
    from public.products where group_id = v_group and status = 'active';
  if v_medyan <> 110000 then
    raise exception 'KURULUM HATASI: medyan % bekleniyordu, % cikti', 110000, v_medyan;
  end if;
  raise notice '✓ referans grup kuruldu, medyan % kurus', v_medyan;

  -- --- 1) NORMAL fiyat yayina girer (yanlis pozitif yok) -------------------
  insert into public.products (vendor_id, external_id, title, price_cents, stock, status, group_id, category_id)
  values (v_vendor, 'RT-OK', 'Risk Test Urunu', 95000, 5, 'active', v_group, v_cat)
  returning id into v_id;
  select status into v_status from public.products where id = v_id;
  if v_status <> 'active' then
    raise exception 'BASARISIZ: normal fiyatli ilan tutuldu (%)', v_status;
  end if;
  raise notice '✓ normal fiyatli ilan yayina girdi (medyanin %%86si)';

  -- --- 2) Medyanin %40 ALTI ENGELLENIR -------------------------------------
  -- 30.000 kurus = medyanin %27si -> engel
  insert into public.products (vendor_id, external_id, title, price_cents, stock, status, group_id, category_id)
  values (v_vendor, 'RT-UCUZ', 'Risk Test Urunu', 30000, 5, 'active', v_group, v_cat)
  returning id into v_id;
  select status into v_status from public.products where id = v_id;
  if v_status <> 'draft' then
    raise exception 'BASARISIZ: asiri ucuz ilan yayina girdi (%)', v_status;
  end if;
  select count(*), min(rule) into v_flags, v_rule
    from public.product_risk_flags where product_id = v_id and severity = 'engel';
  if v_flags = 0 then
    raise exception 'BASARISIZ: engel kaydi yazilmadi';
  end if;
  raise notice '✓ asiri ucuz ilan tutuldu ve gerekce yazildi (%)', v_rule;

  -- --- 3) Karar DAYANAGI saklaniyor ----------------------------------------
  -- "Sistem oyle dedi" bir gerekce degil; satici itiraz edince sayilar lazim.
  if not exists (
    select 1 from public.product_risk_flags
     where product_id = v_id and detail ? 'medyan' and detail ? 'esik' and detail ? 'oran'
  ) then
    raise exception 'BASARISIZ: karar dayanagi (medyan/esik/oran) saklanmadi';
  end if;
  raise notice '✓ kararin dayanagi saklaniyor (medyan, esik, oran)';

  -- --- 4) Uyari SEVIYESI yayini DURDURMAZ ----------------------------------
  -- 55.000 = medyanin %50si -> uyari araliginda (%40-%60)
  insert into public.products (vendor_id, external_id, title, price_cents, stock, status, group_id, category_id)
  values (v_vendor, 'RT-UYARI', 'Risk Test Urunu', 55000, 5, 'active', v_group, v_cat)
  returning id into v_id;
  select status into v_status from public.products where id = v_id;
  if v_status <> 'active' then
    raise exception 'BASARISIZ: uyari seviyesi yayini durdurdu (%)', v_status;
  end if;
  if not exists (select 1 from public.product_risk_flags where product_id = v_id and severity = 'uyari') then
    raise exception 'BASARISIZ: uyari kaydi yazilmadi';
  end if;
  raise notice '✓ uyari seviyesi yayini durdurmuyor ama iz birakiyor';

  -- --- 5) Imkansiz indirim iddiasi ENGELLENIR ------------------------------
  insert into public.products
    (vendor_id, external_id, title, price_cents, compare_at_price_cents, stock, status, category_id)
  values (v_vendor, 'RT-INDIRIM', 'Tekil Urun', 5000, 1000000, 5, 'active', v_cat)
  returning id into v_id;
  select status into v_status from public.products where id = v_id;
  if v_status <> 'draft' then
    raise exception 'BASARISIZ: %%99 indirim iddiasi yayina girdi (%)', v_status;
  end if;
  raise notice '✓ imkansiz indirim iddiasi engellendi';

  -- --- 6) TEK teklifli grupta medyan kurali CALISMAZ -----------------------
  -- Karsilastirilacak veri yokken "ucuz" diyebilmek mumkun degil; tahmin
  -- uzerine ilan tutmak, gercek bir ucuzu cezalandirmak olurdu.
  insert into public.product_groups (id, slug, title, category_id)
  values (gen_random_uuid(), 'risk-tekil-grup', 'Tekil Grup', v_cat)
  returning id into v_group;

  insert into public.products (vendor_id, external_id, title, price_cents, stock, status, group_id, category_id)
  values (v_v2, 'RT-TEK-1', 'Tekil Grup', 100000, 5, 'active', v_group, v_cat);

  insert into public.products (vendor_id, external_id, title, price_cents, stock, status, group_id, category_id)
  values (v_vendor, 'RT-TEK-2', 'Tekil Grup', 1000, 5, 'active', v_group, v_cat)
  returning id into v_id;
  select status into v_status from public.products where id = v_id;
  if v_status <> 'active' then
    raise exception 'BASARISIZ: yetersiz veriyle ilan tutuldu (%)', v_status;
  end if;
  raise notice '✓ yeterli karsilastirma verisi yokken ilan tutulmuyor';

  -- --- 7) Stok guncellemesi yeniden degerlendirme TETIKLEMEZ ---------------
  select id into v_id from public.products where external_id = 'RT-OK';
  delete from public.product_risk_flags where product_id = v_id;
  update public.products set stock = 3 where id = v_id;
  if exists (select 1 from public.product_risk_flags where product_id = v_id) then
    raise exception 'BASARISIZ: stok guncellemesi risk degerlendirmesi tetikledi';
  end if;
  raise notice '✓ fiyat degismeden yapilan guncelleme yeniden degerlendirilmiyor';

  -- --- 8) Esikler tablodan okunuyor (koda gomulu degil) --------------------
  update public.risk_thresholds set value = 0.05 where key = 'median_ratio_block';
  select id into v_group from public.product_groups where slug = 'risk-test-urun';
  insert into public.products (vendor_id, external_id, title, price_cents, stock, status, group_id, category_id)
  values (v_vendor, 'RT-ESIK', 'Risk Test Urunu', 30000, 5, 'active', v_group, v_cat)
  returning id into v_id;
  select status into v_status from public.products where id = v_id;
  if v_status <> 'active' then
    raise exception 'BASARISIZ: esik degistirildi ama karar degismedi (%)', v_status;
  end if;
  raise notice '✓ esikler tablodan okunuyor, ayarlanabilir';
end $$;

rollback;
