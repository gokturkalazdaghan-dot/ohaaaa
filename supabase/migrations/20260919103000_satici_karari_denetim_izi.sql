-- ===========================================================================
-- SATICI KARARINDA "KİM" SÜTUNU
-- ---------------------------------------------------------------------------
-- GÜVENLİK DENETİMİNDEN (2026-09-19) ÇIKAN BULGU
-- `vendors` tablosu `approved_at` ve `rejection_reason` tutuyordu ama kararı
-- KİMİN verdiğini tutmuyordu. Aynı depoda belge incelemesi bunu zaten doğru
-- yapıyor (`vendor_documents.reviewed_by`, `reviewed_at`); satıcı onayı ise
-- yapmıyordu.
--
-- Bir satıcıyı onaylamak, ona komisyon oranı atamak ve pazar yerinde satış
-- hakkı vermektir. Bu kararın geri dönüp sorulabilir olması gerekir:
-- "bu satıcıyı kim, ne zaman onayladı?"
--
-- ---------------------------------------------------------------------------
-- İZ UYGULAMADA DEĞİL, VERİTABANINDA TUTULUYOR
-- ---------------------------------------------------------------------------
-- Alternatif, `decideApplication` eyleminin sütunları kendisinin yazmasıydı.
-- Üç sebeple seçilmedi:
--
--   1) UNUTULABİLİR. Yarın başka bir yol (bir betik, bir panel, bir RPC)
--      `status` değiştirirse iz düşer ve kimse fark etmez.
--   2) UYDURULABİLİR. Uygulamanın gönderdiği bir kimlik, uygulamanın
--      söylediği şeydir; `auth.uid()` oturumun kendisidir.
--   3) DEPODA ZATEN BÖYLE YAPILIYOR. `tg_vendor_documents_guard` karar
--      alanlarını aynı gerekçeyle veritabanında koruyor. İkinci bir kalıp
--      kurmak, ikisinin zamanla ayrışması demekti.
--
-- Tetikleyici `status` HER DEĞİŞTİĞİNDE damgayı basar; çağıranın bir şey
-- yapması gerekmez.
--
-- ---------------------------------------------------------------------------
-- `auth.uid()` NULL OLABİLİR VE BU BİR HATA DEĞİL
-- ---------------------------------------------------------------------------
-- Servis rolüyle (göç, betik, arka plan işi) yapılan bir değişiklikte oturum
-- yoktur. O durumda `decided_by` null, `decided_at` dolu kalır ve bu doğru
-- okunur: "bir servis süreci değiştirdi, atfedilebilecek bir insan yok."
-- Uydurma bir kimlik yazmak, izi izsizlikten daha kötü hâle getirirdi.
-- ===========================================================================

alter table public.vendors
  add column if not exists decided_by uuid references public.users(id) on delete set null,
  add column if not exists decided_at timestamptz;

comment on column public.vendors.decided_by is
  'Son durum değişikliğini yapan kullanıcı. Tetikleyici yazar; servis rolünde null.';
comment on column public.vendors.decided_at is
  'Son durum değişikliğinin zamanı. Tetikleyici yazar.';

create or replace function public.tg_vendors_karar_izi()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Yalnızca DURUM değiştiğinde. Ad, açıklama ya da logo güncellemesi bir
  -- karar değildir; onları da damgalamak izi anlamsızlaştırırdı.
  if new.status is distinct from old.status then
    new.decided_by := auth.uid();
    new.decided_at := now();
  else
    -- Durum değişmiyorsa iz DOKUNULMAZ. Aksi hâlde sıradan bir profil
    -- güncellemesi, geçmişteki kararın kimliğini silerdi.
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;

  return new;
end;
$function$;

drop trigger if exists vendors_karar_izi on public.vendors;

create trigger vendors_karar_izi
before update on public.vendors
for each row
execute function public.tg_vendors_karar_izi();

-- ---------------------------------------------------------------------------
-- GÖÇÜN KENDİ DOĞRULAMASI
-- ---------------------------------------------------------------------------
do $$
declare
  v_sutun int;
  v_trig  int;
begin
  select count(*) into v_sutun
    from information_schema.columns
   where table_schema = 'public' and table_name = 'vendors'
     and column_name in ('decided_by', 'decided_at');

  select count(*) into v_trig
    from pg_trigger
   where tgname = 'vendors_karar_izi'
     and tgrelid = 'public.vendors'::regclass
     and not tgisinternal;

  if v_sutun <> 2 then
    raise exception 'decided_by/decided_at sutunlari eksik (% bulundu)', v_sutun;
  end if;
  if v_trig <> 1 then
    raise exception 'vendors_karar_izi tetikleyicisi kurulmadi';
  end if;

  raise notice 'satici karari denetim izi kuruldu';
end $$;
