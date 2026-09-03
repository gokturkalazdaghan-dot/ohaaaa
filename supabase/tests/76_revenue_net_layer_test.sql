-- Gelir katmanları: brüt → gider → vergi → net. Vergi uydurulamaz.
begin;
select plan(17);

insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template, country_code)
values
  ('net-magaza', 'Net Magaza', 'https://net.gecersiz', 'manual', 'active',
   'https://net.gecersiz/g?u={url}', 'DE'),
  -- İkinci ve üçüncü satıcı GEREKLİ: payouts benzersizliği
  -- (merchant_id, period_start, period_end) -- yani bir satıcının aynı
  -- dönemde iki ödemesi olamaz. Pratikte doğru, çünkü merchants tek bir
  -- ülkeye (dolayısıyla tek para birimine) bağlı.
  ('net-beyan', 'Net Beyan Magaza', 'https://beyan.gecersiz', 'manual', 'active',
   'https://beyan.gecersiz/g?u={url}', 'DE'),
  ('net-try', 'Net TRY Magaza', 'https://nettry.gecersiz', 'manual', 'active',
   'https://nettry.gecersiz/g?u={url}', 'TR');

-- --- Tahsil edilmiş bir ödeme (mevcut kanıt kapısıyla) ---------------------
insert into public.payouts
  (merchant_id, period_start, period_end, currency,
   expected_cents, declared_cents, received_cents, status,
   payment_provider, payment_reference, payment_date, reconciled_at)
select id, date '2026-09-01', date '2026-09-07', 'EUR',
       1000000, 1000000, 1000000, 'tahsil_edildi',
       'wise', 'WISE-KANIT-1', date '2026-09-08', now()
  from public.merchants where slug = 'net-magaza';

-- --- 1) Vergi provizyonu YOKKEN net HESAPLANMAZ ---------------------------
select is(
  (public.net_after_tax(date '2026-09-01', date '2026-09-07', 'EUR') ->> 'available')::boolean,
  false,
  '1) vergi provizyonu yokken net uretilmiyor'
);

select is(
  public.net_after_tax(date '2026-09-01', date '2026-09-07', 'EUR') ->> 'reason',
  'vergi_provizyonu_yok',
  '2) sebep aciklanmis'
);

select is(
  public.net_after_tax(date '2026-09-01', date '2026-09-07', 'EUR') ->> 'human_action',
  'muhasebe_veya_mali_danisman_girdisi_gerekli',
  '3) insan girdisi gerektigi bildirilmis'
);

-- Brüt yine de raporlanıyor: o ÖLÇÜLMÜŞ bir gerçek.
select is(
  (public.net_after_tax(date '2026-09-01', date '2026-09-07', 'EUR') ->> 'gross_cents')::bigint,
  1000000::bigint,
  '4) brut raporlaniyor (tahsil edilen para)'
);

select ok(
  public.net_after_tax(date '2026-09-01', date '2026-09-07', 'EUR')
    ->> 'net_after_tax_cents' is null,
  '5) net alani BOS, sifir degil'
);

-- --- 6) Kanıtsız gider eklenemez ------------------------------------------
select throws_ok(
  $$ insert into public.revenue_costs
       (period_start, period_end, currency, kind, amount_cents, source, reference)
     values (date '2026-09-01', date '2026-09-07', 'EUR', 'platform_ucreti',
             5000, '', '') $$,
  '23514',
  'new row for relation "revenue_costs" violates check constraint "revenue_costs_kanit_ister"',
  '6) kaynagi ve referansi olmayan gider semada engelli'
);

insert into public.revenue_costs
  (period_start, period_end, currency, kind, amount_cents, source, reference)
values
  (date '2026-09-01', date '2026-09-07', 'EUR', 'platform_ucreti',
   50000, 'Vercel faturasi', 'INV-2026-09-001'),
  (date '2026-09-01', date '2026-09-07', 'EUR', 'odeme_ucreti',
   10000, 'Wise transfer ucreti', 'WISE-FEE-1');

select is(
  (public.net_after_tax(date '2026-09-01', date '2026-09-07', 'EUR') ->> 'costs_cents')::bigint,
  60000::bigint,
  '7) dogrulanmis giderler toplaniyor'
);

-- --- 8) İnsan onayı olmayan vergi provizyonu eklenemez --------------------
select throws_ok(
  $$ insert into public.tax_provisions
       (period_start, period_end, currency, tax_country, base_cents, rate,
        amount_cents, source, approved_by)
     values (date '2026-09-01', date '2026-09-07', 'EUR', 'DE',
             940000, 0.2000, 188000, 'tahmin', '') $$,
  '23514',
  'new row for relation "tax_provisions" violates check constraint "tax_provisions_insan_onayi_ister"',
  '8) onaylayan insani olmayan vergi provizyonu semada engelli'
);

-- --- 9-11) Provizyon girilince net hesaplanıyor ---------------------------
insert into public.tax_provisions
  (period_start, period_end, currency, tax_country, base_cents, rate,
   amount_cents, source, approved_by, note)
