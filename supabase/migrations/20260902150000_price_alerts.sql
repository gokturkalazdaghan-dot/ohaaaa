-- ============================================================================
-- FİYAT DÜŞÜNCE HABER VER
-- ----------------------------------------------------------------------------
-- Favori listesinin bu sitedeki asıl değeri "işaretlediğimden beri ne oldu"
-- sorusuydu ve cevabı yalnızca kullanıcı sayfayı AÇARSA görünüyordu. Oysa
-- fiyat, kimse bakmıyorken düşer. Haber vermek, listenin işini tamamlar.
--
-- YENİ TABLO YOK
-- Kayıt anındaki fiyat zaten `favorites.saved_price_cents` içinde. Ayrı bir
-- "alarm" tablosu açmak aynı bilgiyi iki yerde tutmak ve ikisini ayrı
-- düşürmek olurdu.
--
-- `notify_on_drop` SÜTUN BAZINDA YAZILABİLİR
-- `favorites` üzerinde `authenticated` rolüne UPDATE bilerek verilmemişti:
-- kayıt anındaki fiyat değiştirilememeli. Bu yüzden yetki tabloya değil
-- YALNIZCA BU SÜTUNA veriliyor. Böylece kullanıcı bildirimi kapatabiliyor
-- ama karşılaştırma noktasına dokunamıyor.
--
-- `last_alerted_at` İSTEMCİYE KAPALI
-- Bu sütuna yazma yetkisi verilseydi, kullanıcı değerini geri alıp aynı
-- bildirimi tekrar tetikleyebilirdi. Yalnızca sunucu (service_role) yazar.
-- ============================================================================

alter table public.favorites
  add column if not exists notify_on_drop  boolean not null default true,
  add column if not exists last_alerted_at timestamptz;

comment on column public.favorites.notify_on_drop is
  'Fiyat dususunde e-posta gonderilsin mi. Kullanici degistirebilir (sutun bazinda yetki).';
comment on column public.favorites.last_alerted_at is
  'Son bildirim zamani. YALNIZCA sunucu yazar; istemciye yetki verilmez.';

-- Tarama yalnızca bildirim isteyen ve fiyatı kayıtlı satırlara bakar.
create index if not exists favorites_alert_idx
  on public.favorites (last_alerted_at)
  where notify_on_drop and saved_price_cents is not null;

grant update (notify_on_drop) on public.favorites to authenticated;

-- ---------------------------------------------------------------------------
-- Bildirilecek düşüşler
-- ---------------------------------------------------------------------------
-- Eşik ve bekleme süresi PARAMETRE: kural değişince fonksiyonu yeniden
-- yazmak gerekmesin. Varsayılanlar en az %5 düşüş ve 7 günde bir bildirim --
-- her kuruşluk oynama için e-posta atmak, bildirimi kapattırır.
create or replace function public.pending_price_alerts(
  p_min_drop_ratio numeric default 0.05,
  p_cooldown_days  int     default 7,
  p_limit          int     default 200
)
returns table (
  favorite_id       uuid,
  email             text,
  group_slug        text,
  group_title       text,
  saved_price_cents bigint,
  current_price_cents bigint
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select f.id,
         u.email,
         g.slug,
         g.title,
         f.saved_price_cents,
         g.min_price_cents
    from public.favorites f
    join public.users u          on u.id = f.user_id
    join public.product_groups g on g.id = f.group_id
   where f.notify_on_drop
     and f.saved_price_cents is not null
     and g.min_price_cents is not null
     -- Düşüş, eşiği GEÇMİŞ olmalı: bir kuruşluk fark bildirim değildir.
     and g.min_price_cents <= f.saved_price_cents * (1 - p_min_drop_ratio)
     and (f.last_alerted_at is null
          or f.last_alerted_at < now() - make_interval(days => p_cooldown_days))
   order by f.last_alerted_at asc nulls first
   limit p_limit;
$$;

comment on function public.pending_price_alerts is
  'Bildirim gonderilecek fiyat dususleri. Sunucu tarafi is icindir; istemciye acilmaz.';

-- Kişisel veri döndürür (e-posta + ne işaretlediği): istemciye kapalı.
revoke execute on function public.pending_price_alerts(numeric, int, int)
  from public, anon, authenticated;
grant execute on function public.pending_price_alerts(numeric, int, int) to service_role;
