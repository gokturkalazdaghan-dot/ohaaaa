-- ===========================================================================
-- programs — ortaklık ağlarından KEŞFEDİLEN programların kaydı
-- ===========================================================================
--
-- NEDEN merchants'IN YANINA AYRI BİR TABLO
--
-- `merchants` BİZİM operasyonel kaydımızdır: trafik gönderdiğimiz ya da
-- göndermeye hazırlandığımız mağaza. Her satırı bir insan ya da bir göç
-- bilerek yazdı ve her alanının bir KANITI var.
--
-- `programs` ise AĞIN SÖYLEDİĞİDİR: katalogda gördüğümüz, çoğunu hiç
-- başvurmayacağımız yüzlerce program. İkisini tek tabloda tutmak,
-- doğrulanmış kayıtla keşfedilmiş kaydı aynı hücrelere koymak olurdu ve
-- `merchants_active_needs_verified_terms` gibi kapıların anlamı kalmazdı:
-- tablo, hiç doğrulanmamış yüzlerce satırla dolardı.
--
-- Bağ `merchant_id` ile kuruluyor ve NULL kalabiliyor: bir program ancak
-- ONAYLANIP onboarding'i yapıldığında bir merchant satırına bağlanır.
-- Yani bu tablo merchants'ı DEĞİŞTİRMİYOR, ÖNÜNE geliyor.
--
-- ---------------------------------------------------------------------------
-- BİLİNMEYEN ALAN NULL'DUR
-- ---------------------------------------------------------------------------
-- Neredeyse her sütun nullable ve bu bir gevşeklik değil, bu tablonun ana
-- kuralı. Bir ağ katalogu komisyonu yayınlamayabilir, ürün sayısını
-- vermeyebilir, feed olup olmadığını söylemeyebilir.
--
-- Boş string, 0 ya da 'UNKNOWN' metni KULLANILMAZ: üçü de bir DEĞER gibi
-- davranır ve puanlamaya, filtreye, rapora sızar. `commission_rate` özellikle
-- önemli -- 0 GEÇERLİ bir orandır (komisyonsuz program) ve "bilmiyoruz" ile
-- aynı hücreye yazılamaz.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENCY: (network, network_program_id)
-- ---------------------------------------------------------------------------
-- Keşif turu saatte bir koşabilir ve aynı programı her turda görür. Tekil
-- kısıt olmadan tablo her turda büyür ve puanlama aynı programı defalarca
-- sayar. Kısıt, `on conflict` ile güncellemenin de dayanağı.
--
-- ---------------------------------------------------------------------------
-- raw: HAM YANIT, AMA SIR TAŞIYAMAZ
-- ---------------------------------------------------------------------------
-- Ağın döndürdüğü ham nesne, normalize ederken kaybettiğimiz alanları
-- sonradan kurtarmak için saklanıyor. İKİ KORUMA:
--   1. Tablo tamamen sunucu tarafı: RLS açık, politika YOK, anon ve
--      authenticated'dan yetki geri alınmış.
--   2. Sağlayıcılar buraya kimlik bilgisi YAZMAZ. API anahtarı, token ve
--      `Authorization` başlığı normalize katmanında ayıklanır; `programs`
--      bir sır deposu değildir ve öyle olsaydı bir SELECT hakkı sızıntıya
--      dönerdi.
-- ===========================================================================

-- --- başvuru durum makinesi (AŞAMA 4 ile birebir) --------------------------
--
-- MANUAL_REQUIRED bir HATA DEĞİL, geçerli bir son durum: ağın API'si
-- başvuruyu desteklemiyorsa insan yapacak ve sistem bunu bilerek
-- kaydediyor. 'REJECTED' ile aynı kefeye koymak, elle yapılabilecek işi
-- kaybedilmiş gibi göstermek olurdu.
create type public.program_application_state as enum (
  'DISCOVERED',
  'ELIGIBLE',
  'APPLICATION_READY',
  'APPLIED',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'MANUAL_REQUIRED'
);

