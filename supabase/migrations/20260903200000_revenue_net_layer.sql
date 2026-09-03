-- ===========================================================================
-- GELİR KATMANLARI — brüt, gider, vergi, net
-- ---------------------------------------------------------------------------
-- MEVCUT DURUM KORUNUYOR
-- `payouts` üzerindeki EXPECTED → APPROVED → PAID → CASH RECEIVED zinciri ve
-- tahsilat kanıt kapısı OLDUĞU GİBİ kalıyor. Bu migration onun ÜZERİNE bir
-- katman ekler; hiçbir alanını değiştirmez.
--
-- NEDEN AYRI KATMAN
-- "Hesaba 10.000 EUR geçti" ile "10.000 EUR kazandık" aynı şey değildir.
-- Arada ağ kesintisi, platform ücreti, ödeme ücreti, işletme gideri ve VERGİ
-- vardır. Bunları tek alana indirmek, kendine yalan söylemenin en pahalı
-- hâli: vergi ödenmeden harcanan para.
--
--   CASH RECEIVED  →  − GİDERLER  →  − VERGİ  →  NET
--
-- EN ÖNEMLİ TASARIM KARARI: VERGİ UYDURULAMAZ
-- Bir vergi oranını kod yazarak belirlemek hukuk ve muhasebe işidir; hangi
-- giderin indirilebilir olduğu şirket yapısına ve ülkeye göre değişir.
-- Bu yüzden `tax_provisions` satırı, KAYNAĞI ve ONAYLAYAN KİŞİSİ olmadan
-- şema düzeyinde var olamaz. Sonucu da şu: provizyon girilmeden `net`
-- HESAPLANMAZ -- fonksiyon sayı yerine "insan muhasebe girdisi gerekli"
-- der. Kasıtlı bir sürtünme: tahmini bir net, hiç net olmamasından
-- tehlikelidir.
-- ===========================================================================

-- --- Hedefler --------------------------------------------------------------
-- Hedef KODA GÖMÜLMEZ. Panelde "50.000 USD" sabiti vardı; hedef değişince
-- kod değişmesi gerekiyordu ve hedefin kendisi bir iş kararı, bir sabit
-- değil.
create type public.revenue_period as enum ('haftalik', 'aylik', 'yillik');

create table public.revenue_targets (
  id            uuid primary key default gen_random_uuid(),
  period        public.revenue_period not null,
  currency      char(3) not null,
  amount_cents  bigint not null check (amount_cents > 0),

  -- Hedef değiştiğinde eski satır SİLİNMEZ, yenisi eklenir: geçmiş bir
  -- dönemi eski hedefiyle değerlendirebilmek gerekir.
  effective_from date not null default current_date,
  note          text,
  created_at    timestamptz not null default now(),

  constraint revenue_targets_tek_satir unique (period, currency, effective_from)
);

comment on table public.revenue_targets is
  'Yapilandirilabilir gelir hedefleri. Hedef bir is karari; kodda sabit degil.';

-- --- Giderler --------------------------------------------------------------
create type public.cost_kind as enum (
  'ag_kesintisi',      -- affiliate ağının kendi payı
  'platform_ucreti',   -- barındırma, veritabanı, araçlar
  'odeme_ucreti',      -- transfer/ödeme sağlayıcı masrafı
  'isletme_gideri'     -- diğer doğrulanmış işletme gideri
);

create table public.revenue_costs (
  id            uuid primary key default gen_random_uuid(),
  period_start  date not null,
  period_end    date not null,
  currency      char(3) not null,
  kind          public.cost_kind not null,
  amount_cents  bigint not null check (amount_cents > 0),

  /*
   * KAYNAK VE REFERANS ZORUNLU.
   *
   * Kaynaksız bir gider kalemi, net kârı istediğin sayıya getirmenin en
   * kolay yolu olurdu. Fatura/dekont referansı olmayan gider kabul
   * edilmiyor.
   */
  source        text not null,
  reference     text not null,
  recorded_at   timestamptz not null default now(),

  constraint revenue_costs_donem_tutarli check (period_end >= period_start),
  constraint revenue_costs_kanit_ister check (
    length(trim(source)) > 0 and length(trim(reference)) > 0
  )
);