values
  (date '2026-09-01', date '2026-09-07', 'EUR', 'DE',
   940000, 0.2000, 188000,
   'Mali danisman hesabi 2026-09', 'mali-danisman',
   'Oran ve matrah danisman tarafindan belirlendi.');

select is(
  (public.net_after_tax(date '2026-09-01', date '2026-09-07', 'EUR') ->> 'available')::boolean,
  true,
  '9) provizyon girilince net hesaplanabiliyor'
);

-- 1.000.000 brüt − 60.000 gider − 188.000 vergi = 752.000
select is(
  (public.net_after_tax(date '2026-09-01', date '2026-09-07', 'EUR')
    ->> 'net_after_tax_cents')::bigint,
  752000::bigint,
  '10) net = brut - gider - vergi'
);

/*
 * BEKLENEN VE BEYAN EDİLEN, NETE GİRMEZ.
 *
 * Ağın "sana 500.000 borçluyum" beyanı net kâr hesabına giremez: o para
 * henüz gelmedi ve gelmeyebilir. Bu iddia tam olarak o karışmayı sınıyor.
 */
insert into public.payouts
  (merchant_id, period_start, period_end, currency,
   expected_cents, declared_cents, status)
select id, date '2026-09-01', date '2026-09-07', 'EUR',
       500000, 500000, 'beyan_edildi'
  from public.merchants where slug = 'net-beyan';

select is(
  (public.net_after_tax(date '2026-09-01', date '2026-09-07', 'EUR') ->> 'gross_cents')::bigint,
  1000000::bigint,
  '11) beyan edilen ama tahsil edilmeyen tutar brute EKLENMIYOR'
);

-- --- 12) Para birimleri karışmıyor ---------------------------------------
insert into public.payouts
  (merchant_id, period_start, period_end, currency,
   expected_cents, received_cents, status,
   payment_provider, payment_reference, payment_date, reconciled_at)
select id, date '2026-09-01', date '2026-09-07', 'TRY',
       9999999, 9999999, 'tahsil_edildi',
       'havale', 'TRY-KANIT-1', date '2026-09-08', now()
  from public.merchants where slug = 'net-try';

select is(
  (public.net_after_tax(date '2026-09-01', date '2026-09-07', 'EUR') ->> 'gross_cents')::bigint,
  1000000::bigint,
  '12) TRY tahsilati EUR brutune karismiyor'
);

-- --- 13) Hedef yapılandırılabilir ----------------------------------------
insert into public.revenue_targets (period, currency, amount_cents, note)
values ('haftalik', 'EUR', 500000, 'Haftalik net hedef');

select is(
  (select amount_cents from public.revenue_targets
    where period = 'haftalik' and currency = 'EUR'),
  500000::bigint,
  '13) hedef veritabaninda, kodda sabit degil'
);

-- --- 14-17) FİNANSAL DEFTER İSTEMCİYE KAPALI -----------------------------
/*
 * BU İDDİALAR BİR HATANIN ANITIDIR.
 *
 * Migration ilk hâlinde fonksiyon yetkisini yalnızca `anon, authenticated`
 * rollerinden iptal ediyordu. Üretimde ölçüldü:
 * has_function_privilege('anon', ...) hâlâ TRUE dönüyordu -- çünkü
 * Postgres her yeni fonksiyona EXECUTE hakkını `PUBLIC` rolüne otomatik
 * verir ve `anon` hakkı PUBLIC üyeliği üzerinden alır. Adına yapılan
 * iptal hiçbir şey yapmıyordu.
 *
 * Düzeltilmeseydi: SECURITY DEFINER olan bu fonksiyon finansal defteri
 * okuyor. Anonim bir istek /rest/v1/rpc/net_after_tax uzerinden brut
 * geliri, giderleri ve vergi tutarini okuyabilirdi.
 */
select ok(
  not has_function_privilege('anon', 'public.net_after_tax(date,date,char)', 'EXECUTE'),
  '14) net_after_tax anon rolune KAPALI (PUBLIC uzerinden de)'
);

select ok(
  not has_function_privilege('authenticated', 'public.net_after_tax(date,date,char)', 'EXECUTE'),
  '15) net_after_tax giris yapmis kullaniciya da kapali'
);

select ok(
  has_function_privilege('service_role', 'public.net_after_tax(date,date,char)', 'EXECUTE'),
  '16) sunucu tarafi calistirmaya devam ediyor'
);

select ok(
  not exists (
    select 1
      from unnest(array['revenue_targets', 'revenue_costs', 'tax_provisions']) as t(tablo)
     cross join unnest(array['anon', 'authenticated']) as r(rol)
     where has_table_privilege(r.rol, 'public.' || t.tablo, 'SELECT')
  ),
  '17) hedef, gider ve vergi tablolari istemci rollerine kapali'
);

select * from finish();
rollback;