create table public.programs (
  id                    uuid primary key default gen_random_uuid(),

  -- Ağ adı `merchants.network` ile AYNI değer kümesinden gelir; kod
  -- tarafında registry, burada aynı CHECK. İkisi ayrışırsa keşfedilen bir
  -- program hiçbir sağlayıcıyla eşleşmez.
  network               text not null,
  network_program_id    text not null,

  -- Onboarding yapıldığında dolar. NULL = henüz bizim kaydımız yok.
  merchant_id           uuid references public.merchants (id) on delete set null,

  merchant_name         text not null,
  homepage_url          text,
  country_code          char(2) references public.countries (code),
  market_code           text    references public.markets (code),
  currency              char(3) references public.currencies (code),

  -- Oran (0.10 = %10), yüzde DEĞİL. NULL = ağ yayınlamamış.
  commission_rate       numeric(5, 4),
  cookie_window_days    integer,

  feed_available        boolean,
  product_count         integer,
  application_supported boolean,
  deeplink_supported    boolean,

  application_state     public.program_application_state not null default 'DISCOVERED',
  /** Ağdaki ham durum metni (ör. 'joined'). Normalize EDİLMEZ: ağa özgü. */
  network_status        text,
  terms                 text,

  /** Ham ağ yanıtı. Sır TAŞIMAZ; gerekçesi dosya başındaki nota bakınız. */
  raw                   jsonb,

  first_seen_at         timestamptz not null default now(),
  last_verified_at      timestamptz not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint programs_network_known
    check (network = any (array['direct'::text, 'awin'::text])),

  -- Aynı ağda aynı program iki kez kaydedilemez. Keşfin idempotency
  -- dayanağı budur; olmadan her tur tabloyu büyütürdü.
  constraint programs_network_program_unique unique (network, network_program_id),

  constraint programs_commission_rate_range
    check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 0.9)),
  constraint programs_cookie_window_positive
    check (cookie_window_days is null or cookie_window_days > 0),
  constraint programs_product_count_non_negative
    check (product_count is null or product_count >= 0),

  -- Ağın kendi kimliği boş olamaz: idempotency anahtarının yarısı.
  constraint programs_network_program_id_not_blank
    check (length(btrim(network_program_id)) > 0),
  constraint programs_merchant_name_not_blank
    check (length(btrim(merchant_name)) > 0),

  -- Bir program ONAYLI ise bir ağ programına bağlı olmalı; onaysız
  -- keşiflerde merchant bağı beklenmiyor.
  constraint programs_first_seen_before_verified
    check (last_verified_at >= first_seen_at)
);

comment on table public.programs is
  'Ortaklik aglarindan kesfedilen programlar. merchants BIZIM operasyonel '
  'kaydimiz; programs AGIN SOYLEDIGI. Bag merchant_id ile ve yalnizca '
  'onboarding sonrasi kurulur.';

comment on column public.programs.commission_rate is
  'Oran (0.10 = %10). NULL = ag yayinlamamis. 0 GECERLI bir orandir ve '
  '"bilinmiyor" ile ayni hucreye yazilamaz.';

comment on column public.programs.raw is
  'Ham ag yaniti. SIR TASIMAZ: API anahtari/token normalize katmaninda '
  'ayiklanir.';

-- --- indeksler --------------------------------------------------------------
-- Keşif turu ve puanlama en çok bu üç soruyu sorar: "bu ağda ne var",
-- "hangileri onaylandı", "hangileri bayat".
create index programs_network_state_idx
  on public.programs (network, application_state);

create index programs_last_verified_idx
  on public.programs (last_verified_at);

-- Onboarding yapılmış programlar; kısmi çünkü çoğu satır NULL kalacak.
create index programs_merchant_idx
  on public.programs (merchant_id)
  where merchant_id is not null;

-- --- updated_at ------------------------------------------------------------
create trigger programs_set_updated_at
  before update on public.programs
  for each row execute function public.tg_set_updated_at();

-- --- yetkiler: TAMAMEN SUNUCU TARAFI ---------------------------------------
--
-- RLS açık ve POLİTİKA YOK: bu, anon ve authenticated için deny-all demek.
-- `programs` iş istihbaratıdır -- hangi ağlarda ne var, hangi komisyonlar,
-- hangi başvurular beklemede. Vitrine açılacak bir şey değil.
alter table public.programs enable row level security;
revoke all on public.programs from anon, authenticated;
grant select, insert, update, delete on public.programs to service_role;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_sayi integer;
begin
  -- 1) Tablo ve tekil kısıt var.
  if to_regclass('public.programs') is null then
    raise exception 'DOGRULAMA 1: programs tablosu olusmadi.';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.programs'::regclass
       and conname = 'programs_network_program_unique'
  ) then
    raise exception 'DOGRULAMA 2: idempotency kisiti yok -- kesif her turda tabloyu buyuturdu.';
  end if;

  -- 3) Bilinmeyen alanlar NULL olabilmeli: keşif çoğu alanı getiremez.
  select count(*) into v_sayi
    from information_schema.columns
   where table_schema = 'public' and table_name = 'programs'
     and column_name in ('commission_rate','cookie_window_days','feed_available',
                         'product_count','currency','country_code','market_code')
     and is_nullable = 'NO';
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 3: % alan NOT NULL -- bilinmeyen deger uydurulmak zorunda kalinirdi.', v_sayi;
  end if;

  -- 4) Tablo istemciye KAPALI. Acik olsaydi is istihbarati disari sizardi.
  if has_table_privilege('anon', 'public.programs', 'select')
     or has_table_privilege('authenticated', 'public.programs', 'select') then
    raise exception 'DOGRULAMA 4: programs istemci rollerine acik.';
  end if;

  if not has_table_privilege('service_role', 'public.programs', 'select') then
    raise exception 'DOGRULAMA 5: service_role programs okuyamiyor.';
  end if;

  -- 6) RLS acik ve politika YOK (deny-all).
  if not (select relrowsecurity from pg_class where oid = 'public.programs'::regclass) then
    raise exception 'DOGRULAMA 6: programs uzerinde RLS kapali.';
  end if;

  raise notice
    'programs tablosu kuruldu: (network, network_program_id) tekil, '
    'bilinmeyen alanlar NULL kalabiliyor, tablo istemciye kapali.';
end $$;
