-- ===========================================================================
-- API hiz siniri — sunucusuz ortamda calisan sayac
-- ---------------------------------------------------------------------------
-- NEDEN
-- Taseron API'si Express uygulamasindan Next route handler'larina tasindi.
-- Eski hiz siniri sayaci SURECIN BELLEGINDEYDI. Sunucusuz ortamda her istek
-- ayri bir ornekte calisabilir; bellekteki sayac orada sifirdan baslar.
-- Yani sinir gorunurde vardi ama uygulanmiyordu: 60/dk sinirli bir anahtarla
-- yeterince paralel istek atan biri bu sinirin kat kat ustune cikabilirdi.
--
-- Sayac, tum ornekler icin tek dogruluk kaynagi olan veritabaninda tutulur.
--
-- TASARIM
-- Anahtar basina TEK satir. Pencere degistiginde sayac sifirlanir; boylece
-- tablo kendiliginden temizlenir, ayri bir toplama isine gerek kalmaz.
-- Sabit pencere (fixed window) secildi: kayan pencereye gore daha kaba ama
-- tek satirlik atomik bir UPSERT'e sigar. Kotuye kullanimi durdurmak icin
-- yeterli; amac adil kullanim, milisaniye hassasiyeti degil.
-- ===========================================================================

create table if not exists public.api_rate_counters (
  api_key_id   uuid primary key references public.api_keys (id) on delete cascade,
  window_start timestamptz not null,
  count        integer not null default 0
);

comment on table public.api_rate_counters is
  'Anahtar basina dakikalik istek sayaci. Pencere degisince sifirlanir.';

-- Anahtar sahibi bile bu tabloyu okuyamaz/yazamaz: sayaci yalnizca sunucu
-- tarafi fonksiyon degistirir. RLS acik ve HIC politika yok = herkese kapali.
alter table public.api_rate_counters enable row level security;

-- ---------------------------------------------------------------------------
-- consume_api_rate_limit — bir istegi sayar ve izin verilip verilmedigini soyler
-- ---------------------------------------------------------------------------
-- Tek ifadelik UPSERT atomiktir: ayni anda gelen iki istek ayni sayiyi
-- okuyup ayni degeri yazamaz.
create or replace function public.consume_api_rate_limit(
  p_api_key_id uuid,
  p_limit      integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count  integer;
begin
  insert into public.api_rate_counters as c (api_key_id, window_start, count)
  values (p_api_key_id, v_window, 1)
  on conflict (api_key_id) do update
    set count = case when c.window_start = v_window then c.count + 1 else 1 end,
        window_start = v_window
  returning c.count into v_count;

  return jsonb_build_object(
    'allowed',   v_count <= p_limit,
    'limit',     p_limit,
    -- Sinir asildiginda negatif kalan gostermemek icin taban 0.
    'remaining', greatest(0, p_limit - v_count),
    'reset_at',  v_window + interval '1 minute'
  );
end;
$$;

comment on function public.consume_api_rate_limit(uuid, integer) is
  'Bir API istegini sayar; sinir asildiysa allowed=false doner.';

-- Yalnizca sunucu tarafi (service_role) cagirir. Anahtar sahibinin kendi
-- sayacini artirabilmesi ya da sifirlayabilmesi icin bir sebep yok.
revoke all on function public.consume_api_rate_limit(uuid, integer) from public;
revoke all on function public.consume_api_rate_limit(uuid, integer) from anon, authenticated;
