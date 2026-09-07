-- ===========================================================================
-- Siparis PARA BIRIMI: karisik sepet reddediliyor, gercek para birimi yaziliyor
-- ===========================================================================
--
-- `orders.currency` sutunu vardi, varsayilani 'TRY' idi ve `create_order` onu
-- HIC YAZMIYORDU. Yani katalog cok para birimli hâle geldiginde:
--
--   * her siparis, icindeki urunler ne olursa olsun TRY olarak kaydedilecekti;
--   * `grand_total_cents` iki para birimini ciplak toplayacakti -- 199 USD'lik
--     bir urun 19900 "kurus" sayilir ve musteriden ~199 TL tahsil edilirdi.
--
-- Bu, bu depoda kovaladigimiz hata sinifinin EN PAHALI hâli. Digerlerinde
-- yanlis olan GOSTERILEN fiyatti; burada yanlis olan TAHSIL EDILEN tutar ve
-- muhasebeye gecen kayit.
--
-- ---------------------------------------------------------------------------
-- KARISIK SEPET NEDEN CEVRILMIYOR DA REDDEDILIYOR
-- ---------------------------------------------------------------------------
--
-- Bir siparisin TEK bir `grand_total_cents` ve TEK bir `currency` alani var;
-- iki para birimini tek tutarda tahsil etmenin yolu yok. Geriye iki secenek
-- kaliyor: cevir ya da reddet.
--
-- CEVIRMEK BUGUN MUMKUN DEGIL: `fx_rates` bos ve kaynaksiz kur uydurmak yasak
-- (20260907310000 kuru kaynagi zorunlu tutuyor). Kaynak gelse bile, hangi kurla
-- tahsil edildigi siparise yazilmadan yapilan bir cevirim DENETLENEMEZ --
-- musteri itiraz ettiginde hangi kuru uyguladigimizi gosteremeyiz.
--
-- Reddetmek ise kullaniciya "bu iki urunu ayri siparislerde alin" demek: can
-- sikici ama DOGRU. Hata `OHAAAA_` onekli, yani checkout rotasi onu kullaniciya
-- gosterilebilir bir is kurali olarak taniyor.
--
-- ---------------------------------------------------------------------------
-- UC KATMAN, CUNKU ISLEV TEK BASINA YETMEZ
-- ---------------------------------------------------------------------------
--
--   1. `create_order` karisik sepeti reddeder ve para birimini yazar.
--   2. `order_items` uzerindeki tetikleyici, urunun para birimi siparisinkiyle
--      uyusmayan HER satiri ANINDA reddeder -- islev degistiginde ya da baska
--      bir yazici geldiginde de kural ayakta kalir.
--   3. `orders.currency` artik `currencies` tablosuna yabanci anahtar:
--      var olmayan bir kod kaydedilemez. Onceden serbest metindi.
--
-- Tek katman birakmak, kuralin gecerliligini bir islevin dogru yazilmis
-- olmasina baglamak olurdu.
-- ===========================================================================

-- --- 1) orders.currency artik gercek bir para birimi olmali ----------------
alter table public.orders
  drop constraint if exists orders_currency_fkey;
alter table public.orders
  add constraint orders_currency_fkey
  foreign key (currency) references public.currencies(code);

-- --- 2) create_order: karisik sepet reddedilir, para birimi yazilir --------
-- `create or replace`: imza ve donus tipi ayni, yani ACL ve SECURITY DEFINER
-- korunuyor. DROP edilseydi grant'lar dusecek ve siparis olusturma
-- `authenticated` icin kirilacakti.
create or replace function public.create_order(
  p_items jsonb, p_email text, p_shipping_address jsonb, p_notes text default null
)
returns public.orders
language plpgsql
security definer
set search_path to 'public'
as $function$

