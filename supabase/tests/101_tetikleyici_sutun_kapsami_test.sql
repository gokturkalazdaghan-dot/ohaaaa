-- ============================================================================
-- TETİKLEYİCİ SÜTUN KAPSAMI — hem ÇALIŞMADIĞINI hem ÇALIŞTIĞINI kanıtla
-- ----------------------------------------------------------------------------
-- BU DOSYA ÖLÇÜLEN BİR ÜRETİM ARIZASINDAN DOĞDU.
--
-- Alım turu, teklifleri yazdıktan sonra "gördük" damgasını basarken
-- düşüyordu: `canceling statement due to statement timeout`. Sebep,
-- `products_sync_group_stats` tetikleyicisinin HER güncellemede çalışmasıydı
-- -- yalnızca dört zaman damgası yazan bir UPDATE'te bile. Ölçüldü:
-- `refresh_product_group_stats` çağrı başına 7,90 ms ve tam katalog için
-- ~283 saniye; üretilen sonuç ise her seferinde AYNI değerler.
--
-- Düzeltme tetikleyiciyi sütuna kapsamak. Ama dar kapsama, sessizce yanlış
-- çalışan bir sisteme giden en kısa yoldur: unutulan bir sütun BAYAT bir
-- toplam demektir ve bayatlık kendini göstermez -- sayfa yanlış fiyatı
-- hatasızca çizer.
--
-- Bu yüzden iki yön de kanıtlanıyor:
--   1) zaman damgası yazmak toplamı YENİDEN HESAPLAMAMALI
--   2) fiyat değiştirmek toplamı YENİDEN HESAPLAMALI
--
-- Tek başına (1), "tetikleyiciyi tamamen kaldır" ile de geçerdi. (2) onu
-- yakalar. Bir koruma, neyi engellediği kadar neyi ENGELLEMEDİĞİ ile de
-- tanımlıdır.
--
-- ÖLÇÜM HİLESİ: tetikleyicinin çalışıp çalışmadığı doğrudan görülemez,
-- çünkü doğru çalıştığında sonuç zaten aynıdır. Bu yüzden `offer_count`
-- BİLEREK yanlış bir değere çekiliyor. Tetikleyici çalışırsa yanlış değer
-- düzelir; çalışmazsa olduğu gibi kalır. Yani "düzeldi mi" sorusu,
-- "tetikleyici koştu mu" sorusunun gözlemlenebilir hâli.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

do $$
declare
  v_merchant uuid;
  v_group    uuid;
  v_product  uuid;
  v_sayac    integer;
