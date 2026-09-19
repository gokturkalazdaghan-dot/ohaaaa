-- ============================================================================
-- TOPLU TEKLİF YAZMA RPC — yazdığını, koruduğunu ve reddettiğini kanıtla
-- ----------------------------------------------------------------------------
-- Bu fonksiyon iki şeyi birden taşıyor: uzun bir `statement_timeout` ve
-- `SECURITY DEFINER`. İkisi bir arada dikkat ister -- dışarıya açık kalsaydı,
-- uzun süreli sorgularla veritabanını tüketmenin hazır yolu olurdu.
--
-- Beş iddia:
--   1) yeni teklif EKLENMELİ
--   2) var olan teklif GÜNCELLENMELİ (çakışma yolu çalışıyor)
--   3) tanınmayan sütun SESSİZCE DÜŞMEMELİ, hata vermeli
--   4) `anon` ÇAĞIRAMAMALI
--   5) fonksiyon kendi süre tavanını TAŞIMALI
--   6) çakışma indeksi KISMİ OLMAMALI
--
-- (3) özellikle önemli: sütun listesi gönderilen JSON'dan türetiliyor. O
-- esnekliğin bedeli, yanlış yazılmış bir alan adının sessizce yok sayılması
-- OLABİLİRDİ. Doğrulama tam olarak bunu engelliyor ve testi de bu yüzden var.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

do $$
declare
  v_merchant uuid;
  v_group    uuid;
  v_sonuc    jsonb;
  v_fiyat    integer;
  v_baslik   text;
  v_mesaj    text;
  v_hata     boolean;
begin
  insert into public.merchants (slug, display_name, network)
  values ('rpc-yazma-testi', 'RPC Yazma Testi', 'direct')
  returning id into v_merchant;

  insert into public.product_groups (slug, title)
  values ('rpc-yazma-testi-grup', 'RPC Yazma Testi')
  returning id into v_group;

  -- --------------------------------------------------------------------
  -- 1) YENİ TEKLİF EKLENMELİ
  -- --------------------------------------------------------------------
  v_sonuc := public.ingest_upsert_offers(jsonb_build_array(
    jsonb_build_object(
      'fulfillment', 'affiliate',
      'merchant_id', v_merchant,
      'group_id',    v_group,
      'external_id', 'rpc-1',
      'title',       'Ilk hali',
      'product_url', 'https://example.invalid/urun',
      'price_cents', 10000,
      'shipping_fee_cents', 0,
      'currency',    'TRY',
      'stock',       5,
      'status',      'active',
      'market_code', 'TR'
    )
  ));

  if (v_sonuc ->> 'yazilan')::int <> 1 then
    raise exception 'EKLEME OLMADI: yazilan = %', v_sonuc ->> 'yazilan';
  end if;

  select price_cents, title into v_fiyat, v_baslik
    from public.products
   where merchant_id = v_merchant and external_id = 'rpc-1';

  if v_fiyat is distinct from 10000 or v_baslik is distinct from 'Ilk hali' then
    raise exception 'EKLENEN SATIR YANLIS: fiyat=%, baslik=%', v_fiyat, v_baslik;
  end if;

  -- --------------------------------------------------------------------
  -- 2) VAR OLAN TEKLİF GÜNCELLENMELİ
  -- --------------------------------------------------------------------
  -- Ayni (merchant_id, external_id) ile ikinci cagri YENI SATIR ACMAMALI.
  v_sonuc := public.ingest_upsert_offers(jsonb_build_array(
    jsonb_build_object(
      'fulfillment', 'affiliate',
      'merchant_id', v_merchant,
      'group_id',    v_group,
      'external_id', 'rpc-1',
      'title',       'Guncellenmis hali',
      'product_url', 'https://example.invalid/urun',
      'price_cents', 12345,
      'shipping_fee_cents', 0,
      'currency',    'TRY',
      'stock',       5,
      'status',      'active',
      'market_code', 'TR'
    )
  ));

  select price_cents, title into v_fiyat, v_baslik
    from public.products
   where merchant_id = v_merchant and external_id = 'rpc-1';

  if v_fiyat is distinct from 12345 or v_baslik is distinct from 'Guncellenmis hali' then
    raise exception
      'CAKISMA YOLU CALISMADI: fiyat=%, baslik=% (12345 / Guncellenmis olmaliydi)',
      v_fiyat, v_baslik;
  end if;

  if (select count(*) from public.products
       where merchant_id = v_merchant and external_id = 'rpc-1') <> 1 then
    raise exception 'CAKISMA YERINE IKINCI SATIR ACILDI';
  end if;

  -- --------------------------------------------------------------------
  -- 3) TANINMAYAN SÜTUN SESSİZCE DÜŞMEMELİ
  -- --------------------------------------------------------------------
  -- Sutun listesi JSON'dan turetildigi icin, yanlis yazilmis bir alan adi
  -- sessizce yok sayilabilirdi. O, "yaziliyor sanilan ama hic yazilmayan
  -- alan" demekti -- bu depoda `category_id` ile bir kez yasandi.
  v_hata := false;
  begin
    perform public.ingest_upsert_offers(jsonb_build_array(
      jsonb_build_object(
        'fulfillment', 'affiliate',
        'merchant_id', v_merchant,
        'external_id', 'rpc-2',
        'product_url', 'https://example.invalid/urun2',
        'price_cents', 100,
        'market_code', 'TR',
        'boyle_bir_sutun_yok', 'deger'
      )
    ));
  exception when others then
    v_hata   := true;
    v_mesaj  := sqlerrm;
  end;

  if not v_hata then
    raise exception
      'TANINMAYAN SUTUN SESSIZCE YUTULDU: yanlis yazilmis bir alan adi hata '
      'vermeliydi, yoksa hic yazilmayan bir alan fark edilmez.';
  end if;

  -- Sebep DOGRU olmali: baska bir hata (ornegin not-null ihlali) da bu
  -- blogu tetikleyebilirdi ve test yanlis sebeple gecerdi.
  if v_mesaj not like '%OHAAAA_BILINMEYEN_SUTUN%' then
    raise exception
      'HATA BEKLENEN SEBEPTEN DEGIL: %', v_mesaj;
  end if;

  raise notice 'Toplu teklif yazma RPC: yazma/guncelleme/dogrulama gecti.';
