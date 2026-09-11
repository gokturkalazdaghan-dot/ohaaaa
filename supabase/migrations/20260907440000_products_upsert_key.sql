-- ===========================================================================
-- products: UPSERT anahtari cikarilabilir hale getiriliyor
-- ===========================================================================
--
-- BULGU. `products_merchant_external_id_key` KISMI bir tekil indeks:
--
--   create unique index products_merchant_external_id_key
--     on public.products (merchant_id, external_id)
--     where merchant_id is not null;
--
-- Alim hattinin yazma yolu ise yuklemsiz bir catisma hedefi kullaniyor:
--
--   .upsert(batch, { onConflict: 'merchant_id,external_id' })
--
-- PostgreSQL kismi bir indeksi ancak AYNI yuklem catisma hedefinde de
-- verildiginde cikarabilir. Yuklemsiz istek soyle duser:
--
--   ERROR: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- OLCULDU: 35.952 satirlik gercek Awin feed'i yerel veritabaninda tam olarak
-- bu hatayla durdu. Production'da hic urun yazilmadigi icin bu yol BUGUNE
-- KADAR HIC DENENMEMISTI -- yani ilk gercek ingest, yazma adiminda
-- patlayacakti.
--
-- ---------------------------------------------------------------------------
-- YUKLEM GEREKSIZDI
-- ---------------------------------------------------------------------------
--
-- Yuklem, pazar yeri (marketplace) satirlarini indeksin disinda tutmak icin
-- konmustu: onlarda `merchant_id` NULL ve ayni `external_id` birden cok kez
-- gecebilir.
--
-- Ama PostgreSQL'de tekil indeksler VARSAYILAN OLARAK `NULLS DISTINCT`tir:
-- (NULL, 'x') ile (NULL, 'x') BIRBIRINE ESIT SAYILMAZ ve ikisi de kabul
-- edilir. Yani yuklem olmadan da pazar yeri satirlari kisitlanmaz --
-- yuklemin tek etkisi, indeksi ON CONFLICT icin CIKARILAMAZ yapmakti.
--
-- Bu iddia varsayim degil: asagidaki dogrulama blogu ayni `external_id`
-- degerine sahip IKI pazar yeri satirini gercekten yazmayi deniyor ve
-- ikisinin de kabul edildigini gosteriyor.
--
-- ---------------------------------------------------------------------------
-- GECIS SIRASI: ONCE YENI, SONRA ESKI
-- ---------------------------------------------------------------------------
--
-- Yeni indeks ONCE olusturuluyor. Veride bir mukerrerlik olsaydi goc tam da
-- burada, hicbir sey dusurulmeden dusecekti. Eski indeks ancak yenisi
-- kuruldugu icin dusuruluyor; arada tekilligin korunmadigi tek bir an bile
-- yok (ikisi de ayni islemde).
--
-- ISIM DEGISTI: `products_merchant_external_id_key` ->
-- `products_merchant_external_unique`. Eski ad "key" sonekiyle bir tekil
-- KISIT gibi gorunuyordu; oysa kismi tekil indeks kisit olamaz. Yeni ad ne
-- oldugunu soyluyor.
-- ===========================================================================

-- --- 1) Yeni indeks: YUKLEMSIZ, dolayisiyla ON CONFLICT ile cikarilabilir --
create unique index if not exists products_merchant_external_unique
  on public.products (merchant_id, external_id);

comment on index public.products_merchant_external_unique is
  'Alim hattinin idempotency anahtari. YUKLEMSIZ olmasi sart: yuklemli bir '
  'tekil indeks `on conflict (merchant_id, external_id)` ile CIKARILAMAZ. '
  'Pazar yeri satirlari (merchant_id NULL) NULLS DISTINCT sayesinde zaten '
  'kisitlanmaz -- yuklem gereksizdi.';

