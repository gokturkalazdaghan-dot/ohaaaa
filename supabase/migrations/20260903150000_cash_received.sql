-- ============================================================================
-- TAHSİLAT DEFTERİ — "ağ bize borçlu" ile "para hesabımızda" ayrı şeylerdir
-- ----------------------------------------------------------------------------
-- BULUNAN BOŞLUK
-- Para zinciri `conversions.status = 'paid'` satırında bitiyordu. Ama o
-- durum AĞIN BEYANIDIR: "ödedim" diyen taraf, parayı alan taraf değil.
-- Ağ eksik öderse, sonradan iptal ederse ya da hiç ödemezse sistem bunu
-- fark edemezdi. Yani "ne kadar kazandık" sorusunun cevabı, doğrulanmamış
-- bir üçüncü taraf beyanıydı.
--
-- BU GÖÇ NE YAPAR
-- Beyanı tahsilattan ayırır ve ikisinin FARKINI ölçülebilir kılar.
--
--   EXPECTED       -> onaylanmış komisyon toplamı (bizim hesabımız)
--   DECLARED       -> ağın hesap özetinde yazan tutar (ağın beyanı)
--   RECEIVED       -> hesaba GERÇEKTEN geçen tutar (mutabakat)
--
-- BU BİR BANKA ENTEGRASYONU DEĞİLDİR — VE ÖYLEYMİŞ GİBİ SUNULMAZ.
-- `received_cents` elle, hesap özetine bakılarak girilir. Banka API'si
-- bağlanmadığı sürece tahsilatı otomatik doğrulayan bir mekanizma YOKTUR;
-- olmayan bir mekanizmayı varmış gibi göstermektense, kaydın elle
-- girildiğini şemanın kendisi söyler (bkz. reconciled_by / reconciled_at).
--
-- PARA BİRİMLERİ TOPLANMAZ
-- TRY ile EUR'yu toplamak, kur kaynağı ve zaman damgası olmadan uydurma bir
-- sayı üretir. Bu yüzden özet fonksiyonu PARA BİRİMİ BAŞINA satır döner.
-- Tek bir "toplam gelir" sayısı, ancak gerçek bir kur kaynağı bağlandığında
-- ve o kurun kaynağı + zamanı kaydedildiğinde üretilebilir.
-- ============================================================================

create type public.payout_status as enum (
  'beklemede',   -- dönem kapandı, ağdan ödeme bekleniyor
  'beyan_edildi',-- ağ hesap özetini gönderdi (declared_cents dolu)
  'tahsil_edildi',-- para hesaba geçti (received_cents + referans dolu)
  'itirazli'     -- beyan ile hesabımız uyuşmuyor, ağla görüşülüyor
);

create table public.payouts (
  id            uuid primary key default gen_random_uuid(),

  merchant_id   uuid not null references public.merchants (id) on delete restrict,

  -- Mutabakat dönemi. Ağlar aylık kapatır; sınırlar kayıtta durmalı ki
  -- hangi dönüşümün hangi ödemeye ait olduğu sonradan tartışılmasın.
  period_start  date not null,
  period_end    date not null,

  currency      char(3) not null default 'TRY',

  /*
   * ÜÇ TUTAR, ÜÇ AYRI KAYNAK.
   *
   * expected: BİZİM hesabımız -- döneme düşen onaylı komisyonların toplamı.
   * declared: AĞIN beyanı -- hesap özetinde yazan.
   * received: GERÇEKLEŞEN -- hesaba geçen.
   *
   * İkisi de null olabilir: dönem henüz kapanmamış ya da ağ henüz
   * bildirmemiş olabilir. Null "sıfır" DEĞİLDİR; "henüz bilinmiyor"dur.
   */
  expected_cents bigint not null default 0 check (expected_cents >= 0),
  declared_cents bigint check (declared_cents is null or declared_cents >= 0),
  received_cents bigint check (received_cents is null or received_cents >= 0),

  status        public.payout_status not null default 'beklemede',

  -- --- Tahsilat kanıtı ------------------------------------------------------
  -- Bu üçü olmadan bir satır "tahsil edildi" sayılmaz. Kanıtsız tahsilat,
  -- tahmini geliri gerçek gelir gibi göstermenin ta kendisi olurdu.
  payment_provider  text,   -- 'havale', 'paypal', 'wise', ağın adı…
  payment_reference text,   -- dekont/işlem numarası
  payment_date      date,

  /*
   * MUTABAKATI KİM YAPTI, NE ZAMAN.
   *
   * Banka entegrasyonu yok; `received_cents` bir insan tarafından hesap
   * özetine bakılarak girilir. Bunu şemada saklamak yerine görünür kılmak
   * doğru: rakamın arkasında bir otomasyon değil, bir kişi var.
   */
  reconciled_by uuid references public.users (id) on delete set null,
  reconciled_at timestamptz,

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint payouts_period_order check (period_end >= period_start),

  -- Aynı mağaza + aynı dönem iki kez açılamaz: açılsaydı ciro iki katına
  -- çıkardı ve hangisinin doğru olduğu belli olmazdı.
  constraint payouts_merchant_period_key unique (merchant_id, period_start, period_end),

  /*
   * "TAHSİL EDİLDİ" DEMEK İÇİN KANIT ŞART.
   *
   * Bu kısıt olmadan bir satır kanıtsız biçimde tahsil edilmiş sayılabilir
   * ve panoda "Cash Received" olarak görünürdü. Şemanın buna izin vermemesi,
   * arayüzde unutulacak bir kontrolden daha güvenilir.
   */
  constraint payouts_tahsilat_kanit_ister check (
    status <> 'tahsil_edildi' or (
      received_cents is not null
      and payment_reference is not null and length(trim(payment_reference)) > 0
      and payment_date is not null
      and reconciled_at is not null
    )
  )
);

