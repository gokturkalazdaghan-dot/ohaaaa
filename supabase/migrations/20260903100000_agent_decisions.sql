-- ============================================================================
-- AJAN KARARLARI VE SONUÇLARI — ölçüm önce, öğrenme sonra
-- ----------------------------------------------------------------------------
-- BU GÖÇ NE YAPMAZ
-- Bir öğrenme modeli kurmaz, ağırlık güncellemez, "akıllı" bir şey yapmaz.
-- Yaptığı tek şey: bir yapay zekâ kararını, o kararın DAYANAĞINI, GÜVENİNİ
-- ve daha sonra GERÇEKTEN NE OLDUĞUNU aynı satırda saklamak.
--
-- NEDEN ÖNCE BU
-- "Ajan öğreniyor" demek, ancak (1) geçmiş veri (2) ölçülebilir sonuç
-- (3) kanıt (4) güven (5) sürüm varsa dürüst bir cümledir. Bunlar olmadan
-- kurulan bir öğrenme döngüsü, kendi uydurduğu sayılarla kendini besler.
--
-- Katalog şu an boş: 0 ürün, 0 tıklama, 0 dönüşüm. Yani şu an öğrenilecek
-- hiçbir şey YOK. Öğrenme katmanını şimdi yazmak, içinden veri geçmeyen bir
-- boru döşemek olurdu. Bunun yerine ölçüm önce kuruluyor; veri biriktiğinde
-- öğrenme bu tablonun ÜSTÜNE yazılır ve o gün gerçek sayılarla doğrulanır.
--
-- BEKLENEN İLE GERÇEK AYNI SATIRDA
-- `expected_outcome` karar anında yazılır, `actual_outcome` sonra. İkisini
-- ayrı tablolara koymak, "tahmin ne kadar tuttu" sorusunu her seferinde bir
-- birleştirmeye çevirirdi -- ve o birleştirme unutulduğunda sistem yalnızca
-- kendi tahminlerini raporlardı.
-- ============================================================================

create type public.agent_kind as enum (
  'search_intent',   -- doğal dil aramasını filtrelere çeviren karar
  'listing_risk',    -- ilan risk motoru (mevcut)
  'visual_search'    -- fotoğraftan ürün terimi
);

create table public.agent_decisions (
  id              uuid primary key default gen_random_uuid(),

  agent           public.agent_kind not null,
  /*
   * Kararı üreten SÜRÜM: model kimliği + istem sürümü.
   *
   * Sürüm olmadan "ajan daha iyi karar vermeye başladı" cümlesi ölçülemez --
   * iyileşme mi oldu, yoksa model mi değişti, ayırt edilemez.
   */
  model           text not null check (length(trim(model)) between 1 and 120),
  prompt_version  text not null check (length(trim(prompt_version)) between 1 and 40),

  /*
   * Kararın girdisi ve çıktısı. Girdi KISALTILIR: arama cümlesi kişisel veri
   * içerebilir ve tam metni süresiz saklamanın bir faydası yok.
   */
  input_digest    text not null check (length(input_digest) <= 300),
  decision        jsonb not null,

  /*
   * Güven ve dayanak. `confidence` null olabilir -- ölçemediğimiz bir güveni
   * uydurmak, sahte güvenin ta kendisi olurdu.
   */
  confidence      numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence        jsonb not null default '{}'::jsonb,

  -- Karar anında ne bekleniyordu (ör. {"sonuc_bekleniyor": true}).
  expected_outcome jsonb not null default '{}'::jsonb,

  -- Sonradan doldurulur. Boş kalması bir eksiklik değil, "henüz ölçülmedi".
  actual_outcome  jsonb,
  measured_at     timestamptz,

  -- Oturum bağı: aynı arama oturumundaki kararlar birbirine bağlanabilsin.
  session_hash    text check (session_hash is null or length(session_hash) <= 64),

  created_at      timestamptz not null default now()
);

comment on table public.agent_decisions is
  'Yapay zeka kararlari: dayanak, guven, beklenen ve GERCEKLESEN sonuc. Ogrenme bu tablonun ustune kurulur.';
comment on column public.agent_decisions.confidence is
  'Olculebiliyorsa 0-1 arasi guven. Olculemiyorsa NULL -- uydurulmaz.';
comment on column public.agent_decisions.actual_outcome is
  'Kararin gercek sonucu. NULL ise henuz olculmedi; basarisiz demek DEGIL.';

create index agent_decisions_agent_idx on public.agent_decisions (agent, created_at desc);
-- "Tahmin ne kadar tuttu" sorgusu yalnızca ölçülmüş satırlara bakar.
create index agent_decisions_measured_idx
  on public.agent_decisions (agent, measured_at desc) where actual_outcome is not null;

-- ---------------------------------------------------------------------------
-- Sonuç YALNIZCA SUNUCUDAN yazılır
-- ---------------------------------------------------------------------------
-- İstemciye yazma yetkisi verilseydi, ajanın performans kaydı ölçtüğü kişi
-- tarafından doldurulabilirdi: "başarı oranı" istemcinin gönderdiği sayıya
-- dönerdi. Bu tablo öğrenmenin kaynağı; kaynağın kirletilebilir olması
-- öğrenmenin kendisini geçersiz kılar.
alter table public.agent_decisions enable row level security;

create policy "agent_decisions_admin_read"
  on public.agent_decisions for select
  using (public.is_admin());

revoke all on table public.agent_decisions from public, anon, authenticated;
grant select on public.agent_decisions to authenticated;   -- RLS admin'e daraltıyor

-- ---------------------------------------------------------------------------
-- Doğruluk özeti — uydurma değil, sayarak
-- ---------------------------------------------------------------------------
-- Panoda "tahmin doğruluğu %84.7" yazabilmek için ÖNCE bu fonksiyonun gerçek
-- satır sayması gerekir. Ölçülmüş karar yoksa null döner ve arayüz "henüz
-- veri yok" der -- sıfırı başarı, boşluğu da yüzde gibi göstermez.
create or replace function public.agent_accuracy(
  p_agent public.agent_kind,
  p_days  int default 30
)
returns table (
  decisions_total    bigint,
  decisions_measured bigint,
  success_rate       numeric,
  avg_confidence     numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    count(*)::bigint,
    count(*) filter (where actual_outcome is not null)::bigint,
    -- Ölçülmüş karar yoksa oran NULL: 0 yazmak "hepsi başarısız" demek olurdu.
    case
      when count(*) filter (where actual_outcome is not null) = 0 then null
      else round(
        count(*) filter (where (actual_outcome ->> 'success')::boolean)::numeric
        / count(*) filter (where actual_outcome is not null),
        4)
    end,
    round(avg(confidence), 4)
  from public.agent_decisions
  where agent = p_agent
    and created_at > now() - make_interval(days => p_days);
$$;

revoke execute on function public.agent_accuracy(public.agent_kind, int)
  from public, anon, authenticated;
grant execute on function public.agent_accuracy(public.agent_kind, int) to service_role;
