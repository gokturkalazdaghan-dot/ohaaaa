-- ============================================================================
-- DEĞERLENDİRME DURUM KORUMASI GERÇEKTEN ÇALIŞSIN
-- ----------------------------------------------------------------------------
-- BULUNAN AÇIK
-- `tg_reviews_protect_status` şu koşulu taşıyordu:
--
--     if new.status is distinct from old.status
--        and current_user in ('anon', 'authenticated')
--        and not public.is_admin() then
--
-- Fonksiyon SECURITY DEFINER. PostgreSQL'de SECURITY DEFINER bir fonksiyonun
-- içinde `current_user` ÇAĞIRAN rol değil, FONKSİYONUN SAHİBİDİR. Yani
-- `current_user` her zaman `postgres`; `current_user in ('anon',
-- 'authenticated')` hiçbir zaman doğru olmuyor ve koruma HİÇ ÇALIŞMIYORDU.
-- (Ölçüldü: SECURITY DEFINER bir tetikleyici içinde
--  current_user=postgres / session_user=postgres.)
--
-- SONUCU
-- Yöneticinin kötüye kullanım nedeniyle GİZLEDİĞİ bir yorumu, yorumu yazan
-- kişi `status`'ü 'published' yaparak geri yayına alabiliyordu. Moderasyon
-- kararı, hakkında karar verilen kişi tarafından geri alınabiliyordu.
--
-- DOĞRU AYRIM
-- Rol adına değil `auth.uid()`'e bakılır: doluysa istemci bir kullanıcı
-- yazıyordur (anon ya da authenticated fark etmez), boşsa sunucu tarafı bir
-- iş yazıyordur (service_role) ve moderasyonun geçmesi gereken yol odur.
-- ============================================================================

create or replace function public.tg_reviews_protect_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and not public.is_admin() then
    new.status := old.status;
  end if;

  -- Dayanak değiştirilemez: yorumun bağlı olduğu satın alma sabittir.
  new.order_item_id := old.order_item_id;
  new.user_id       := old.user_id;
  new.group_id      := old.group_id;
  new.vendor_id     := old.vendor_id;
  return new;
end;
$$;

revoke execute on function public.tg_reviews_protect_status()
  from public, anon, authenticated;

-- Göç sessizce geçmesin: kırılgan koşul gerçekten gitmiş olmalı.
do $$
begin
  if exists (
    select 1 from pg_proc
     where proname = 'tg_reviews_protect_status'
       and pronamespace = 'public'::regnamespace
       and prosrc like '%current_user in%'
  ) then
    raise exception 'Koruma hala current_user kosuluna dayaniyor; SECURITY DEFINER icinde bu her zaman sahibi doner.';
  end if;
end $$;