declare
  v_order            public.orders;
  v_item             jsonb;
  v_product          public.products;
  v_vendor           public.vendors;
  v_vendor_order_id  uuid;
  v_quantity         integer;
  v_line_total       bigint;
  v_line_commission  bigint;
  v_vendor_ids       uuid[] := '{}';
  /*
   * SIPARISIN PARA BIRIMI, URUNLERDEN OKUNUR.
   *
   * `orders.currency` sutununun varsayilani 'TRY' ve bu islev onu HIC
   * yazmiyordu: katalog cok para birimli hâle geldiginde her siparis, icindeki
   * urunler ne olursa olsun TRY olarak kaydedilecekti. Tutar da ayni sekilde
   * ciplak toplaniyordu -- 199 USD'lik bir urun 19900 "kurus" sayilirdi.
   *
   * Bu, hatanin EN PAHALI hâli: gosterilen fiyat degil, TAHSIL EDILEN tutar.
   */
  v_currency         char(3) := null;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'OHAAAA_EMPTY_CART: sepet boş olamaz' using errcode = 'check_violation';
  end if;

  if jsonb_array_length(p_items) > 100 then
    raise exception 'OHAAAA_CART_TOO_LARGE: sepette en fazla 100 farklı ürün olabilir'
      using errcode = 'check_violation';
  end if;

  insert into public.orders (user_id, email, shipping_address, notes, status)
  values (auth.uid(), lower(p_email), coalesce(p_shipping_address, '{}'::jsonb),
          p_notes, 'pending_payment')
  returning * into v_order;

  -- ---- Kalemleri gez, taşeron bazında grupla --------------------------------
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := coalesce((v_item ->> 'quantity')::integer, 0);

    if v_quantity <= 0 or v_quantity > 999 then
      raise exception 'OHAAAA_INVALID_QUANTITY: adet 1-999 aralığında olmalı'
        using errcode = 'check_violation';
    end if;

    -- FOR UPDATE: eşzamanlı siparişlerde stok yarışını (race) engeller.
    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid
    for update;

    if not found then
      raise exception 'OHAAAA_PRODUCT_NOT_FOUND: ürün bulunamadı (%)',
        v_item ->> 'product_id' using errcode = 'no_data_found';
    end if;

    -- Satılabilirlik kuralları tek yerde (bkz. assert_orderable).
    perform public.assert_orderable(v_product);

    /*
     * TEK SIPARIS, TEK PARA BIRIMI.
     *
     * Bir siparisin tek bir `grand_total_cents` ve tek bir `currency` alani
     * var; iki para birimini tek tutarda TAHSIL ETMENIN yolu yok. Karisik
     * sepeti burada REDDETMEK, onu sessizce toplamaktan iyidir -- toplamak
     * kullanicidan yanlis tutari almak demek.
     *
     * Kur cevirisi YAPILMIYOR: `fx_rates` bos ve kaynaksiz kur uydurmak
     * yasak. Cevrilseydi bile, hangi kurla tahsil edildigi siparise
     * yazilmadan yapilan bir cevirim denetlenemez.
     */
    if v_currency is null then
      v_currency := v_product.currency;
      /*
       * SIPARISIN PARA BIRIMI, ILK KALEM EKLENMEDEN ONCE yaziliyor.
       *
       * Alternatifi, para birimini en sondaki toplam guncellemesinde yazmakti;
       * o durumda `order_items` tetikleyicisinin ERTELENMIS olmasi gerekirdi --
       * cunku kalemler eklenirken siparisin para birimi henuz varsayilan
       * degerinde olurdu. Ertelenmis kisit ise ancak COMMIT aninda patlar:
       * hata mesaji hangi kalemin bozuk oldugunu gostermez ve kural islemi
       * yaziya dokmeye calisirken, en gec anda devreye girer.
       *
       * Sirayi degistirmek tetikleyiciyi ANINDA (immediate) yapabilmemizi
       * sagliyor: bozuk kalem, ekledigi ifadenin kendisinde reddediliyor.
       */
      update public.orders set currency = v_currency where id = v_order.id;
    elsif v_product.currency is distinct from v_currency then
      raise exception
        'OHAAAA_MIXED_CURRENCY: sepette birden fazla para birimi var (% ve %); '
        'tek siparis tek para biriminde olusturulur',
        v_currency, v_product.currency using errcode = 'check_violation';
    end if;

    select * into v_vendor from public.vendors where id = v_product.vendor_id;

    if v_vendor.status <> 'approved' then
      raise exception 'OHAAAA_VENDOR_UNAVAILABLE: taşeron aktif değil (%)', v_vendor.display_name
        using errcode = 'check_violation';
    end if;

    -- Bu taşeron için alt sipariş (vendor_order) yoksa aç — split-cart burada olur.
    select id into v_vendor_order_id
    from public.vendor_orders
    where order_id = v_order.id and vendor_id = v_product.vendor_id;

    if v_vendor_order_id is null then
      insert into public.vendor_orders (order_id, vendor_id, commission_rate)
      values (v_order.id, v_product.vendor_id, v_vendor.commission_rate)
      returning id into v_vendor_order_id;

      v_vendor_ids := array_append(v_vendor_ids, v_product.vendor_id);
    end if;

    v_line_total      := v_product.price_cents * v_quantity;
    -- Komisyon kuruş bazında aşağı yuvarlanır; platform lehine yuvarlama yapılmaz.
    v_line_commission := floor(v_line_total * v_vendor.commission_rate)::bigint;

    insert into public.order_items (
      order_id, vendor_order_id, vendor_id, product_id,
      title_snapshot, image_url_snapshot, sku_snapshot,
      unit_price_cents, quantity, line_total_cents, commission_cents
    )
    values (
      v_order.id, v_vendor_order_id, v_product.vendor_id, v_product.id,
      v_product.title, v_product.image_urls[1], v_product.sku,
      v_product.price_cents, v_quantity, v_line_total, v_line_commission
    );
  end loop;

  -- ---- Alt sipariş toplamlarını hesapla -------------------------------------
  -- Kargo taşeron başına BİR KEZ alınır (aynı koliden gönderim varsayımı):
  --   taban ücret = o taşerondaki kalemlerin en yüksek kargo ücreti
  --   eşik        = kalemler arasındaki en DÜŞÜK ücretsiz kargo eşiği
  --                 (müşteri lehine; eşiği olmayan kalemler eşiği bozmaz)
  -- Ara toplam eşiği geçiyorsa kargo sıfırlanır.
  update public.vendor_orders vo
     set items_subtotal_cents = agg.subtotal,
         commission_cents     = agg.commission,
         shipping_cents       = case
                                  when agg.free_threshold is not null
                                   and agg.subtotal >= agg.free_threshold
                                  then 0
                                  else agg.shipping_base
                                end,
         payout_cents         = agg.subtotal
                                + case
                                    when agg.free_threshold is not null
                                     and agg.subtotal >= agg.free_threshold
                                    then 0
                                    else agg.shipping_base
                                  end
                                - agg.commission
  from (
    select
      oi.vendor_order_id,
      sum(oi.line_total_cents)::bigint             as subtotal,
      sum(oi.commission_cents)::bigint             as commission,
      coalesce(max(p.shipping_fee_cents), 0)::bigint as shipping_base,
      min(p.free_shipping_threshold_cents)::bigint  as free_threshold
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    where oi.order_id = v_order.id
    group by oi.vendor_order_id
  ) agg
  where vo.id = agg.vendor_order_id;

  -- ---- Ana sipariş toplamlarını hesapla -------------------------------------
  update public.orders o
     set items_subtotal_cents   = agg.subtotal,
         shipping_total_cents   = agg.shipping,
         commission_total_cents = agg.commission,
         grand_total_cents      = agg.subtotal + agg.shipping,
         -- Para birimi ilk kalemde yazildi; burada yalnizca TEYIT ediliyor.
         currency               = v_currency
  from (
    select
      sum(items_subtotal_cents)::bigint as subtotal,
      sum(shipping_cents)::bigint       as shipping,
      sum(commission_cents)::bigint     as commission
    from public.vendor_orders
    where order_id = v_order.id
  ) agg
  where o.id = v_order.id;

  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$function$;