create index revenue_costs_donem_idx
  on public.revenue_costs (currency, period_start, period_end);

comment on table public.revenue_costs is
  'Dogrulanmis giderler. Kaynak ve referans olmadan satir eklenemez.';

-- --- Vergi provizyonu ------------------------------------------------------
create table public.tax_provisions (
  id            uuid primary key default gen_random_uuid(),
  period_start  date not null,
  period_end    date not null,
  currency      char(3) not null,

  -- Hangi ülkenin vergisi. Şirket yapısına göre değişir; varsayılan YOK.
  tax_country   char(2) not null,

  base_cents    bigint not null check (base_cents >= 0),
  rate          numeric(6,4) not null check (rate >= 0 and rate <= 1),
  amount_cents  bigint not null check (amount_cents >= 0),

  /*
   * İNSAN ONAYI ŞEMA DÜZEYİNDE ZORUNLU.
   *
   * Vergi oranını ve matrahı belirleyen şey mevzuattır, kod değil. Bu
   * satır ancak bir muhasebeci/mali danışman girdisiyle var olabilir:
   * kaynak (hangi hesaplama/belge) ve onaylayan (kim) zorunlu.
   *
   * Bir yapay zeka bu satırı kendi başına üretemez -- üretse bile
   * `approved_by` alanına yazacak doğrulanmış bir insan adı yoktur.
   */
  source        text not null,
  approved_by   text not null,
  approved_at   timestamptz not null default now(),

  note          text,

  constraint tax_provisions_donem_tutarli check (period_end >= period_start),
  constraint tax_provisions_insan_onayi_ister check (
    length(trim(source)) > 0 and length(trim(approved_by)) > 0
  ),
  -- Aynı dönem+para birimi+ülke için tek provizyon.
  constraint tax_provisions_tek_satir
    unique (period_start, period_end, currency, tax_country)
);

comment on table public.tax_provisions is
  'Vergi provizyonu. Kaynak ve onaylayan insan olmadan satir eklenemez; '
  'bu yuzden vergi uydurulamaz ve net kar da uydurulamaz.';

-- --- Net hesabı ------------------------------------------------------------
create or replace function public.net_after_tax(
  p_period_start date,
  p_period_end   date,
  p_currency     char(3)
)
returns jsonb
language plpgsql
stable
security definer
/*
 * search_path BOŞ ve bu, kendi tablolarımızı `public.` ile nitelemeyi
 * ZORUNLU kılıyor -- niteliksiz bir ad sessizce başka bir şeye çözülmek
 * yerine hata verir.
 *
 * Yerleşikler (coalesce, sum, count, jsonb_build_object) niteleneMEZ:
 * `pg_catalog` boş search_path'te bile örtük olarak aranır, ve COALESCE
 * zaten bir fonksiyon değil SQL yapısıdır -- şema nitelemek onu bozar
 * ("function pg_catalog.coalesce(numeric, integer) does not exist" hatası
 * tam olarak bu yüzden alındı, ölçüldü).
 */
set search_path = ''
as $$
declare
  v_brut   bigint;
  v_gider  bigint;
  v_vergi  bigint;
  v_var    boolean;
