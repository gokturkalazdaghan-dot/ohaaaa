-- ============================================================================
-- OHAAAA · 007 — Taşeron kaydı açıldığında kullanıcı rolünü yükselt
-- ----------------------------------------------------------------------------
-- SORUN: Başvuru sunucu eylemi, kullanıcının rolünü 'vendor' yapmayı deniyordu
-- ama `users_update_self` politikası rol değişimine izin vermez (ve vermemeli
-- — aksi halde herkes kendini admin yapabilirdi). Güncelleme sessizce
-- başarısız oluyordu.
--
-- ÇÖZÜM: Rol, uygulamanın isteğine bağlı bir alan değil, VERİNİN BİR SONUCU.
-- "Taşeron kaydı olan kullanıcı vendor'dur" bir değişmezdir (invariant) ve
-- değişmezlerin yeri veritabanıdır. Trigger SECURITY DEFINER olduğu için
-- RLS'e takılmaz; kullanıcı yine kendi rolünü ELLE değiştiremez.
-- ============================================================================

create or replace function public.tg_vendors_promote_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admin rolü korunur: bir yönetici mağaza açarsa yetkisi düşmemeli.
  update public.users
     set role = 'vendor'
   where id = new.owner_id
     and role = 'customer';

  return new;
end;
$$;

create trigger vendors_promote_owner
  after insert on public.vendors
  for each row execute function public.tg_vendors_promote_owner();

comment on function public.tg_vendors_promote_owner() is
  'Taşeron kaydı açan kullanıcıyı vendor rolüne yükseltir. Rol, uygulamanın '
  'değil verinin sonucudur; kullanıcı bunu elle değiştiremez.';
