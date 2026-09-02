-- ============================================================================
-- FAVORİLER — cihazda değil hesapta
-- ----------------------------------------------------------------------------
-- Favoriler yalnızca tarayıcının localStorage'ında duruyordu. Telefonda
-- işaretlenen ürün bilgisayarda yok; geçmiş temizlenince ya da gizli sekmede
-- liste tümden kayboluyordu. Bir fiyat karşılaştırma sitesinde bu, özelliğin
-- asıl değerini yok eder: "işaretlediğimden beri fiyatı ne oldu" sorusu,
-- listenin haftalarca yaşamasını gerektirir.
--
-- ÜRÜN GRUBU İŞARETLENİR, TEKLİF DEĞİL
-- Favori `product_groups` satırına bağlanır, tek bir satıcının teklifine
-- değil. Sebebi bu sitenin varlık sebebiyle aynı: kullanıcı "Sony WH-1000XM5"
-- işaretler, "Teknomarkt'ın Sony WH-1000XM5 ilanı"nı değil. Teklife
-- bağlasaydık o satıcı ürünü kaldırdığında favori de silinir, oysa aynı ürünü
-- satan beş mağaza daha duruyor olabilir.
--
-- KAYIT ANINDAKİ FİYAT
-- `saved_price_cents`, işaretlendiği andaki en düşük toplam fiyattır ve
-- SONRADAN GÜNCELLENMEZ. Karşılaştırma noktası olması gereken bir sayıyı
-- güncel tutmak, karşılaştırmayı imkânsız kılardı.
-- ============================================================================

create table public.favorites (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  group_id          uuid not null references public.product_groups (id) on delete cascade,

  saved_price_cents bigint check (saved_price_cents is null or saved_price_cents >= 0),

  created_at        timestamptz not null default now(),

  -- Aynı ürün iki kez işaretlenemez. Kuralı veritabanına koymak, iki sekmeden
  -- aynı anda basıldığında da tutmasını sağlar.
  constraint favorites_user_group_key unique (user_id, group_id)
);

comment on table public.favorites is
  'Kullanicinin isaretledigi urun gruplari. saved_price_cents kayit anindaki fiyattir, guncellenmez.';

create index favorites_user_idx on public.favorites (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Ne işaretlediğiniz kişisel bir veridir: ilgi alanınızı, bütçenizi ve neyi
-- almak üzere olduğunuzu söyler. Satıcı da göremez.
alter table public.favorites enable row level security;

create policy "favorites_own_all"
  on public.favorites for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.favorites from public, anon, authenticated;
grant select, insert, delete on public.favorites to authenticated;
