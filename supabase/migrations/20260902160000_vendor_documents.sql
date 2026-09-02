-- ============================================================================
-- SATICI BELGELERİ — vergi levhası ve imza sirküleri
-- ----------------------------------------------------------------------------
-- Başvuruda hiçbir belge istenmiyordu: yönetici, satıcının beyan ettiği
-- unvana ve vergi numarasına bakarak onay veriyordu. Bir pazar yerinde bu
-- hem ticari bir risk (kim olduğu doğrulanmamış satıcı) hem de mevzuat
-- açısından eksik: platform, satıcının kimliğini ve vergi kaydını tutmakla
-- yükümlü.
--
-- BELGE KENDİSİ VERİTABANINDA DEĞİL
-- Dosya Supabase Storage'da (`satici-belgeleri` kovası, GİZLİ); tabloda
-- yalnızca yolu ve durumu duruyor. PDF'i tabloya koymak, her satıcı
-- sorgusunu megabaytlarca veri taşımaya zorlardı.
--
-- KOVA GİZLİ, ERİŞİM RLS İLE
-- Vergi levhası ve imza sirküleri kişisel/ticari veridir. Kova herkese açık
-- olsaydı, yolu tahmin eden ya da bir kez görmüş olan herkes belgeyi
-- indirebilirdi. Erişim: yükleyen satıcı ve yönetici.
--
-- YOL, YÜKLEYENİN KİMLİĞİYLE BAŞLAR
-- `<auth.uid()>/<dosya>` düzeni, RLS'in dosyayı sahibine bağlamasını
-- mümkün kılan tek şey: `storage.objects` üzerinde satır başına sahiplik
-- ancak yoldan okunabiliyor.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('satici-belgeleri', 'satici-belgeleri', false)
on conflict (id) do nothing;

create type public.vendor_document_type as enum (
  'vergi_levhasi',
  'imza_sirkuleri',
  'kimlik',
  'diger'
);

create type public.vendor_document_status as enum ('pending', 'approved', 'rejected');

create table public.vendor_documents (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references public.vendors (id) on delete cascade,
  uploaded_by  uuid not null references public.users (id) on delete cascade,

  doc_type     public.vendor_document_type not null,
  -- Kovadaki yol. Benzersiz: aynı dosya iki kayıt üretmesin.
  storage_path text not null unique,
  file_name    text not null check (length(trim(file_name)) between 1 and 255),

  status       public.vendor_document_status not null default 'pending',
  review_note  text check (review_note is null or length(trim(review_note)) <= 1000),
  reviewed_by  uuid references public.users (id) on delete set null,
  reviewed_at  timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.vendor_documents is
  'Saticinin yukledigi belgelerin kaydi. Dosyanin kendisi storage.satici-belgeleri kovasindadir.';

create index vendor_documents_vendor_idx on public.vendor_documents (vendor_id, created_at desc);
-- Yöneticinin "incelenecekler" listesi bu dizinden okunur.
create index vendor_documents_pending_idx
  on public.vendor_documents (created_at) where status = 'pending';

create trigger vendor_documents_set_updated_at
  before update on public.vendor_documents
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Karar alanları yalnızca YÖNETİCİ eliyle değişir
-- ---------------------------------------------------------------------------
-- RLS satır seviyesinde karar verir, sütun seviyesinde edemez. Bu tetikleyici
-- olmasaydı satıcı, kendi belgesini "approved" yapıp doğrulanmış görünebilirdi.
--
-- Koşul rol adına değil `auth.uid()`e bakar: SECURITY DEFINER bir fonksiyonun
-- içinde `current_user` her zaman fonksiyonun SAHİBİDİR, çağıran değil.
-- (Aynı hata daha önce yorum durum korumasında yapılmıştı ve koruma hiç
-- çalışmıyordu.)
create or replace function public.tg_vendor_documents_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.status      := old.status;
    new.review_note := old.review_note;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;

  -- Dosyanın kendisi ve kime ait olduğu sabittir: onaylanmış bir belgenin
  -- yolunu değiştirmek, onayı başka bir dosyaya taşımak olurdu.
  new.vendor_id    := old.vendor_id;
  new.uploaded_by  := old.uploaded_by;
  new.storage_path := old.storage_path;

  if new.status is distinct from old.status and new.status <> 'pending' then
    new.reviewed_at := now();
  end if;

  return new;
end;
$$;

create trigger vendor_documents_guard
  before update on public.vendor_documents
  for each row execute function public.tg_vendor_documents_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.vendor_documents enable row level security;

create policy "vendor_documents_own_read"
  on public.vendor_documents for select
  using (public.owns_vendor(vendor_id) or public.is_admin());

create policy "vendor_documents_own_insert"
  on public.vendor_documents for insert
  with check (uploaded_by = auth.uid() and public.owns_vendor(vendor_id));

-- Güncelleme iki gruba açık: satıcı (silmek yerine yeniden yükleyebilsin) ve
-- yönetici. Hangi SÜTUNU değiştirebildiklerini tetikleyici ayırır.
create policy "vendor_documents_update"
  on public.vendor_documents for update
  using (public.owns_vendor(vendor_id) or public.is_admin())
  with check (public.owns_vendor(vendor_id) or public.is_admin());

create policy "vendor_documents_own_delete"
  on public.vendor_documents for delete
  using ((public.owns_vendor(vendor_id) and status = 'pending') or public.is_admin());

revoke all on table public.vendor_documents from public, anon, authenticated;
grant select, insert, update, delete on public.vendor_documents to authenticated;

revoke execute on function public.tg_vendor_documents_guard()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dosyanın kendisi: storage.objects üzerinde RLS
-- ---------------------------------------------------------------------------
-- Yol `<auth.uid()>/...` ile başlar; sahiplik oradan okunur.
create policy "satici_belgeleri_yukle"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'satici-belgeleri'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "satici_belgeleri_oku"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'satici-belgeleri'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

create policy "satici_belgeleri_sil"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'satici-belgeleri'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
