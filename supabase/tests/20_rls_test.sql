-- ============================================================================
-- TEST · Row Level Security — yetki sızıntısı olmadığının kanıtı
-- ----------------------------------------------------------------------------
-- Her senaryo `authenticated` rolüne geçip JWT taklidi yaparak çalışır.
-- Politikalar yalnızca sahip olmayan roller için devrededir; bu yüzden
-- testlerde postgres (sahip) rolünden çıkmak ZORUNLUDUR.
-- ============================================================================
\set ON_ERROR_STOP on

begin;

-- Test verisi: her taşerona birer API anahtarı (sahip rolüyle eklenir).
insert into public.api_keys (id, vendor_id, name, key_prefix, key_hash, last_four)
values
  ('b0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a',
   'Teknomarkt Prod', 'ohk_live_tm000001', repeat('a', 64), 'aaaa'),
  ('b0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000b',
   'Moda Vitrin Prod', 'ohk_live_mv000001', repeat('b', 64), 'bbbb');

-- Taslak (yayınlanmamış) ürün: vitrinde ASLA görünmemeli.
insert into public.products
  (id, vendor_id, external_id, title, price_cents, stock, status)
values
  ('50000000-0000-4000-8000-0000000000ff', 'a0000000-0000-4000-8000-00000000000a',
   'TM-GIZLI-TASLAK', 'Henüz yayınlanmamış gizli ürün', 100000, 5, 'draft');

-- ---------------------------------------------------------------------------
-- 1) anon: yalnızca yayınlanmış katalog
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  if exists (select 1 from public.products where status = 'draft') then
    raise exception 'BAŞARISIZ: anon rolü taslak ürünleri görebiliyor';
  end if;

  -- api_keys ve orders tablolarında anon''a hiç GRANT verilmemiştir.
  -- Beklenen sonuç "boş liste" değil, doğrudan yetki reddidir — RLS''ten
  -- önce gelen ikinci bir savunma katmanı (defense in depth).
  begin
    perform 1 from public.api_keys limit 1;
    raise exception 'BAŞARISIZ: anon rolü API anahtarları tablosuna erişebiliyor';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.orders limit 1;
    raise exception 'BAŞARISIZ: anon rolü siparişler tablosuna erişebiliyor';
  exception
    when insufficient_privilege then null;
  end;

  if (select count(*) from public.products) <> 12 then
    raise exception 'BAŞARISIZ: anon 12 aktif ürün görmeliydi, % gördü',
      (select count(*) from public.products);
  end if;

  raise notice '✓ anon: yalnızca aktif katalog görünüyor; anahtar/sipariş erişimi reddedildi';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- 2) Taşeron izolasyonu: A taşeronu B'nin anahtarlarını göremez
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.api_keys) <> 1 then
    raise exception 'BAŞARISIZ: Teknomarkt yalnızca 1 anahtar görmeliydi, % gördü',
      (select count(*) from public.api_keys);
  end if;

  if exists (select 1 from public.api_keys
              where vendor_id = 'a0000000-0000-4000-8000-00000000000b') then
    raise exception 'BAŞARISIZ: taşeron başka taşeronun anahtarını görebiliyor';
  end if;

  -- Kendi taslak ürününü görebilmeli.
  if not exists (select 1 from public.products where external_id = 'TM-GIZLI-TASLAK') then
    raise exception 'BAŞARISIZ: taşeron kendi taslak ürününü göremiyor';
  end if;

  raise notice '✓ taşeron izolasyonu: yalnızca kendi anahtarları ve kendi taslakları';
end
$$;

-- ---------------------------------------------------------------------------
-- 3) Taşeron kendi komisyon oranını veya durumunu değiştiremez
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update public.vendors
       set commission_rate = 0.0001
     where id = 'a0000000-0000-4000-8000-00000000000a';
    raise exception 'BAŞARISIZ: taşeron kendi komisyon oranını düşürebildi';
  exception
    when insufficient_privilege then null;   -- RLS WITH CHECK engelledi
  end;

  begin
    update public.vendors
       set status = 'approved'
     where id = 'a0000000-0000-4000-8000-00000000000b';   -- başkasının kaydı
    if found then
      raise exception 'BAŞARISIZ: taşeron başka taşeronun kaydını güncelleyebildi';
    end if;
  exception
    when insufficient_privilege then null;
  end;

  raise notice '✓ ayrıcalık yükseltme: komisyon/durum değişikliği engellendi';