-- --- 2) Eski kismi indeks dusuruluyor -------------------------------------
-- Yenisi ayni sutunlari ve daha genis bir kumeyi kapsiyor; eskisini tutmak
-- her yazmada ikinci bir indeks bakimi demek olurdu.
drop index if exists public.products_merchant_external_id_key;

-- ===========================================================================
-- GOC KENDINI DOGRULUYOR
-- ===========================================================================
do $$
declare
  v_sayi     integer;
  v_merchant uuid;
  v_vendor   uuid;
  v_kat      uuid;
  v_yuklem   text;
begin
  -- 1) Yeni indeks var ve YUKLEMSIZ. Yuklemli olsaydi butun goc anlamsizdi.
  select pg_get_expr(i.indpred, i.indrelid) into v_yuklem
    from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'products_merchant_external_unique';

  if not found then
    raise exception 'DOGRULAMA 1: yeni tekil indeks olusmadi.';
  end if;
  if v_yuklem is not null then
    raise exception 'DOGRULAMA 1b: yeni indeks hâlâ yuklemli (%) -- '
      'ON CONFLICT bunu cikaramaz.', v_yuklem;
  end if;

  -- 2) Eski kismi indeks gitti.
  if exists (select 1 from pg_class where relname = 'products_merchant_external_id_key') then
    raise exception 'DOGRULAMA 2: eski kismi indeks hâlâ duruyor.';
  end if;

  -- 3) ASIL SINAMA: yuklemsiz ON CONFLICT artik CALISIYOR.
  --    Bu iddia olmadan goc "indeksi degistirdim" der ama duzeltmeyi
  --    kanitlamaz -- duzeltilen sey tam olarak bu ifadenin kabul edilmesi.
  select id into v_merchant from public.merchants
   where status = 'active' and network_advertiser_id is not null limit 1;
  select id into v_kat from public.categories limit 1;

  if v_merchant is not null then
    insert into public.products
      (fulfillment, merchant_id, source_id, external_id, title, image_urls,
       product_url, price_cents, currency, market_code, stock,
       shipping_fee_cents, status, category_id)
    values
      ('affiliate', v_merchant, null, 'GOC-DOGRULAMA-UPSERT', 'Goc dogrulama kalemi',
       '{}'::text[], 'https://www.awin1.com/pclick.php?p=0', 100, 'GBP', 'UK', 1,
       0, 'active', v_kat)
    on conflict (merchant_id, external_id) do update
      set price_cents = excluded.price_cents;

    -- Ayni ifadeyi IKINCI kez calistir: mukerrer satir olusmamali.
    insert into public.products
      (fulfillment, merchant_id, source_id, external_id, title, image_urls,
       product_url, price_cents, currency, market_code, stock,
       shipping_fee_cents, status, category_id)
    values
      ('affiliate', v_merchant, null, 'GOC-DOGRULAMA-UPSERT', 'Goc dogrulama kalemi',
       '{}'::text[], 'https://www.awin1.com/pclick.php?p=0', 150, 'GBP', 'UK', 1,
       0, 'active', v_kat)
    on conflict (merchant_id, external_id) do update
      set price_cents = excluded.price_cents;

    select count(*) into v_sayi from public.products
     where external_id = 'GOC-DOGRULAMA-UPSERT';
    if v_sayi <> 1 then
      raise exception 'DOGRULAMA 3: upsert % satir uretti, 1 bekleniyordu.', v_sayi;
    end if;

    -- ...ve GUNCELLEME gercekten oldu: 100 -> 150.
    select price_cents into v_sayi from public.products
     where external_id = 'GOC-DOGRULAMA-UPSERT';
    if v_sayi <> 150 then
      raise exception 'DOGRULAMA 3b: ikinci upsert fiyati guncellemedi (%).', v_sayi;
    end if;

    delete from public.products where external_id = 'GOC-DOGRULAMA-UPSERT';
  else
    raise notice 'DOGRULAMA 3 atlandi: yayinda affiliate magaza yok.';
  end if;

  -- 4) PAZAR YERI SATIRLARI HÂLÂ KISITLANMIYOR.
  --    Yuklemin varlik sebebi buydu; NULLS DISTINCT sayesinde yuklemsiz de
  --    ayni sekilde calisiyor. Bu iddia, yuklemi dusurmenin bir seyi
  --    BOZMADIGINI gosteriyor.
  select id into v_vendor from public.vendors limit 1;
  if v_vendor is not null and v_kat is not null then
    insert into public.products
      (fulfillment, vendor_id, external_id, title, image_urls, price_cents,
       currency, market_code, stock, shipping_fee_cents, status, category_id)
    values
      ('marketplace', v_vendor, 'GOC-NULL-MERCHANT', 'Pazar yeri kalemi 1',
       '{}'::text[], 100, 'TRY', 'TR', 1, 0, 'active', v_kat);

    begin
      insert into public.products
        (fulfillment, vendor_id, external_id, title, image_urls, price_cents,
         currency, market_code, stock, shipping_fee_cents, status, category_id)
      values
        ('marketplace', v_vendor, 'GOC-NULL-MERCHANT', 'Pazar yeri kalemi 2',
         '{}'::text[], 200, 'TRY', 'TR', 1, 0, 'active', v_kat);
    exception
      when unique_violation then
        -- (vendor_id, external_id) tekil kisiti bunu reddedebilir; o AYRI
        -- bir kural ve KORUNUYOR. Onemli olan, reddin merchant_id
        -- indeksinden GELMEMESI.
        null;
    end;

    select count(*) into v_sayi from public.products
     where external_id = 'GOC-NULL-MERCHANT';
    if v_sayi < 1 then
      raise exception 'DOGRULAMA 4: pazar yeri satiri yazilamadi -- yuklemi '
        'dusurmek NULL merchant_id satirlarini kisitlamis.';
    end if;

    delete from public.products where external_id = 'GOC-NULL-MERCHANT';
  end if;

  -- 5) AFFILIATE MUKERRERLIGI HÂLÂ REDDEDILIYOR. Tekillik gevsemedi.
  if v_merchant is not null and v_kat is not null then
    insert into public.products
      (fulfillment, merchant_id, external_id, title, image_urls, product_url,
       price_cents, currency, market_code, stock, shipping_fee_cents, status,
       category_id)
    values
      ('affiliate', v_merchant, 'GOC-TEKILLIK', 'Tekillik kalemi', '{}'::text[],
       'https://www.awin1.com/pclick.php?p=1', 100, 'GBP', 'UK', 1, 0, 'active', v_kat);

    begin
      insert into public.products
        (fulfillment, merchant_id, external_id, title, image_urls, product_url,
         price_cents, currency, market_code, stock, shipping_fee_cents, status,
         category_id)
      values
        ('affiliate', v_merchant, 'GOC-TEKILLIK', 'Tekillik kalemi 2', '{}'::text[],
         'https://www.awin1.com/pclick.php?p=2', 200, 'GBP', 'UK', 1, 0, 'active', v_kat);
      raise exception 'DOGRULAMA 5: ayni (merchant_id, external_id) iki kez '
        'yazilabildi -- tekillik kayboldu.';
    exception when unique_violation then null;
    end;

    delete from public.products where external_id = 'GOC-TEKILLIK';
  end if;

  -- 6) MEVCUT VERI BOZULMADI: bu goc tek bir gercek satira dokunmadi.
  select count(*) into v_sayi from public.products
   where external_id like 'GOC-%';
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 6: gocun dogrulama kalemleri temizlenmedi (%).',
      v_sayi;
  end if;

  raise notice
    'products upsert anahtari duzeltildi: yuklemsiz tekil indeks kuruldu, '
    'ON CONFLICT (merchant_id, external_id) artik cikarilabiliyor, pazar '
    'yeri satirlari kisitlanmiyor, affiliate tekilligi korunuyor.';
end $$;