begin
  if p_period_end < p_period_start then
    return jsonb_build_object(
      'available', false, 'reason', 'gecersiz_donem');
  end if;

  /*
   * BRÜT = TAHSİL EDİLEN, beyan edilen ya da beklenen DEĞİL.
   *
   * Net hesabının tabanı yalnızca hesaba geçmiş paradır. "Ağ bize 10.000
   * borçlu" üzerinden net kâr hesaplamak, henüz gelmemiş parayı harcamaya
   * başlamaktır.
   */
  select coalesce(sum(received_cents), 0)
    into v_brut
    from public.payouts
   where currency = p_currency
     and status = 'tahsil_edildi'
     and received_cents is not null
     and period_start >= p_period_start
     and period_end   <= p_period_end;

  select coalesce(sum(amount_cents), 0)
    into v_gider
    from public.revenue_costs
   where currency = p_currency
     and period_start >= p_period_start
     and period_end   <= p_period_end;

  -- Vergi provizyonu VAR MI? Yoksa net hesaplanmaz.
  select sum(amount_cents), count(*) > 0
    into v_vergi, v_var
    from public.tax_provisions
   where currency = p_currency
     and period_start >= p_period_start
     and period_end   <= p_period_end;

  if not coalesce(v_var, false) then
    /*
     * NET YOK, ÇÜNKÜ VERGİ BİLİNMİYOR.
     *
     * Burada "vergiyi 0 kabul et" demek, brüt tutarı net kâr gibi
     * göstermek olurdu. Brüt ve gider raporlanıyor -- bunlar ölçülmüş
     * gerçekler; net ise açıkça eksik bırakılıyor.
     */
    return jsonb_build_object(
      'available',        false,
      'reason',           'vergi_provizyonu_yok',
      'human_action',     'muhasebe_veya_mali_danisman_girdisi_gerekli',
      'currency',         p_currency,
      'gross_cents',      v_brut,
      'costs_cents',      v_gider,
      'tax_cents',        null,
      'net_after_tax_cents', null);
  end if;

  return jsonb_build_object(
    'available',           true,
    'currency',            p_currency,
    'gross_cents',         v_brut,
    'costs_cents',         v_gider,
    'tax_cents',           v_vergi,
    'net_after_tax_cents', v_brut - v_gider - v_vergi);
end;
$$;

comment on function public.net_after_tax(date, date, char) is
  'Net kar. Vergi provizyonu yoksa sayi DONMEZ: available=false ve insan '
  'muhasebe girdisi gerektigi bildirilir. Brut yalnizca TAHSIL EDILEN paradir.';

-- --- Erişim ----------------------------------------------------------------
-- Üçü de finansal defter: yalnızca sunucu tarafı.
alter table public.revenue_targets enable row level security;
alter table public.revenue_costs   enable row level security;
alter table public.tax_provisions  enable row level security;

revoke all on public.revenue_targets from anon, authenticated;
revoke all on public.revenue_costs   from anon, authenticated;
revoke all on public.tax_provisions  from anon, authenticated;

/*
 * FONKSİYON YETKİSİ: `public` ROLÜNDEN de alınmalı.
 *
 * İlk hâli yalnızca `anon, authenticated`'dan iptal ediyordu ve ÖLÇÜLDÜ:
 * `has_function_privilege('anon', ..., 'EXECUTE')` hâlâ TRUE dönüyordu.
 * Sebep, Postgres'in her yeni fonksiyona EXECUTE hakkını `PUBLIC` rolüne
 * OTOMATİK vermesi -- `anon`, hakkı kendi adına değil PUBLIC üyeliği
 * üzerinden alıyor, dolayısıyla adına yapılan iptal hiçbir şey yapmıyor.
 *
 * Bu, sütun izinlerinde daha önce yaşanan hatanın aynısı: tablo düzeyindeki
 * geniş hak, sütun düzeyindeki iptali eziyordu.
 *
 * Somut sonuç düzeltilmeseydi: SECURITY DEFINER olan bu fonksiyon finansal
 * defteri okuyor. Anonim bir istek /rest/v1/rpc/net_after_tax üzerinden
 * brüt geliri, giderleri ve vergi tutarını okuyabilirdi.
 */
revoke all on function public.net_after_tax(date, date, char) from public;
revoke all on function public.net_after_tax(date, date, char) from anon, authenticated;

/*
 * SUNUCU TARAFINA AÇIK GRANT.
 *
 * `PUBLIC`'ten iptal, `service_role`'ün de örtük hakkını kaldırıyor --
 * yerelde ölçüldü: fonksiyon sunucu tarafından da çağrılamaz hâle geldi.
 * Üretimde çalışıyor görünmesi Supabase'in `service_role`'e verdiği geniş
 * yetkilerden geliyordu; yani uygulamanın çalışması ÖRTÜK bir yola
 * dayanıyordu.
 *
 * Açık grant iki şeyi birden çözüyor: yerel doğrulama ile üretim aynı
 * şekilde davranıyor, ve fonksiyonu kimin çağırabildiği okunabilir tek
 * bir satırda yazıyor.
 */
grant execute on function public.net_after_tax(date, date, char) to service_role;
