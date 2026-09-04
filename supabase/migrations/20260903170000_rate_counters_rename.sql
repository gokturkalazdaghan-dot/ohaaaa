-- ============================================================================
-- SAYAÇ GENELLEŞTİRİLDİ — ad, yaptığı işi söylesin
-- ----------------------------------------------------------------------------
-- `ai_rate_counters` / `consume_ai_budget`, mekanizma olarak yapay zekâya
-- özgü hiçbir şey içermiyor: sabit pencereli, kova anahtarlı, atomik bir
-- sayaç. Şimdi aynı sayaç kimlik doğrulama denemelerini de sınırlayacak.
--
-- ADI DEĞİŞTİRİLİYOR ÇÜNKÜ ADIN YANLIŞ OLMASI UCUZ DEĞİL.
-- Bu depoda tam olarak bu hata bir kez yapıldı: `--cyan` adlı bir token
-- TURUNCU değer taşıyordu ve adı, birinin "cyan'ı düzeltmesine" davetti.
-- `consume_ai_budget('auth:ip:...')` çağrısı da okuyana yapay zekâ ile
-- ilgili olmayan bir şeyi yapay zekâ bütçesiymiş gibi gösterirdi.
--
-- Yeniden adlandırma güvenli: fonksiyonun tek çağıranı sunucu tarafındaki
-- `aiBudget.ts` ve tablo üretimde BOŞ (0 satır, ölçüldü).
-- ============================================================================

alter table public.ai_rate_counters rename to rate_counters;
alter index ai_rate_counters_updated_idx rename to rate_counters_updated_idx;

comment on table public.rate_counters is
  'Kova basina sabit pencereli sayac. Yapay zeka cagrilari, kimlik dogrulama denemeleri ve diger hiz sinirlari icin ortak.';

drop function if exists public.consume_ai_budget(text, integer, integer);

create or replace function public.consume_rate_budget(
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pencere int := greatest(1, p_window_seconds);
  v_window  timestamptz;
  v_count   integer;
begin
  -- Sabit pencere: şimdiki zamanı pencere boyuna yuvarla.
  v_window := to_timestamp(floor(extract(epoch from now()) / v_pencere) * v_pencere);

  -- Tek ifadelik UPSERT atomiktir: eşzamanlı iki istek aynı sayıyı okuyup
  -- aynı değeri yazamaz. Sayaç ÖNCE artar, sonra karar verilir; tersi
  -- olsaydı iki istek arasında yarış olur ve sınır sızdırırdı.
  insert into public.rate_counters as c (bucket, window_start, count, updated_at)
  values (p_bucket, v_window, 1, now())
  on conflict (bucket) do update
    set count = case when c.window_start = v_window then c.count + 1 else 1 end,
        window_start = v_window,
        updated_at = now()
  returning c.count into v_count;

  -- Fırsatçı temizlik: IP kovaları sınırsız birikir ve zamanlanmış iş
  -- CRON_SECRET'a bağlı (tanımsız), yani oraya bağlamak hiç çalışmayan bir
  -- temizlik olurdu.
  if random() < 0.001 then
    delete from public.rate_counters where updated_at < now() - interval '7 days';
  end if;

  return jsonb_build_object(
    'allowed',   v_count <= p_limit,
    'limit',     p_limit,
    'used',      v_count,
    'remaining', greatest(0, p_limit - v_count),
    'reset_at',  v_window + make_interval(secs => v_pencere)
  );
end;
$$;

comment on function public.consume_rate_budget(text, integer, integer) is
  'Bir istegi sayar; tavan asildiysa allowed=false doner. Kova anahtarini cagiran belirler.';

revoke all on function public.consume_rate_budget(text, integer, integer) from public;
revoke all on function public.consume_rate_budget(text, integer, integer) from anon, authenticated;
grant execute on function public.consume_rate_budget(text, integer, integer) to service_role;

-- Tablo istemciye kapalı kalmaya devam ediyor (RLS açık, politika yok).
revoke all on table public.rate_counters from public, anon, authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.rate_counters', 'SELECT') then
    raise exception 'BAŞARISIZ: anon sayaci gorebiliyor';
  end if;
  if has_function_privilege('anon', 'public.consume_rate_budget(text, integer, integer)', 'execute') then
    raise exception 'BAŞARISIZ: anon sayaci kendi artirabiliyor';
  end if;
end $$;
