-- ============================================================================
-- OHAAAA · 002 — Fonksiyonlar, Trigger'lar ve İş Mantığı
-- ----------------------------------------------------------------------------
-- Buradaki mantık bilinçli olarak veritabanında yaşar:
--   * Fiyat karşılaştırma önbelleği (product_groups) tutarlılığı ancak
--     trigger ile garanti edilir — beslemeler API, panel ve seed'den gelir.
--   * Sipariş oluşturma tek transaction olmalıdır (stok + tutar + komisyon).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Yetki yardımcıları
-- ---------------------------------------------------------------------------
-- RLS politikaları içinden çağrılırlar. SECURITY DEFINER olmaları şart:
-- aksi halde politika, sorguladığı tablonun kendi politikasını tetikleyip
-- sonsuz özyinelemeye (infinite recursion) girer.

create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.users where id = auth.uid()),
    false
  );
$$;

create or replace function public.owns_vendor(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.vendors v
    where v.id = p_vendor_id
      and v.owner_id = auth.uid()
  );
$$;

comment on function public.owns_vendor(uuid) is
  'RLS için: oturumdaki kullanıcı bu taşeronun sahibi mi? SECURITY DEFINER — özyinelemeyi önler.';

-- ---------------------------------------------------------------------------
-- Sipariş görünürlüğü yardımcıları
-- ---------------------------------------------------------------------------
-- KRİTİK: orders / vendor_orders / order_items politikaları birbirine
-- referans verirse PostgreSQL "infinite recursion detected in policy"
-- hatası üretir (orders politikası vendor_orders'ı sorgular, onun politikası
-- da orders'ı...). Bu iki fonksiyon SECURITY DEFINER olduğu için içlerindeki
-- sorgular RLS'e takılmaz ve döngü kırılır.

create or replace function public.order_belongs_to_current_user(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and o.user_id = auth.uid()
  );
$$;

create or replace function public.order_has_vendor_of_current_user(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.vendor_orders vo
    join public.vendors v on v.id = vo.vendor_id
    where vo.order_id = p_order_id
      and v.owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- slugify — Türkçe karakter duyarlı URL sluglama
-- ---------------------------------------------------------------------------
create or replace function public.slugify(p_input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(
        lower(translate(
          coalesce(p_input, ''),
          'ĞÜŞİÖÇğüşıöçÂÎÛâîû',
          'gusiocgusiocaiuaiu'
        )),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-{2,}', '-', 'g'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- product_groups karşılaştırma önbelleğini tazele
-- ---------------------------------------------------------------------------
-- "Satılabilir teklif" tanımı: status = 'active' AND stock > 0.
-- Bu tanım tüm uygulamada tek yerden yönetilsin diye burada merkezîdir.
create or replace function public.refresh_product_group_stats(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_min   bigint;
  v_max   bigint;
  v_best  uuid;
begin
  if p_group_id is null then
    return;
  end if;

  select count(*), min(p.price_cents), max(p.price_cents)
    into v_count, v_min, v_max
  from public.products p
  where p.group_id = p_group_id
    and p.status = 'active'
    and p.stock > 0;

  -- En iyi teklif: en düşük toplam maliyet (ürün + kargo), eşitlikte hızlı teslimat.
  select p.id into v_best
  from public.products p
  where p.group_id = p_group_id
    and p.status = 'active'
    and p.stock > 0
  order by (p.price_cents + p.shipping_fee_cents) asc,
           p.estimated_delivery_days asc,
           p.created_at asc
  limit 1;

  update public.product_groups
     set offer_count     = coalesce(v_count, 0),
         min_price_cents = v_min,
         max_price_cents = v_max,
         best_offer_id   = v_best,
         updated_at      = now()
   where id = p_group_id;
end;
$$;

create or replace function public.tg_products_sync_group_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Grup değiştiyse hem eski hem yeni grubun istatistiği bozulur.
  if tg_op = 'UPDATE' and old.group_id is distinct from new.group_id then
    perform public.refresh_product_group_stats(old.group_id);
  end if;

  if tg_op = 'DELETE' then
    perform public.refresh_product_group_stats(old.group_id);
    return old;
  end if;

  perform public.refresh_product_group_stats(new.group_id);
  return new;
end;
$$;

create trigger products_sync_group_stats
  after insert or update or delete on public.products
  for each row execute function public.tg_products_sync_group_stats();

-- ---------------------------------------------------------------------------
-- vendors.active_product_count sayacını güncel tut
-- ---------------------------------------------------------------------------
create or replace function public.tg_products_sync_vendor_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor uuid := coalesce(new.vendor_id, old.vendor_id);
begin
  update public.vendors v
     set active_product_count = (
           select count(*)
           from public.products p
           where p.vendor_id = v.id
             and p.status = 'active'
         )
   where v.id = v_vendor;

  return coalesce(new, old);
end;
$$;

create trigger products_sync_vendor_count
  after insert or update of status, vendor_id or delete on public.products
  for each row execute function public.tg_products_sync_vendor_count();

-- ---------------------------------------------------------------------------
-- Sipariş numarası üretimi — OHA-20260829-7F3K2Q
-- ---------------------------------------------------------------------------
create or replace function public.tg_orders_set_order_number()
returns trigger
language plpgsql
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number :=
      'OHA-' || to_char(now(), 'YYYYMMDD') || '-' ||
      upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
  end if;
  return new;
end;
$$;

create trigger orders_set_order_number
  before insert on public.orders
  for each row execute function public.tg_orders_set_order_number();

-- ---------------------------------------------------------------------------
-- Stok azaltma: sipariş kalemi eklendiğinde
-- ---------------------------------------------------------------------------
create or replace function public.tg_order_items_decrement_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.product_id is null then
    return new;
  end if;

  update public.products
     set stock  = stock - new.quantity,
         status = case
                    when stock - new.quantity <= 0 then 'out_of_stock'::public.product_status
                    else status
                  end
   where id = new.product_id
     and stock >= new.quantity;

  if not found then
    raise exception 'OHAAAA_OUT_OF_STOCK: ürün % için yeterli stok yok', new.product_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger order_items_decrement_stock
  after insert on public.order_items
  for each row execute function public.tg_order_items_decrement_stock();

-- ---------------------------------------------------------------------------
-- assert_orderable — bir teklif bizde sipariş edilebilir mi?
-- ---------------------------------------------------------------------------
-- Ayrı bir fonksiyondur çünkü kural zamanla genişler (ör. affiliate teklifleri
-- 005 numaralı migration'da eklendiğinde). Kuralı burada tutmak, 150 satırlık
-- create_order() gövdesini her kural değişiminde yeniden yazmayı önler.
create or replace function public.assert_orderable(p_product public.products)
returns void
language plpgsql
immutable
as $$
begin
  if p_product.status <> 'active' then
    raise exception 'OHAAAA_PRODUCT_UNAVAILABLE: % satışta değil', p_product.title
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ===========================================================================
-- create_order — SPLIT-CART çekirdeği
-- ---------------------------------------------------------------------------
-- Tek bir müşteri sepetini alır ve taşeron bazında böler:
--
--   orders (1)
--     └── vendor_orders (N — sepetteki her benzersiz taşeron için 1 adet)
--           └── order_items (M)
--
-- Fiyat, kargo ve komisyon SUNUCUDA yeniden hesaplanır; istemciden gelen
-- tutarlara asla güvenilmez. Tamamı tek transaction'dır: stok yetmezse
-- siparişin tamamı geri alınır.
--
-- p_items formatı: [{"product_id": "<uuid>", "quantity": 2}, ...]
-- ===========================================================================
create or replace function public.create_order(
  p_items            jsonb,
  p_email            text,
  p_shipping_address jsonb,
  p_notes            text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
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
         grand_total_cents      = agg.subtotal + agg.shipping
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
$$;

comment on function public.create_order(jsonb, text, jsonb, text) is
  'Sepeti taşeron bazında bölerek (split-cart) sipariş oluşturur. Fiyatlar sunucuda yeniden hesaplanır.';

-- ===========================================================================
-- confirm_payment — ödeme simülasyonu sonrası durum geçişi
-- ===========================================================================
create or replace function public.confirm_payment(
  p_order_id  uuid,
  p_provider  text,
  p_reference text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  update public.orders
     set status           = 'paid',
         payment_provider = p_provider,
         payment_reference = p_reference,
         paid_at          = now()
   where id = p_order_id
     and status = 'pending_payment'
  returning * into v_order;

  if not found then
    raise exception 'OHAAAA_ORDER_NOT_PAYABLE: sipariş bulunamadı veya zaten ödenmiş'
      using errcode = 'check_violation';
  end if;

  -- Taşeronlara düşen alt siparişler artık hazırlanmayı bekliyor.
  update public.vendor_orders
     set status = 'accepted'
   where order_id = p_order_id
     and status = 'awaiting_vendor';

  return v_order;
end;
$$;

-- ===========================================================================
-- search_products — ana sayfa / arama sayfası tek sorgu
-- ---------------------------------------------------------------------------
-- Tam metin (tsvector) + trigram bulanık eşleşmeyi birleştirir; sonuçları
-- kanonik ürün grubu bazında döndürür ki karşılaştırma kartları render
-- edilebilsin.
-- ===========================================================================
create or replace function public.search_products(
  p_query       text default null,
  p_category_id uuid default null,
  p_min_price   bigint default null,
  p_max_price   bigint default null,
  p_sort        text default 'relevance',
  p_limit       integer default 24,
  p_offset      integer default 0
)
returns table (
  group_id        uuid,
  slug            citext,
  title           text,
  brand           text,
  image_url       text,
  offer_count     integer,
  min_price_cents bigint,
  max_price_cents bigint,
  best_offer_id   uuid,
  best_vendor_id  uuid,
  best_vendor_name text,
  relevance       real
)
language sql
stable
-- Kelime benzerliği eşiği 0.6 (varsayılan) e-ticaret yazım hataları için fazla
-- katıdır: "aifryer" -> "airfryer" eşleşmez. 0.45 gürültüye yol açmadan
-- tipik harf düşmesi/yer değiştirmesini yakalar.
set pg_trgm.word_similarity_threshold = 0.45
as $$
  with params as (
    select public.normalize_search(nullif(trim(coalesce(p_query, '')), '')) as q
  ),
  -- Sorgu kelimelere bölünür ve HER kelimenin eşleşmesi aranır (AND semantiği).
  -- "sony xm5" araması, iki parçası başlığın farklı yerlerinde geçse bile bulur.
  tokens as (
    select t.tok
    from params, lateral unnest(string_to_array(params.q, ' ')) as t(tok)
    where params.q is not null and length(t.tok) > 0
  ),
  matched as (
    select
      g.id, g.slug, g.title, g.brand, g.image_url, g.offer_count,
      g.min_price_cents, g.max_price_cents, g.best_offer_id,
      case
        when pr.q is null then 1.0::real
        else
          -- Tam metin isabeti en güçlü sinyal; alt dize ve bulanık eşleşme
          -- onu tamamlar. Katsayılar sıralamayı belirler, mutlak değer değil.
          ts_rank(to_tsvector('simple', g.search_text),
                  plainto_tsquery('simple', pr.q)) * 4.0
          + case when g.search_text like '%' || pr.q || '%' then 1.0 else 0.0 end
          + similarity(g.search_text, pr.q)
          -- Başlığın kelimesiyle başlayan sorgular öne çıksın.
          + case when g.search_text like pr.q || '%' then 0.5 else 0.0 end
      end::real as relevance
    from public.product_groups g
    cross join params pr
    where g.offer_count > 0
      and (p_category_id is null or g.category_id = p_category_id)
      and (p_min_price is null or g.min_price_cents >= p_min_price)
      and (p_max_price is null or g.min_price_cents <= p_max_price)
      and (
        pr.q is null
        -- Eşleşmeyen tek bir kelime bile varsa sonuç elenir.
        or not exists (
          select 1 from tokens t
          where not (
            g.search_text like '%' || t.tok || '%'
            or t.tok <% g.search_text          -- kelime bazlı bulanık eşleşme
          )
        )
      )
  )
  select
    m.id, m.slug, m.title, m.brand, m.image_url, m.offer_count,
    m.min_price_cents, m.max_price_cents, m.best_offer_id,
    v.id, v.display_name, m.relevance
  from matched m
  left join public.products bp on bp.id = m.best_offer_id
  left join public.vendors  v  on v.id = bp.vendor_id
  order by
    case when p_sort = 'price_asc'  then m.min_price_cents end asc nulls last,
    case when p_sort = 'price_desc' then m.min_price_cents end desc nulls last,
    case when p_sort = 'offers'     then m.offer_count end desc nulls last,
    case when p_sort = 'relevance'  then m.relevance end desc nulls last,
    m.title asc
  limit greatest(1, least(coalesce(p_limit, 24), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.search_products is
  'Kanonik ürün grubu bazında arama + fiyat karşılaştırma sonucu döndürür.';

-- ===========================================================================
-- vendor_dashboard_stats — taşeron panelinin analitik kartları
-- ===========================================================================
create or replace function public.vendor_dashboard_stats(
  p_vendor_id uuid,
  p_days      integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
  v_result jsonb;
begin
  -- SECURITY DEFINER olduğu için yetkiyi burada elle doğrulamak zorunludur.
  if not (public.owns_vendor(p_vendor_id) or public.is_admin()) then
    raise exception 'OHAAAA_FORBIDDEN: bu taşerona erişim yetkiniz yok'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'vendor_id',      p_vendor_id,
    'window_days',    greatest(1, least(p_days, 365)),
    'revenue_cents',  coalesce(sum(vo.items_subtotal_cents), 0),
    'payout_cents',   coalesce(sum(vo.payout_cents), 0),
    'commission_cents', coalesce(sum(vo.commission_cents), 0),
    'order_count',    count(*),
    'awaiting_count', count(*) filter (where vo.status = 'awaiting_vendor'),
    'shipped_count',  count(*) filter (where vo.status = 'shipped'),
    'delivered_count', count(*) filter (where vo.status = 'delivered'),
    'avg_order_cents', coalesce(round(avg(vo.items_subtotal_cents))::bigint, 0)
  )
  into v_result
  from public.vendor_orders vo
  where vo.vendor_id = p_vendor_id
    and vo.created_at >= v_since;

  return v_result || jsonb_build_object(
    'active_products',
      (select count(*) from public.products
        where vendor_id = p_vendor_id and status = 'active'),
    'out_of_stock_products',
      (select count(*) from public.products
        where vendor_id = p_vendor_id and (status = 'out_of_stock' or stock = 0)),
    'daily_revenue',
      coalesce((
        select jsonb_agg(row_to_json(d) order by d.day)
        from (
          select date_trunc('day', vo2.created_at)::date as day,
                 sum(vo2.items_subtotal_cents)::bigint   as revenue_cents,
                 count(*)                                as order_count
          from public.vendor_orders vo2
          where vo2.vendor_id = p_vendor_id
            and vo2.created_at >= v_since
          group by 1
        ) d
      ), '[]'::jsonb)
  );
end;
$$;