comment on table public.payouts is
  'Odeme donemi: bizim hesabimiz (expected), agin beyani (declared) ve GERCEKLESEN tahsilat (received). Banka entegrasyonu YOKTUR; received elle mutabakatla girilir.';
comment on column public.payouts.received_cents is
  'Hesaba gercekten gecen tutar. NULL = henuz tahsil edilmedi (sifir DEGIL).';
comment on column public.payouts.reconciled_by is
  'Mutabakati yapan kisi. Rakamin arkasinda otomasyon degil insan var.';

create index payouts_merchant_idx on public.payouts (merchant_id, period_end desc);
create index payouts_status_idx on public.payouts (status);

-- ---------------------------------------------------------------------------
-- Hangi dönüşüm hangi ödemede? — atıf tahmine bırakılmaz
-- ---------------------------------------------------------------------------
-- Dönemi tarihe göre sonradan hesaplamak cazip ama kırılgan: ağ bir
-- dönüşümü geç bildirebilir ve o zaman hangi ödemeye girdiği tarihten
-- çıkmaz. Bağ açıkça kurulur.
create table public.payout_conversions (
  payout_id     uuid not null references public.payouts (id) on delete cascade,
  conversion_id uuid not null references public.conversions (id) on delete restrict,

  -- Ödeme anında o dönüşüme düşen komisyon. `conversions.commission_cents`
  -- sonradan düzeltilebilir; ödemenin dayanağı DEĞİŞMEMELİ.
  commission_cents bigint not null check (commission_cents >= 0),

  primary key (payout_id, conversion_id)
);

-- Bir dönüşüm iki ayrı ödemeye giremez: girseydi aynı komisyon iki kez
-- tahsil edilmiş sayılırdı.
create unique index payout_conversions_tek_odeme
  on public.payout_conversions (conversion_id);

comment on table public.payout_conversions is
  'Odeme ile donusum arasindaki kesin bag. Bir donusum yalnizca bir odemeye girer.';

-- ---------------------------------------------------------------------------
-- Güvenlik — tahsilat defteri yalnızca yöneticinin
-- ---------------------------------------------------------------------------
alter table public.payouts enable row level security;
alter table public.payout_conversions enable row level security;

create policy "payouts_admin_all" on public.payouts
  for all using (public.is_admin()) with check (public.is_admin());

create policy "payout_conversions_admin_all" on public.payout_conversions
  for all using (public.is_admin()) with check (public.is_admin());

/*
 * YAZMA YOLU TEK: SUNUCU TARAFI.
 *
 * `authenticated` rolüne yalnızca SELECT veriliyor; INSERT/UPDATE yok.
 * Yani yönetici bile tarayıcıdan tahsilat yazamaz -- kayıt, oturumun
 * rolünü açıkça doğrulayan bir sunucu eylemi üzerinden service_role ile
 * yapılır. Sebep: bu tablo şirketin kasa defteri ve tek bir denetlenebilir
 * kod yolu, dağınık istemci yazmalarından güvenilir.
 *
 * RLS politikası yine de `for all` olarak duruyor: ileride biri yazma
 * yetkisi eklerse, satır düzeyi kural yöneticiyi şart koşmaya devam eder.
 * Bu, yetki katmanından BAĞIMSIZ ikinci savunma.
 */
