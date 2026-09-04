-- ============================================================================
-- YAPAY ZEKÂ BÜTÇESİ — ölçülen ve durdurulabilen maliyet
-- ----------------------------------------------------------------------------
-- BULUNAN AÇIK
-- /arama?q=<12+ karakterlik cümle> ve POST /api/gorsel-arama, HİÇBİR kimlik
-- doğrulaması, hız sınırı veya günlük tavan olmadan bir model çağrısı
-- tetikliyordu. İkisi de herkese açık.
--
-- Yani tek bir betik, döngüye alınmış bir arama adresiyle ANTHROPIC_API_KEY
-- bütçesini saatler içinde tüketebilirdi. Bu bir veri sızıntısı değil,
-- doğrudan FİNANSAL bir hizmet reddi (DoS).
--
-- Depoda hız sınırı mekanizması ZATEN vardı (`consume_api_rate_limit`), ama
-- o sayaç `api_keys.id` yabancı anahtarına bağlı: kimliksiz bir ziyaretçi
-- için kullanılamıyor. Bu yüzden aynı desen, serbest anahtarlı bir sayaçla
-- tekrar ediliyor -- kopya değil, farklı bir anahtar uzayı.
--
-- İKİ AYRI TAVAN, İKİ AYRI SORUN
--   1) KİŞİ BAŞI (ip özeti)  -> tek bir kötü niyetliyi durdurur.
--   2) KÜRESEL GÜNLÜK        -> binlerce farklı IP'den gelen dağıtık kullanımı
--                               ve basit bir talep patlamasını durdurur.
-- Yalnızca birincisi olsaydı, botnet ikinci tavanı hiç görmezdi; yalnızca
-- ikincisi olsaydı tek bir kişi herkesin bütçesini yiyebilirdi.
--
-- SINIR AŞILDIĞINDA NE OLUR?
-- Arama BOZULMAZ: doğal dil çözümü atlanır ve kullanıcının yazdığı metin
-- olduğu gibi aranır. Özellik sessizce kapanır, site çalışmaya devam eder.
-- ============================================================================

create table public.ai_rate_counters (
  /*
   * Serbest biçimli kova anahtarı. Örnekler:
   *   'arama:ip:9f3c...'   -> kişi başı pencere
   *   'arama:global'       -> küresel günlük tavan
   *   'gorsel:ip:9f3c...'
   * Anahtar uzayını kod belirler; veritabanı yalnızca sayar.
   */
  bucket       text primary key check (length(bucket) between 3 and 200),
  window_start timestamptz not null,
  count        integer not null default 0 check (count >= 0),
  updated_at   timestamptz not null default now()
);

comment on table public.ai_rate_counters is
  'Yapay zeka cagrilari icin kova basina sayac. Pencere degisince sifirlanir.';

-- Eskimiş kovaları temizlemek için: bir IP kovası bir daha hiç görülmeyebilir.
create index ai_rate_counters_updated_idx on public.ai_rate_counters (updated_at);

-- RLS açık, HİÇ politika yok = istemciye tamamen kapalı. Sayacı yalnızca
-- sunucu tarafı fonksiyon değiştirir; kullanıcının kendi sayacını
-- sıfırlayabilmesi sınırı anlamsız kılardı.
alter table public.ai_rate_counters enable row level security;
revoke all on table public.ai_rate_counters from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- consume_ai_budget — bir çağrıyı sayar ve izin verilip verilmediğini söyler
-- ---------------------------------------------------------------------------
-- Tek ifadelik UPSERT atomiktir: eşzamanlı iki istek aynı sayıyı okuyup aynı
-- değeri yazamaz. `consume_api_rate_limit` ile aynı gerekçe.
--
-- SAYAÇ ÖNCE ARTAR, SONRA KARAR VERİLİR. Tersi olsaydı (önce oku, sonra yaz)
-- iki istek arasında yarış olurdu ve sınır sızdırırdı.
create or replace function public.consume_ai_budget(
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

  insert into public.ai_rate_counters as c (bucket, window_start, count, updated_at)
  values (p_bucket, v_window, 1, now())
  on conflict (bucket) do update
    set count = case when c.window_start = v_window then c.count + 1 else 1 end,
        window_start = v_window,
        updated_at = now()
  returning c.count into v_count;

  /*
   * Fırsatçı temizlik.
   *
   * IP kovaları sınırsız birikir; ayrı bir zamanlanmış iş kurmak için
   * CRON_SECRET gerekiyor ve o değişken şu an tanımlı değil -- yani
   * temizliği oraya bağlamak, hiç çalışmayan bir temizlik olurdu.
   * Bunun yerine çağrıların binde birinde eski satırlar siliniyor:
   * maliyeti ihmal edilebilir, ve mekanizma hiçbir yapılandırmaya bağlı
   * değil.
   */
  if random() < 0.001 then
    delete from public.ai_rate_counters where updated_at < now() - interval '7 days';
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

comment on function public.consume_ai_budget(text, integer, integer) is
  'Bir yapay zeka cagrisini sayar; tavan asildiysa allowed=false doner.';

-- Yalnızca sunucu tarafı çağırır. İstemciye açmak, sınırı isteyen tarafın
-- sınırı yönetmesi demek olurdu.
revoke all on function public.consume_ai_budget(text, integer, integer) from public;
revoke all on function public.consume_ai_budget(text, integer, integer) from anon, authenticated;
grant execute on function public.consume_ai_budget(text, integer, integer) to service_role;
