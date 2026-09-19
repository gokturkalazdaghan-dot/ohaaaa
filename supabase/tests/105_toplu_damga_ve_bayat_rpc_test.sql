-- ============================================================================
-- GÖRÜLME DAMGASI VE BAYAT İŞARETLEME RPC'LERİ
-- ----------------------------------------------------------------------------
-- `markStale` alım zincirinin SON adımıydı ve tek bir toplu UPDATE olarak
-- 8 saniyelik tavana takılıyordu. `touchSeen` ise çalışıyordu ama 216 ayrı
-- HTTP turuyla -- o parçalama bir süre kararı değil, ADRES UZUNLUĞU kararıydı
-- (`.in(...)` GET adresine giriyor). RPC POST gövdesiyle çağrılır.
--
-- Bu iki fonksiyon veri KAYBETTİREBİLİR: biri yanlış satırları stoksuz
-- işaretlerse katalog yarıya iner, diğeri yanlış satırları damgalarsa
-- `markStale` gerçekten bayat olanları atlar. Testler bu yüzden "çalıştı mı"
-- değil, DOĞRU SATIRLARA dokunup dokunmadığını ölçüyor.
--
-- Altı iddia:
--   1) damga yalnızca VERİLEN kimlikleri günceller
--   2) damga BAŞKA kaynağın satırına dokunmaz
--   3) bayat işaretleme yalnızca GÖRÜLMEYENLERİ stoksuz yapar
--   4) bayat işaretleme zaten stoksuz olanı TEKRAR yazmaz
--   5) bayat işaretleme SİLMEZ
--   6) ikisi de anon tarafından çağrılamaz
-- ============================================================================
begin;

\set ON_ERROR_STOP on

do $$
declare
  v_merchant uuid;
  v_kaynak_a uuid;
  v_kaynak_b uuid;
  v_group    uuid;
  v_gorulen  uuid;
  v_bayat    uuid;
  v_yabanci  uuid;
  v_stoksuz  uuid;
  v_tur      timestamptz := now();
  v_sayi     integer;
  v_damga    timestamptz;
