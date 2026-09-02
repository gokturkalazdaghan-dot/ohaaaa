-- ============================================================================
-- ADRES DEFTERİ — aynı adresi her siparişte yeniden yazmamak için
-- ----------------------------------------------------------------------------
-- Adres bugüne kadar yalnızca `orders.shipping_address` içinde, siparişin
-- ANLIK GÖRÜNTÜSÜ olarak duruyordu. O alan orada kalmalı: bir sipariş, o gün
-- hangi adrese gönderildiyse onunla anılmalı. Sonradan adres defterindeki
-- kayıt düzeltilirse eski siparişin gittiği yer değişmiş görünmemeli.
--
-- Ama anlık görüntü, "bir dahaki sefere de aynı yere gönder" ihtiyacını
-- karşılamıyor: alıcı her alışverişte ad, telefon, il, ilçe ve açık adresi
-- baştan yazıyordu. Bu tablo o tekrarı bitirir; siparişe yazılan alan yine
-- kopyadır, bağ değil.
--
-- ALANLAR checkoutSchema İLE BİREBİR
-- Ödeme formunun doğruladığı alan adları neyse tablo da onları taşır
-- (full_name, phone, city, district, address_line, postal_code). Ayrı isimler
-- kullansaydım her okuma ve yazmada bir çeviri katmanı gerekirdi ve o
-- katmandaki tek bir yazım hatası, adresi sessizce eksik kaydederdi.
-- ============================================================================

create table public.addresses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,

  -- Kullanıcının kendi verdiği ad: "Ev", "İş". Zorunlu değil; boşsa arayüz
  -- ili gösterir.
  label         text check (label is null or length(trim(label)) between 1 and 40),

  full_name     text not null check (length(trim(full_name)) between 3 and 120),
  phone         text not null check (length(trim(phone)) between 10 and 30),
  city          text not null check (length(trim(city)) between 2 and 60),
  district      text not null check (length(trim(district)) between 2 and 60),
  address_line  text not null check (length(trim(address_line)) between 10 and 500),
  postal_code   text check (postal_code is null or length(trim(postal_code)) <= 10),

  is_default    boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.addresses is
  'Alicinin kayitli teslimat adresleri. Siparise yazilan adres bu satirin KOPYASIDIR, bagi degil.';

create index addresses_user_idx on public.addresses (user_id, created_at desc);

-- Kullanıcı başına EN FAZLA BİR varsayılan. Kısmi benzersiz dizin, kuralı
-- uygulamaya değil veritabanına yaptırır: iki sekmede aynı anda "varsayılan
-- yap" denirse ikisi de geçseydi, ödeme formu hangisini seçeceğini bilemezdi.
create unique index addresses_one_default_idx
  on public.addresses (user_id) where is_default;

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Varsayılan devri — uygulama değil, veritabanı yapar
-- ---------------------------------------------------------------------------
-- Yukarıdaki dizin ikinci varsayılanı REDDEDER; tek başına kalsaydı kullanıcı
-- "bunu varsayılan yap" dediğinde hata alırdı. Doğru davranış reddetmek değil,
-- eskisini bırakmaktır. Tetikleyici bunu yazma yolu ne olursa olsun yapar:
-- ödeme formu, adres sayfası ya da ileride bir mobil istemci.
create or replace function public.tg_addresses_single_default()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.is_default then
    update public.addresses
       set is_default = false
     where user_id = new.user_id
       and id <> new.id
       and is_default;
  end if;
  return new;
end;
$$;

create trigger addresses_single_default
  before insert or update on public.addresses
  for each row execute function public.tg_addresses_single_default();

-- ---------------------------------------------------------------------------
-- RLS — adres, kişisel veridir
-- ---------------------------------------------------------------------------
-- Ad, telefon ve açık adres bir arada; KVKK anlamında kimliği doğrudan
-- belirleyen veri. Satıcı bile buradan okumaz: satıcının göreceği adres,
-- kendisine düşen siparişin üzerindeki kopyadır.
alter table public.addresses enable row level security;

create policy "addresses_own_all"
  on public.addresses for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "addresses_admin_read"
  on public.addresses for select
  using (public.is_admin());

revoke all on table public.addresses from public, anon, authenticated;
grant select, insert, update, delete on public.addresses to authenticated;

revoke execute on function public.tg_addresses_single_default()
  from public, anon, authenticated;
