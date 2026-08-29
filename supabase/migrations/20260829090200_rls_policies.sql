-- ============================================================================
-- OHAAAA · 003 — Row Level Security (RLS)
-- ----------------------------------------------------------------------------
-- Güvenlik modeli üç aktör üzerine kuruludur:
--
--   anon           → yalnızca yayınlanmış katalog (onaylı taşeron + aktif ürün)
--   authenticated  → kendi profili, kendi siparişleri, sahibi olduğu taşeron
--   service_role   → backend middleware (RLS'i bypass eder, yetkiyi kendi
--                    doğrular; taşeron API'si bu rolle çalışır)
--
-- Kural: her tabloda RLS açıktır ve politika yoksa erişim yoktur.
-- (Tablo sahibi postgres rolüdür; anon/authenticated sahip olmadığı için
--  FORCE gerekmez. service_role zaten BYPASSRLS ile çalışır.)
-- ============================================================================

alter table public.users            enable row level security;
alter table public.vendors          enable row level security;
alter table public.api_keys         enable row level security;
alter table public.categories       enable row level security;
alter table public.product_groups   enable row level security;
alter table public.products         enable row level security;
alter table public.flash_deals      enable row level security;
alter table public.orders           enable row level security;
alter table public.vendor_orders    enable row level security;
alter table public.order_items      enable row level security;
alter table public.api_request_logs enable row level security;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create policy "users_select_self"
  on public.users for select
  using (id = auth.uid() or public.is_admin());

create policy "users_update_self"
  on public.users for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- Kullanıcı kendi rolünü yükseltemez; rol değişimi yalnız admin/service_role.
    and role = (select u.role from public.users u where u.id = auth.uid())
  );

create policy "users_admin_all"
  on public.users for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- vendors — onaylı taşeronlar herkese açık (mağaza sayfaları için)
-- ---------------------------------------------------------------------------
create policy "vendors_public_read_approved"
  on public.vendors for select
  using (status = 'approved');

create policy "vendors_owner_read"
  on public.vendors for select
  using (owner_id = auth.uid() or public.is_admin());

-- Başvuru: kullanıcı kendi adına taşeron kaydı açabilir, ama 'pending' olarak
-- ve komisyon oranını kendisi belirleyemez (varsayılan kalır).
create policy "vendors_owner_insert"
  on public.vendors for insert
  with check (
    owner_id = auth.uid()
    and status = 'pending'
    and approved_at is null
  );

create policy "vendors_owner_update"
  on public.vendors for update
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    -- Taşeron kendi durumunu veya komisyonunu değiştiremez.
    and status = (select v.status from public.vendors v where v.id = vendors.id)
    and commission_rate = (select v.commission_rate from public.vendors v where v.id = vendors.id)
  );

create policy "vendors_admin_all"
  on public.vendors for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- api_keys — ASLA herkese açık değil. Sahibi bile key_hash'i okumamalı,
-- bu yüzden uygulama katmanı sadece güvenli kolonları seçen bir view kullanır.
-- ---------------------------------------------------------------------------
create policy "api_keys_owner_read"
  on public.api_keys for select
  using (public.owns_vendor(vendor_id) or public.is_admin());

create policy "api_keys_owner_insert"
  on public.api_keys for insert
  with check (public.owns_vendor(vendor_id));

-- Güncelleme yalnızca iptal (revoke) ve isim değişimi içindir; hash değişmez.
create policy "api_keys_owner_update"
  on public.api_keys for update
  using (public.owns_vendor(vendor_id))
  with check (
    public.owns_vendor(vendor_id)
    and key_hash = (select k.key_hash from public.api_keys k where k.id = api_keys.id)
  );

create policy "api_keys_owner_delete"
  on public.api_keys for delete
  using (public.owns_vendor(vendor_id) or public.is_admin());

-- Panelde kullanılacak güvenli görünüm: hash sızdırmaz.
create view public.api_keys_safe
with (security_invoker = true)
as
  select
    id, vendor_id, name, environment, key_prefix, last_four, scopes,
    rate_limit_per_minute, last_used_at, request_count,
    expires_at, revoked_at, created_at,
    (revoked_at is null and (expires_at is null or expires_at > now())) as is_active
  from public.api_keys;

comment on view public.api_keys_safe is
  'api_keys tablosunun key_hash içermeyen güvenli izdüşümü. security_invoker: çağıranın RLS''i uygulanır.';

-- ---------------------------------------------------------------------------
-- categories — herkese açık okuma
-- ---------------------------------------------------------------------------
create policy "categories_public_read"
  on public.categories for select
  using (is_active);

create policy "categories_admin_all"
  on public.categories for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- product_groups — kanonik katalog herkese açık
-- ---------------------------------------------------------------------------
create policy "product_groups_public_read"
  on public.product_groups for select
  using (true);

create policy "product_groups_admin_write"
  on public.product_groups for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