begin
  insert into public.merchants (slug, display_name, network)
  values ('damga-testi', 'Damga Testi', 'direct') returning id into v_merchant;

  insert into public.product_groups (slug, title)
  values ('damga-testi-grup', 'Damga Testi') returning id into v_group;

  insert into public.sources (merchant_id, slug, name, kind, endpoint_url,
                              field_mapping, market_code)
  values (v_merchant, 'damga-kaynak-a', 'A', 'feed_csv',
          'https://example.invalid/a.csv', '{}'::jsonb, 'TR')
  returning id into v_kaynak_a;

  insert into public.sources (merchant_id, slug, name, kind, endpoint_url,
                              field_mapping, market_code)
  values (v_merchant, 'damga-kaynak-b', 'B', 'feed_csv',
          'https://example.invalid/b.csv', '{}'::jsonb, 'TR')
  returning id into v_kaynak_b;

  -- Bu turda GÖRÜLEN, GÖRÜLMEYEN, BAŞKA KAYNAKTAN ve ZATEN STOKSUZ birer satır.
  insert into public.products (fulfillment, merchant_id, source_id, group_id,
        external_id, title, product_url, price_cents, shipping_fee_cents,
        currency, stock, status, market_code, last_seen_at)
  values
    ('affiliate', v_merchant, v_kaynak_a, v_group, 'gorulen', 'Gorulen',
     'https://example.invalid/1', 100, 0, 'TRY', 5, 'active', 'TR',
     v_tur - interval '1 day'),
    ('affiliate', v_merchant, v_kaynak_a, v_group, 'bayat', 'Bayat',
     'https://example.invalid/2', 100, 0, 'TRY', 5, 'active', 'TR',
     v_tur - interval '1 day'),
    ('affiliate', v_merchant, v_kaynak_b, v_group, 'yabanci', 'Yabanci',
     'https://example.invalid/3', 100, 0, 'TRY', 5, 'active', 'TR',
     v_tur - interval '1 day'),
    ('affiliate', v_merchant, v_kaynak_a, v_group, 'zaten-stoksuz', 'Stoksuz',
     'https://example.invalid/4', 100, 0, 'TRY', 0, 'out_of_stock', 'TR',
     v_tur - interval '1 day');

  select id into v_gorulen from public.products
   where source_id = v_kaynak_a and external_id = 'gorulen';
  select id into v_bayat from public.products
   where source_id = v_kaynak_a and external_id = 'bayat';
  select id into v_yabanci from public.products
   where source_id = v_kaynak_b and external_id = 'yabanci';
  select id into v_stoksuz from public.products
   where source_id = v_kaynak_a and external_id = 'zaten-stoksuz';

  -- --------------------------------------------------------------------
  -- 1) DAMGA YALNIZCA VERİLEN KİMLİKLERİ GÜNCELLER
  -- --------------------------------------------------------------------
  v_sayi := public.ingest_touch_seen(v_kaynak_a, array['gorulen'], v_tur);

  if v_sayi <> 1 then
    raise exception 'DAMGA SAYISI YANLIS: % (1 olmaliydi)', v_sayi;
  end if;

  select last_seen_at into v_damga from public.products where id = v_gorulen;
  if v_damga is distinct from v_tur then
    raise exception 'GORULEN SATIR DAMGALANMADI: %', v_damga;
  end if;

  select last_seen_at into v_damga from public.products where id = v_bayat;
  if v_damga = v_tur then
    raise exception
      'VERILMEYEN KIMLIK DE DAMGALANDI: bayat satir damgalandiysa markStale '
      'onu bir daha hic bayat saymaz ve katalog sonsuza dek taze gorunur.';
  end if;

  -- --------------------------------------------------------------------
  -- 2) BAŞKA KAYNAĞIN SATIRINA DOKUNMAZ
  -- --------------------------------------------------------------------
  -- Ayni `external_id` iki farkli kaynakta bulunabilir; kaynak suzgeci
  -- dusesse bir feed digerinin satirlarini damgalardi.
  v_sayi := public.ingest_touch_seen(v_kaynak_a, array['yabanci'], v_tur);

  if v_sayi <> 0 then
    raise exception
      'BASKA KAYNAGIN SATIRI DAMGALANDI: kaynak suzgeci calismiyor';
  end if;

  -- --------------------------------------------------------------------
  -- 3) BAYAT İŞARETLEME YALNIZCA GÖRÜLMEYENLERİ STOKSUZ YAPAR
  -- --------------------------------------------------------------------
  v_sayi := public.ingest_mark_stale_offers(v_kaynak_a, v_tur);

  if v_sayi <> 1 then
    raise exception
      'BAYAT SAYISI YANLIS: % (yalnizca "bayat" satiri, yani 1 olmaliydi)',
      v_sayi;
  end if;

  if (select status from public.products where id = v_bayat) <> 'out_of_stock' then
    raise exception 'BAYAT SATIR STOKSUZ YAPILMADI';
  end if;

  if (select stock from public.products where id = v_bayat) <> 0 then
    raise exception 'BAYAT SATIRIN STOGU SIFIRLANMADI';
  end if;

  -- Bu turda GORULEN satir DOKUNULMAMIS olmali. Aksi halde her tur butun
  -- katalogu stoksuz yapardi.
  if (select status from public.products where id = v_gorulen) <> 'active' then
    raise exception
      'GORULEN SATIR DA STOKSUZ YAPILDI: her tur katalogu bosaltirdi.';
  end if;

  -- Baska kaynagin satiri da dokunulmamis olmali.
  if (select status from public.products where id = v_yabanci) <> 'active' then
    raise exception 'BASKA KAYNAGIN SATIRI STOKSUZ YAPILDI';
  end if;

  -- --------------------------------------------------------------------
  -- 4) ZATEN STOKSUZ OLAN TEKRAR YAZILMAZ
  -- --------------------------------------------------------------------
  -- (3)'teki sayac 1 cikti; "zaten-stoksuz" satiri sayilsaydi 2 olurdu.
  -- Bosuna guncelleme, bosuna tetikleyici ve bosuna indeks yazmasi demek.

  -- --------------------------------------------------------------------
  -- 5) BAYAT İŞARETLEME SİLMEZ
  -- --------------------------------------------------------------------
  -- Silme geri alinamaz; stoksuz isaretleme bir sonraki basarili alimda
  -- kendiliginden duzelir.
  if (select count(*) from public.products where source_id = v_kaynak_a) <> 3 then
    raise exception
      'SATIR SILINDI: bayat isaretleme SILMEMELI, yalnizca stoksuz yapmali.';
  end if;

  raise notice 'Damga ve bayat RPC: 5/5 davranis iddiasi gecti.';
end $$;

-- --------------------------------------------------------------------------
-- 6) anon ÇAĞIRAMAMALI
-- --------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon',
       'public.ingest_touch_seen(uuid, text[], timestamptz)', 'execute')
     or has_function_privilege('anon',
       'public.ingest_mark_stale_offers(uuid, timestamptz)', 'execute') then
    raise exception
      'anon RPC''leri cagirabiliyor: SECURITY DEFINER + uzun statement_timeout '
      'tasiyan fonksiyonlar disariya acik birakilamaz.';
  end if;

  if has_function_privilege('authenticated',
       'public.ingest_mark_stale_offers(uuid, timestamptz)', 'execute') then
    raise exception 'authenticated bayat isaretlemeyi cagirabiliyor -- '
      'bir kullanici butun katalogu stoksuz yapabilirdi.';
  end if;

  raise notice 'Damga ve bayat RPC: yetki daraltmasi gecti.';
end $$;

rollback;
