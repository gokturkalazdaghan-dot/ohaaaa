-- ingest_runs delta sayaçları: şema kısıtları ve anlam ayrımı.
begin;
select plan(8);

insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template, country_code)
values ('dc-m', 'DC Magaza', 'https://dc.gecersiz', 'direct', 'active',
        'https://dc.gecersiz/g?u={url}', 'TR');

insert into public.sources (merchant_id, slug, name, kind, endpoint_url, market, currency)
select id, 'dc-feed', 'DC Feed', 'feed_csv', 'https://dc.gecersiz/f.csv', 'TR', 'TRY'
  from public.merchants where slug = 'dc-m';

-- --- 1-2) Sütunlar var ve varsayılanları güvenli --------------------------
insert into public.ingest_runs (source_id, status, items_seen)
select id, 'success', 100 from public.sources where slug = 'dc-feed';

select is(
  (select items_unchanged from public.ingest_runs limit 1),
  0,
  '1) delta sayaclari varsayilan 0'
);

/*
 * snapshot_complete VARSAYILANI false VE BU GÜVENLİ TARAF.
 *
 * Bir çalışma bu alanı yazmadan biterse (hata yolu), silme
 * degerlendirilmemis sayilir. Varsayilan true olsaydi, hicbir sey
 * yazmayan bir hata turu "tam goruntu" gibi kaydedilirdi.
 */
select is(
  (select snapshot_complete from public.ingest_runs limit 1),
  false,
  '2) snapshot_complete varsayilani guvenli tarafta (false)'
);

-- --- 3) Gerçek delta sonucu yazılabiliyor ---------------------------------
update public.ingest_runs
   set items_new = 20, items_changed = 15, items_unchanged = 60,
       items_deleted = 5, snapshot_complete = true, items_seen = 95;

select is(
  (select items_new + items_changed + items_unchanged from public.ingest_runs limit 1),
  95,
  '3) NEW + CHANGED + UNCHANGED gorulen kalemle tutarli'
);

select is(
  (select items_deleted from public.ingest_runs limit 1),
  5,
  '4) DELETED ayri sayilir (kaynakta OLMAYAN kayitlar)'
);

-- --- 5) Tutarsız sayaç REDDEDİLİR ----------------------------------------
/*
 * NEW + CHANGED + UNCHANGED gorulen kalemi asamaz. Asarsa sayaclar iki
 * kez artiriliyor demektir -- kimsenin fark etmeyecegi turden bir hata.
 */
select throws_ok(
  $$ update public.ingest_runs set items_new = 500 $$,
  '23514',
  'new row for relation "ingest_runs" violates check constraint "ingest_runs_delta_tutarli"',
  '5) gorulen kalemi asan delta sayaci semada engelli'
);

-- --- 6) Negatif sayaç reddedilir -----------------------------------------
select throws_ok(
  $$ update public.ingest_runs set items_deleted = -1 $$,
  '23514',
  null,
  '6) negatif delta sayaci engelli'
);

-- --- 7-8) ANLAMSAL AYRIM --------------------------------------------------
/*
 * items_deleted = 0 IKI ANLAMA GELEBILIR ve ikisi ayrilmali:
 *   snapshot_complete = true  → gercekten hicbir sey silinmedi
 *   snapshot_complete = false → silmeye HIC BAKILMADI
 */
update public.ingest_runs
   set items_new = 0, items_changed = 0, items_unchanged = 95,
       items_deleted = 0, snapshot_complete = false;

select ok(
  (select items_deleted = 0 and not snapshot_complete from public.ingest_runs limit 1),
  '7) kismi turda items_deleted=0 "bakilmadi" anlamini tasiyabiliyor'
);

update public.ingest_runs set snapshot_complete = true;

select ok(
  (select items_deleted = 0 and snapshot_complete from public.ingest_runs limit 1),
  '8) tam turda items_deleted=0 "silinmedi" anlamini tasiyor'
);

select * from finish();
rollback;