end $$;

-- --------------------------------------------------------------------------
-- 4) anon ÇAĞIRAMAMALI  +  5) KENDİ SÜRE TAVANI
-- --------------------------------------------------------------------------
do $$
declare
  v_timeout text;
begin
  if has_function_privilege('anon', 'public.ingest_upsert_offers(jsonb)', 'execute') then
    raise exception
      'anon RPC''yi CAGIRABILIYOR: SECURITY DEFINER + uzun statement_timeout '
      'tasiyan bir fonksiyon disariya acik birakilamaz.';
  end if;

  if has_function_privilege('authenticated', 'public.ingest_upsert_offers(jsonb)', 'execute') then
    raise exception 'authenticated RPC''yi cagirabiliyor -- ayni gerekce.';
  end if;

  select cfg into v_timeout
    from (select unnest(proconfig) as cfg from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'ingest_upsert_offers') t
   where cfg like 'statement_timeout=%';

  if v_timeout is null then
    raise exception
      'FONKSIYON KENDI SURE TAVANINI TASIMIYOR: rol ayarina (8 sn) duser ve '
      'bu gocun tek sebebi ortadan kalkar.';
  end if;

  -- `search_path` de sabit olmali: SECURITY DEFINER bir fonksiyonda
  -- sabitlenmemis search_path, yetki yukseltme yoludur.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         unnest(p.proconfig) cfg
     where n.nspname = 'public' and p.proname = 'ingest_upsert_offers'
       and cfg like 'search\_path=%'
  ) then
    raise exception 'SECURITY DEFINER fonksiyonda search_path sabitlenmemis';
  end if;

  raise notice 'Toplu teklif yazma RPC: yetki ve sure tavani gecti (%).', v_timeout;
end $$;

-- --------------------------------------------------------------------------
-- 6) ÇAKIŞMA İNDEKSİ KISMİ OLMAMALI
-- --------------------------------------------------------------------------
-- `on conflict (merchant_id, external_id)` yalnizca TAM bir benzersiz
-- indeksle eslesir. Kismi bir indeks, uygulamanin yazma yolunu SESSIZCE
-- calismaz hale getirir -- ve bu fark uretim ile depo arasinda gercekten
-- vardi: replay'de kismi, uretimde tamdi. Upsert yolu temiz bir replay'de
-- hic kosturulmadigi icin yillarca fark edilmemisti.
do $$
begin
  if not exists (
    select 1 from pg_index i
     where i.indrelid = 'public.products'::regclass
       and i.indisunique
       and i.indpred is null                      -- KISMI DEGIL
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(i.indkey) k
              join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k)
           = array['external_id','merchant_id']
  ) then
    raise exception
      'CAKISMA INDEKSI KISMI YA DA YOK: on conflict (merchant_id, '
      'external_id) eslesmez ve butun teklif yazma yolu calismaz hale gelir.';
  end if;

  raise notice 'Toplu teklif yazma RPC: cakisma indeksi tam (kismi degil).';
end $$;

rollback;