begin
  -- --------------------------------------------------------------------
  -- Test verisi. Canlı satırlara DAYANMIYOR: bu dosya seed'den bağımsız
  -- koşmalı ve kendi verisini kurmalı.
  -- --------------------------------------------------------------------
  -- MAĞAZA BİLEREK `active` DEĞİL.
  --
  -- `merchants_active_needs_template` ve `merchants_active_needs_verified_terms`
  -- kısıtları, şablonu ya da doğrulanmış şartı olmayan bir mağazanın aktif
  -- olmasını engelliyor. Bu kısıtlar doğru ve testin onları aşmaya hakkı yok:
  -- test verisi uğruna bir üretim korumasını gevşetmek, korumayı testin
  -- kendisiyle delmek olurdu.
  --
  -- Zaten gerekmiyor: `refresh_product_group_stats` MAĞAZANIN değil
  -- TEKLİFİN durumuna (`products.status = 'active'`) bakıyor.
  insert into public.merchants (slug, display_name, network)
  values ('tetikleyici-testi', 'Tetikleyici Testi', 'direct')
  returning id into v_merchant;

  insert into public.product_groups (slug, title)
  values ('tetikleyici-testi-grup', 'Tetikleyici Testi Ürünü')
  returning id into v_group;

  insert into public.products
    (merchant_id, external_id, group_id, title, product_url,
     price_cents, shipping_fee_cents, currency, stock, status, market_code,
     fulfillment)
  values
    -- `fulfillment = 'affiliate'` ZORUNLU: `products_ownership_exclusive`
    -- kisiti bir teklifin ya mağazaya (affiliate) ya satıcıya (marketplace)
    -- ait olmasını şart koşuyor; ikisi birden ya da hiçbiri olamaz.
    (v_merchant, 'tetikleyici-1', v_group, 'Tetikleyici Testi Ürünü',
     'https://example.invalid/urun', 10000, 0, 'TRY', 5, 'active', 'TR',
     'affiliate')
  returning id into v_product;

  -- INSERT tetikleyiciyi çalıştırmış olmalı: bu, aşağıdaki iddiaların
  -- anlamlı olması için gereken başlangıç durumu.
  select offer_count into v_sayac from public.product_groups where id = v_group;
  if v_sayac is distinct from 1 then
    raise exception
      'BASLANGIC BOZUK: INSERT sonrasi offer_count 1 olmaliydi, % bulundu', v_sayac;
  end if;

  -- --------------------------------------------------------------------
  -- 1) ZAMAN DAMGASI YAZMAK TOPLAMI YENİDEN HESAPLAMAMALI
  -- --------------------------------------------------------------------
  -- Sayacı bilerek boz. Tetikleyici çalışırsa düzelir.
  update public.product_groups set offer_count = 999 where id = v_group;

  update public.products
     set last_seen_at      = now(),
         price_checked_at  = now(),
         stock_checked_at  = now(),
         offer_checked_at  = now()
   where id = v_product;

  select offer_count into v_sayac from public.product_groups where id = v_group;
  if v_sayac is distinct from 999 then
    raise exception
      'TETIKLEYICI ZAMAN DAMGASINDA CALISTI: offer_count 999 kalmaliydi, % bulundu. '
      'Sutun kapsami genis -- alim turu yine zaman asimina ugrayacak.', v_sayac;
  end if;

  -- --------------------------------------------------------------------
  -- 2) FİYAT DEĞİŞTİRMEK TOPLAMI YENİDEN HESAPLAMALI
  -- --------------------------------------------------------------------
  -- Sayaç hâlâ bozuk (999). Fiyat değişince tetikleyici koşmalı ve gerçek
  -- değeri (1) geri yazmalı. Bu iddia olmasaydı, tetikleyiciyi tamamen
  -- silmek de testi geçerdi.
  update public.products set price_cents = 12345 where id = v_product;

  select offer_count into v_sayac from public.product_groups where id = v_group;
  if v_sayac is distinct from 1 then
    raise exception
      'TETIKLEYICI FIYAT DEGISINCE CALISMADI: offer_count 1 olmaliydi, % bulundu. '
      'Sutun kapsami DAR -- grup toplamlari bayat kalir ve bayatlik kendini gostermez.',
      v_sayac;
  end if;

  -- --------------------------------------------------------------------
  -- 3) STOK SIFIRLANINCA DA YENİDEN HESAPLANMALI
  -- --------------------------------------------------------------------
  -- `stock` toplamın filtresinde (`p.stock > 0`). Listeden düşerse stoksuz
  -- bir teklif hâlâ "1 teklif var" diye görünürdü.
  update public.products set stock = 0 where id = v_product;

  select offer_count into v_sayac from public.product_groups where id = v_group;
  if v_sayac is distinct from 0 then
    raise exception
      'STOK DEGISIMI TOPLAMA YANSIMADI: offer_count 0 olmaliydi, % bulundu.', v_sayac;
  end if;

  raise notice 'Tetikleyici sutun kapsami: 3/3 iddia gecti.';
end $$;

-- ----------------------------------------------------------------------------
-- Kapsamın kendisi de sabitleniyor: liste ileride sessizce kısalırsa
-- yukarıdaki davranış testleri bunu yakalar, ama sebebi burada okunur olur.
-- ----------------------------------------------------------------------------
do $$
declare
  v_stats int;
  v_risk  int;
begin
  select cardinality(tgattr) into v_stats
    from pg_trigger
   where tgname = 'products_sync_group_stats'
     and tgrelid = 'public.products'::regclass;

  select cardinality(tgattr) into v_risk
    from pg_trigger
   where tgname = 'products_risk_gate'
     and tgrelid = 'public.products'::regclass;

  if v_stats <> 8 then
    raise exception 'products_sync_group_stats 8 sutuna kapsanmali, % bulundu', v_stats;
  end if;
  if v_risk <> 5 then
    raise exception 'products_risk_gate 5 sutuna kapsanmali, % bulundu', v_risk;
  end if;
end $$;

rollback;