-- --- 3) Tetikleyici: kalem, siparisin para biriminden sapamaz --------------
create or replace function public.tg_order_items_currency_matches()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_order_currency   char(3);
  v_product_currency char(3);
begin
  -- Urun silinmisse (product_id null) karsilastirilacak bir sey yok; kalemin
  -- fiyat anlik goruntusu zaten siparisin para biriminde kaydedilmisti.
  if new.product_id is null then
    return new;
  end if;

  select currency into v_order_currency from public.orders where id = new.order_id;
  select currency into v_product_currency from public.products where id = new.product_id;

  if v_order_currency is not null
     and v_product_currency is not null
     and v_product_currency <> v_order_currency then
    raise exception
      'OHAAAA_MIXED_CURRENCY: kalem para birimi (%) siparisinkiyle (%) uyusmuyor',
      v_product_currency, v_order_currency using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

/*
 * ANINDA calisir, ertelenmis degil. `create_order` siparisin para birimini
 * ILK KALEM EKLENMEDEN ONCE yaziyor (yukarida), yani tetikleyici kalemin
 * eklendigi anda dogru degeri gorebiliyor.
 *
 * Ertelenmis bir kisit ancak COMMIT aninda patlardi: hata, sorunu yaratan
 * ifadeden cok sonra ve hangi kalemin bozuk oldugunu gostermeden gelirdi.
 */