end
$$;

-- ---------------------------------------------------------------------------
-- 4) Kullanıcı kendi rolünü admin'e yükseltemez
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update public.users set role = 'admin'
     where id = '22222222-2222-4222-8222-222222222222';
    raise exception 'BAŞARISIZ: kullanıcı kendini admin yapabildi';
  exception
    when insufficient_privilege then null;
  end;

  raise notice '✓ rol yükseltme engellendi';
end
$$;

-- ---------------------------------------------------------------------------
-- 5) API anahtarının hash''i panelde sızmamalı (api_keys_safe görünümü)
-- ---------------------------------------------------------------------------
do $$
declare
  v_cols text[];
begin
  select array_agg(column_name::text) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'api_keys_safe';

  if 'key_hash' = any(v_cols) then
    raise exception 'BAŞARISIZ: api_keys_safe görünümü key_hash sızdırıyor';
  end if;

  if (select count(*) from public.api_keys_safe) <> 1 then
    raise exception 'BAŞARISIZ: api_keys_safe RLS''i uygulamıyor (security_invoker)';
  end if;

  raise notice '✓ api_keys_safe: hash sızdırmıyor ve RLS uyguluyor';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- 6) Sipariş gizliliği: müşteri A, müşteri B'nin siparişini göremez;
--    taşeron yalnızca kendisine düşen kalemleri görür.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

do $$
declare
  v_order public.orders;
begin
  -- Müşteri iki taşerondan alışveriş yapar.
  v_order := public.create_order(
    '[{"product_id":"50000000-0000-4000-8000-000000000004","quantity":1},
      {"product_id":"50000000-0000-4000-8000-00000000000a","quantity":1}]'::jsonb,
    'musteri@ornek.com', '{}'::jsonb);

  perform set_config('ohaaaa.test_order_id', v_order.id::text, true);
end
$$;

-- Teknomarkt olarak bak: siparişi görebilmeli ama SADECE kendi kalemini.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  v_order_id uuid := current_setting('ohaaaa.test_order_id')::uuid;
begin
  if not exists (select 1 from public.orders where id = v_order_id) then
    raise exception 'BAŞARISIZ: taşeron kendisine düşen siparişi göremiyor';
  end if;

  if (select count(*) from public.order_items where order_id = v_order_id) <> 1 then
    raise exception 'BAŞARISIZ: taşeron diğer taşeronun kalemlerini de görüyor (%)',
      (select count(*) from public.order_items where order_id = v_order_id);
  end if;

  if (select count(*) from public.vendor_orders where order_id = v_order_id) <> 1 then
    raise exception 'BAŞARISIZ: taşeron diğer taşeronun alt siparişini görüyor';
  end if;

  raise notice '✓ sipariş gizliliği: taşeron yalnızca kendi kalemlerini görüyor';
end
$$;

-- Alakasız üçüncü taşeron hiçbir şey görmemeli.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

do $$
declare
  v_order_id uuid := current_setting('ohaaaa.test_order_id')::uuid;
begin
  if exists (select 1 from public.orders where id = v_order_id) then
    raise exception 'BAŞARISIZ: alakasız taşeron siparişi görebiliyor';
  end if;

  if exists (select 1 from public.order_items where order_id = v_order_id) then
    raise exception 'BAŞARISIZ: alakasız taşeron sipariş kalemlerini görebiliyor';
  end if;

  raise notice '✓ sipariş gizliliği: alakasız taşerona hiçbir şey sızmıyor';
end
$$;

-- ---------------------------------------------------------------------------
-- 7) vendor_dashboard_stats başkasının verisini döndürmemeli
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform public.vendor_dashboard_stats('a0000000-0000-4000-8000-00000000000a');
    raise exception 'BAŞARISIZ: taşeron başka taşeronun panel verisini okuyabildi';
  exception
    when insufficient_privilege then null;   -- beklenen
  end;

  raise notice '✓ panel analitiği: sahiplik doğrulaması çalışıyor';
end
$$;

reset role;
rollback;
