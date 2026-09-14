-- ============================================================================
-- ÇOK AĞLI ORTAKLIK — `networks` REFERANS TABLOSU
--
-- ⚠️  ÜRETİMDE ÇALIŞTIRILMADI. Hazırlandı, incelemeye bırakıldı.
--
-- NEDEN
-- `merchants.network` bugün bir CHECK kısıtıyla sabitlenmiş durumda:
--   check (network in ('direct', 'awin'))
-- (göç 20260904100000). Yeni bir ağ eklemek -- CJ, Rakuten, Admitad,
-- Tradedoubler, Impact, Partnerize -- kısıtı değiştiren bir GÖÇ gerektiriyor.
-- Yani "yeni ortaklık ağı" operasyonel bir iş değil, dağıtım işi.
--
-- Aynı hata `markets` ve `currencies` için zaten çözüldü: referans tablosu +
-- yabancı anahtar. Bu göç aynı deseni ortaklık ağlarına uyguluyor.
--
-- ÖLÇÜLEN DURUM: 28 mağazanın tamamı network='awin'. Veri kaybı yok,
-- dönüşüm tek satırlık bir tohumdan ibaret.
-- ============================================================================

create table if not exists public.affiliate_networks (
  code         text primary key,
  display_name text not null,

  /*
   * `direct` bir AĞ DEĞİL, ağın YOKLUĞU -- mağazanın kendi programı.
   * Ayrı bir bayrakla işaretleniyor ki "ağ üzerinden mi geldi" sorusu
   * kod içinde ada göre değil VERİYE göre cevaplanabilsin.
   */
  is_direct    boolean not null default false,

  /* Ağın ortaklık paneli. Keşif ve başvuru akışı buradan başlar. */
  portal_url   text,

  /*
   * Başvuru otomasyona uygun mu? NULL = henüz bilinmiyor.
   * Tahmin yerine NULL: "denenmedi" ile "denendi, olmuyor" ayrı şeyler.
   */
  application_automatable boolean,

  is_active    boolean not null default true,
  notes        text,
  created_at   timestamptz not null default now(),

  constraint affiliate_networks_code_bicimi check (code ~ '^[a-z][a-z0-9_]{1,31}$')
);

comment on table public.affiliate_networks is
  'Ortaklik aglari. Yeni ag = BIR SATIR; kod degisikligi ve dagitim yok.';

alter table public.affiliate_networks enable row level security;

/*
 * OKUMA HERKESE AÇIK DEĞİL. Ağ listesi ticari bilgi: hangi ağlarla
 * çalıştığımız ve hangisine başvurulabildiği rakip için değerlidir.
 * Yalnızca yönetim okur; katalog bu tabloya hiç bakmıyor.
 */
drop policy if exists affiliate_networks_admin_all on public.affiliate_networks;
create policy affiliate_networks_admin_all
  on public.affiliate_networks for all
  using (public.is_admin()) with check (public.is_admin());

grant select on public.affiliate_networks to authenticated;

insert into public.affiliate_networks (code, display_name, is_direct, portal_url) values
  ('direct', 'Dogrudan program', true,  null),
  ('awin',   'Awin',             false, 'https://ui.awin.com/')
on conflict (code) do nothing;

/*
 * CHECK KISITI YABANCI ANAHTARLA DEĞİŞTİRİLİYOR.
 *
 * Koruma zayıflamıyor, aksine güçleniyor: CHECK yalnızca yazılı iki değeri
 * biliyordu, yabancı anahtar ise tabloda GERÇEKTEN var olan her kodu kabul
 * eder ve olmayanı reddeder. Fark, yeni kod eklemenin göç değil satır
 * olması.
 */
alter table public.merchants
  drop constraint if exists merchants_network_known;

alter table public.merchants
  drop constraint if exists merchants_network_fkey;

alter table public.merchants
  add constraint merchants_network_fkey
  foreign key (network) references public.affiliate_networks (code);

comment on column public.merchants.network is
  'Ortaklik agi kodu. affiliate_networks(code) yabanci anahtari; '
  'yeni ag eklemek icin GOC DEGIL satir yeterli.';

-- ---------------------------------------------------------------------------
-- GERİ ALMA
-- ---------------------------------------------------------------------------
-- alter table public.merchants drop constraint if exists merchants_network_fkey;
-- alter table public.merchants add constraint merchants_network_known
--   check (network in ('direct', 'awin'));
-- drop table if exists public.affiliate_networks;