drop trigger if exists order_items_currency_matches on public.order_items;
create trigger order_items_currency_matches
  after insert or update of product_id, order_id on public.order_items
  for each row execute function public.tg_order_items_currency_matches();

revoke execute on function public.tg_order_items_currency_matches() from public;

comment on function public.tg_order_items_currency_matches() is
  'Bir siparis kalemi, siparisin para biriminden sapamaz. Aninda calisir: '
  'create_order para birimini ilk kalemden ONCE yazar.';

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
-- Bu goc tohum verisinden ONCE calisir; urun/tasern olmadigi icin DAVRANIS
-- burada sinanamaz. Sinanan sey YAPI: uc katmanin da yerinde oldugu.
-- Davranis sinamasi 112_order_currency_test.sql icinde (tohumdan sonra).
do $$
declare
  v_src text;
begin
  -- 1) Yabanci anahtar: var olmayan bir para birimi kodu kaydedilemez.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.orders'::regclass and conname = 'orders_currency_fkey'
  ) then
    raise exception 'DOGRULAMA 1: orders.currency yabanci anahtari kurulmadi.';
  end if;

  -- 2) Tetikleyici var ve ANINDA calisiyor. Ertelenmis olsaydi hata ancak
  --    COMMIT aninda, hangi kalemin bozuk oldugunu gostermeden gelirdi.
  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname = 'order_items'
       and t.tgname = 'order_items_currency_matches'
       and not t.tgdeferrable
  ) then
    raise exception 'DOGRULAMA 2: kalem para birimi tetikleyicisi yok ya da '
      'ertelenmis -- create_order para birimini ilk kalemden ONCE yaziyor, '
      'ertelemeye gerek yok ve erteleme hatayi gec ve belirsiz yapar.';
  end if;

  -- 3) create_order gercekten karisik sepeti reddediyor VE para birimini
  --    yaziyor. Islev govdesi okunuyor cunku davranis burada calistirilamaz.
  select prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';

  if position('OHAAAA_MIXED_CURRENCY' in v_src) = 0 then
    raise exception 'DOGRULAMA 3a: create_order karisik para birimini reddetmiyor.';
  end if;
  if position('currency               = v_currency' in v_src) = 0 then
    raise exception 'DOGRULAMA 3b: create_order siparisin para birimini yazmiyor '
      '-- varsayilan TRY''de kalirdi.';
  end if;

  -- 4) ACL KORUNDU. `create or replace` kullanildi; DROP edilseydi grant
  --    duserdi ve siparis olusturma `authenticated` icin kirilirdi.
  if not has_function_privilege('authenticated',
       'public.create_order(jsonb, text, jsonb, text)', 'execute') then
    raise exception 'DOGRULAMA 4: create_order uzerindeki grant kayboldu.';
  end if;

  -- 5) Tetikleyici islevi istemciye ACIK DEGIL.
  if has_function_privilege('anon',
       'public.tg_order_items_currency_matches()', 'execute') then
    raise exception 'DOGRULAMA 5: tetikleyici islevi anon tarafindan cagrilabiliyor.';
  end if;

  raise notice
    'Siparis para birimi kuruldu: karisik sepet reddediliyor, orders.currency '
    'urunlerden yaziliyor, kalem sapmasi ertelenmis tetikleyiciyle engelleniyor.';
end $$;