revoke all on table public.payouts from public, anon, authenticated;
revoke all on table public.payout_conversions from public, anon, authenticated;
grant select on table public.payouts to authenticated;              -- RLS admin'e daraltir
grant select on table public.payout_conversions to authenticated;   -- RLS admin'e daraltir

create or replace function public.tg_payouts_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger payouts_touch before update on public.payouts
  for each row execute function public.tg_payouts_touch();

-- ---------------------------------------------------------------------------
-- revenue_summary — altı ayrı sayı, hiçbiri diğerinin yerine geçmez
-- ---------------------------------------------------------------------------
-- Direktifin ayırmayı istediği kalemler:
--   gmv              : yönlendirdiğimiz satışların cirosu (bizim gelirimiz DEĞİL)
--   pending_cents    : ağın onay bekleyen komisyonu
--   approved_cents   : onaylanmış ama henüz ödenmemiş
--   declared_cents   : ağın hesap özetinde beyan ettiği
--   received_cents   : HESABA GEÇEN -- tek gerçek gelir
--   rejected_cents   : iptal/iade
--
-- `received_cents` YALNIZCA kanıtlı (status='tahsil_edildi') ödemelerden
-- toplanır. Hiç tahsilat yoksa 0 döner ve arayüz bunu "henüz tahsilat yok"
-- diye yazmak zorundadır -- sıfırı "hedefin %0'ı" diye göstermek de dürüst
-- ama "gelir" diye göstermek değildir.
--
-- PARA BİRİMİ BAŞINA SATIR. Toplama yapılmaz: kur kaynağı yok.
create or replace function public.revenue_summary(p_days integer default 30)
returns table (
  currency          char(3),
  gmv_cents         bigint,
  pending_cents     bigint,
  approved_cents    bigint,
  rejected_cents    bigint,
  declared_cents    bigint,
  received_cents    bigint,
  conversions_count bigint,
  payouts_count     bigint,
  received_payouts  bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 3650)));
begin
  if not public.is_admin() then
    raise exception 'OHAAAA_FORBIDDEN: yönetici yetkisi gerekli'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with d as (
    select c.currency,
           coalesce(sum(c.order_total_cents), 0)::bigint as gmv,
           coalesce(sum(c.commission_cents) filter (where c.status = 'pending'), 0)::bigint  as bekleyen,
           coalesce(sum(c.commission_cents) filter (where c.status in ('approved','paid')), 0)::bigint as onayli,
           coalesce(sum(c.commission_cents) filter (where c.status = 'rejected'), 0)::bigint as reddedilen,
           count(*)::bigint as adet
      from public.conversions c
     where c.occurred_at >= v_since
     group by c.currency
  ),
  o as (
    select p.currency,
           coalesce(sum(p.declared_cents), 0)::bigint as beyan,
           -- YALNIZCA kanıtlı tahsilat. Kısıt zaten kanıtsız satırın bu
           -- duruma geçmesini engelliyor; süzgeç ikinci katman.
           coalesce(sum(p.received_cents) filter (where p.status = 'tahsil_edildi'), 0)::bigint as tahsil,
           count(*)::bigint as adet,
           count(*) filter (where p.status = 'tahsil_edildi')::bigint as tahsil_adet
      from public.payouts p
     where p.period_end >= v_since::date
     group by p.currency
  )
  select coalesce(d.currency, o.currency),
         coalesce(d.gmv, 0), coalesce(d.bekleyen, 0), coalesce(d.onayli, 0),
         coalesce(d.reddedilen, 0),
         coalesce(o.beyan, 0), coalesce(o.tahsil, 0),
         coalesce(d.adet, 0), coalesce(o.adet, 0), coalesce(o.tahsil_adet, 0)
    from d full outer join o on o.currency = d.currency
   order by 1;
end;
$$;

comment on function public.revenue_summary is
  'Para birimi basina gelir kalemleri. received_cents yalnizca kanitli tahsilattir. Toplama yapilmaz: kur kaynagi yok.';

revoke all on function public.revenue_summary(integer) from public, anon, authenticated;
grant execute on function public.revenue_summary(integer) to service_role;
