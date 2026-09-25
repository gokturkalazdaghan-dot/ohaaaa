-- =============================================================================
-- RLS: auth.uid() satır başına değil, sorgu başına bir kez hesaplansın
-- =============================================================================
-- Supabase performans denetçisi (auth_rls_initplan) 17 politikayı işaretledi:
-- `auth.uid()` çıplak yazıldığında Postgres onu HER SATIR için yeniden
-- çağırır. `(select auth.uid())` yazıldığında planlayıcı bunu bir InitPlan'a
-- çevirir ve sorgu başına tek kez hesaplar. Sonuç kümesi birebir aynıdır;
-- yalnızca büyük tablolarda (reviews, product_questions, favorites) tarama
-- maliyeti düşer.
--
-- Politikalar SİLİNMİYOR: `alter policy` yalnızca ifadeyi değiştirir; ad,
-- komut, roller ve izin/kısıt türü olduğu gibi kalır. İfadeler canlı
-- veritabanındaki pg_policies çıktısından birebir alındı, tek fark
-- `auth.uid()` -> `(select auth.uid())`.
--
-- Kaynak: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
-- =============================================================================

alter policy addresses_own_all on public.addresses
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy favorites_own_all on public.favorites
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy orders_customer_read_own on public.orders
  using ((user_id = (select auth.uid())) or public.is_admin());

alter policy questions_delete_own on public.product_questions
  using ((user_id = (select auth.uid())) or public.is_admin());

alter policy questions_insert_own on public.product_questions
  with check (user_id = (select auth.uid()));

alter policy questions_read on public.product_questions
  using ((not is_hidden) or (user_id = (select auth.uid())) or public.is_admin());

alter policy questions_update_owner_or_answerer on public.product_questions
  using ((user_id = (select auth.uid())) or public.can_answer_question(group_id))
  with check ((user_id = (select auth.uid())) or public.can_answer_question(group_id));

alter policy reviews_delete_own on public.reviews
  using ((user_id = (select auth.uid())) or public.is_admin());

alter policy reviews_insert_verified_purchase on public.reviews
  with check (
    (user_id = (select auth.uid()))
    and exists (
      select 1
        from public.order_items oi
        join public.orders o         on o.id = oi.order_id
        join public.vendor_orders vo on vo.id = oi.vendor_order_id
        join public.products p       on p.id = oi.product_id
       where oi.id = reviews.order_item_id
         and o.user_id = (select auth.uid())
         and vo.status = 'delivered'::public.vendor_order_status
         and p.group_id = reviews.group_id
         and oi.vendor_id = reviews.vendor_id
    )
  );

alter policy reviews_read_published on public.reviews
  using ((status = 'published'::public.review_status)
         or (user_id = (select auth.uid()))
         or public.is_admin());

alter policy reviews_update_own on public.reviews
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy users_select_self on public.users
  using ((id = (select auth.uid())) or public.is_admin());

alter policy users_update_self on public.users
  using (id = (select auth.uid()))
  with check (
    (id = (select auth.uid()))
    and role = (select u.role from public.users u where u.id = (select auth.uid()))
  );

alter policy vendor_documents_own_insert on public.vendor_documents
  with check ((uploaded_by = (select auth.uid())) and public.owns_vendor(vendor_id));

alter policy vendors_owner_insert on public.vendors
  with check ((owner_id = (select auth.uid()))
              and status = 'pending'::public.vendor_status
              and approved_at is null);

alter policy vendors_owner_read on public.vendors
  using ((owner_id = (select auth.uid())) or public.is_admin());

alter policy vendors_owner_update on public.vendors
  using (owner_id = (select auth.uid()))
  with check (
    (owner_id = (select auth.uid()))
    and status = (select v.status from public.vendors v where v.id = vendors.id)
    and commission_rate = (select v.commission_rate from public.vendors v where v.id = vendors.id)
  );