-- Vitrin: yalnızca onaylı taşeronun aktif ürünleri.
create policy "products_public_read_active"
  on public.products for select
  using (
    status = 'active'
    and exists (
      select 1 from public.vendors v
      where v.id = products.vendor_id and v.status = 'approved'
    )
  );

-- Taşeron kendi taslak/arşiv ürünlerini de görür.
create policy "products_vendor_read_own"
  on public.products for select
  using (public.owns_vendor(vendor_id) or public.is_admin());

create policy "products_vendor_insert"
  on public.products for insert
  with check (public.owns_vendor(vendor_id));

create policy "products_vendor_update"
  on public.products for update
  using (public.owns_vendor(vendor_id))
  with check (public.owns_vendor(vendor_id));

create policy "products_vendor_delete"
  on public.products for delete
  using (public.owns_vendor(vendor_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- flash_deals — süresi geçmemiş kampanyalar herkese açık
-- ---------------------------------------------------------------------------
create policy "flash_deals_public_read"
  on public.flash_deals for select
  using (now() between starts_at and ends_at);

create policy "flash_deals_vendor_read_own"
  on public.flash_deals for select
  using (
    exists (
      select 1 from public.products p
      where p.id = flash_deals.product_id and public.owns_vendor(p.vendor_id)
    )
    or public.is_admin()
  );

create policy "flash_deals_admin_write"
  on public.flash_deals for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- orders — müşteri kendi siparişini görür; taşeron yalnızca kendisine düşen
-- alt siparişi ve kalemleri görür (müşterinin diğer taşeron kalemlerini DEĞİL).
-- ---------------------------------------------------------------------------
create policy "orders_customer_read_own"
  on public.orders for select
  using (user_id = auth.uid() or public.is_admin());

-- Taşeron, kendisine düşen alt siparişi barındıran ana siparişi görebilir.
-- Kontrol SECURITY DEFINER fonksiyonla yapılır: aksi halde bu politika
-- vendor_orders politikasını, o da bu politikayı tetikleyip döngü oluşur.
create policy "orders_vendor_read_related"
  on public.orders for select
  using (public.order_has_vendor_of_current_user(id));

-- Sipariş oluşturma yalnızca create_order() RPC'si üzerinden yapılır.
create policy "orders_admin_write"
  on public.orders for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- vendor_orders
-- ---------------------------------------------------------------------------
create policy "vendor_orders_customer_read"
  on public.vendor_orders for select
  using (public.order_belongs_to_current_user(order_id) or public.is_admin());

create policy "vendor_orders_vendor_read"
  on public.vendor_orders for select
  using (public.owns_vendor(vendor_id));

-- Taşeron yalnızca kargo/durum alanlarını güncelleyebilir; tutarlara dokunamaz.
create policy "vendor_orders_vendor_update"
  on public.vendor_orders for update
  using (public.owns_vendor(vendor_id))
  with check (
    public.owns_vendor(vendor_id)
    and items_subtotal_cents = (
      select vo.items_subtotal_cents from public.vendor_orders vo where vo.id = vendor_orders.id)
    and commission_cents = (
      select vo.commission_cents from public.vendor_orders vo where vo.id = vendor_orders.id)
    and payout_cents = (
      select vo.payout_cents from public.vendor_orders vo where vo.id = vendor_orders.id)
  );

create policy "vendor_orders_admin_all"
  on public.vendor_orders for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
create policy "order_items_customer_read"
  on public.order_items for select
  using (public.order_belongs_to_current_user(order_id) or public.is_admin());

create policy "order_items_vendor_read"
  on public.order_items for select
  using (public.owns_vendor(vendor_id));

create policy "order_items_admin_all"
  on public.order_items for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- api_request_logs — taşeron kendi trafiğini görür, yazamaz.
-- ---------------------------------------------------------------------------
create policy "api_request_logs_vendor_read"
  on public.api_request_logs for select
  using (public.owns_vendor(vendor_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- Rol bazlı GRANT'ler
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on
  public.categories, public.product_groups, public.products,
  public.vendors, public.flash_deals
  to anon, authenticated;

grant select, insert, update, delete on
  public.api_keys, public.vendors, public.products
  to authenticated;

grant select on public.api_keys_safe to authenticated;
grant select, update on public.vendor_orders to authenticated;
grant select on public.orders, public.order_items, public.api_request_logs to authenticated;
grant select, update on public.users to authenticated;

grant execute on function public.search_products(text, uuid, bigint, bigint, text, integer, integer)
  to anon, authenticated;
grant execute on function public.create_order(jsonb, text, jsonb, text) to authenticated;
grant execute on function public.confirm_payment(uuid, text, text) to authenticated;
grant execute on function public.vendor_dashboard_stats(uuid, integer) to authenticated;
grant execute on function public.order_belongs_to_current_user(uuid) to authenticated;
grant execute on function public.order_has_vendor_of_current_user(uuid) to authenticated;

-- İç kullanım fonksiyonları istemciye açılmaz.
revoke execute on function public.refresh_product_group_stats(uuid) from anon, authenticated;
