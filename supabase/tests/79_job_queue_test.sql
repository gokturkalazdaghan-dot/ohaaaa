-- Kalıcı kuyruk: öncelik, idempotency, geri çekilme, ölü mektup, paralellik.
begin;
select plan(16);

insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template, country_code, terms_verified_at)
values ('kuyruk-m', 'Kuyruk Magaza', 'https://kuy.gecersiz', 'direct', 'active',
        'https://kuy.gecersiz/g?u={url}', 'TR', now());

insert into public.sources (merchant_id, slug, name, kind, endpoint_url, market, currency)
select id, 'kuyruk-feed', 'Kuyruk Feed', 'feed_csv',
       'https://kuy.gecersiz/f.csv', 'TR', 'TRY'
  from public.merchants where slug = 'kuyruk-m';

-- --- 1-3) ÖNCELİK SIRASI --------------------------------------------------
-- Kasten TERS sırada ekleniyor: sıralamayı ekleme sırası değil, öncelik
-- belirlemeli.
select public.enqueue_job('yenile', 'dusuk',  '{}'::jsonb, 'k-dusuk');
select public.enqueue_job('yenile', 'normal', '{}'::jsonb, 'k-normal');
select public.enqueue_job('yenile', 'kritik', '{}'::jsonb, 'k-kritik');
select public.enqueue_job('yenile', 'yuksek', '{}'::jsonb, 'k-yuksek');

select is(
  (select array_agg(idempotency_key order by sira)
     from (select idempotency_key, row_number() over () as sira
             from public.claim_jobs(4, 'yenile')) t),
  array['k-kritik', 'k-yuksek', 'k-normal', 'k-dusuk'],
  '1) isler ekleme sirasina gore DEGIL, oncelige gore aliniyor'
);

select is(
  (select count(*) from public.jobs where kind = 'yenile' and status = 'calisiyor'),
  4::bigint,
  '2) alinan isler "calisiyor" durumuna gecti'
);

select is(
  (select attempt from public.jobs where idempotency_key = 'k-kritik'),
  1,
  '3) alim deneme sayacini artirdi'
);

-- --- 4-5) IDEMPOTENCY -----------------------------------------------------
/*
 * Webhook'lar tekrar gönderilir, cron'lar üst üste binebilir. Anahtar
 * benzersiz olmasaydı aynı fiyat iki kez yazılır, aynı dönüşüm iki kez
 * sayılırdı.
 */
select is(
  public.enqueue_job('yenile', 'kritik', '{}'::jsonb, 'k-kritik'),
  (select id from public.jobs where idempotency_key = 'k-kritik'),
  '4) ayni anahtarla ikinci cagri YENI is yaratmiyor, mevcudu donuyor'
);

select is(
  (select count(*) from public.jobs where idempotency_key = 'k-kritik'),
  1::bigint,
  '5) kuyrukta tek satir kaldi'
);

-- --- 6) ANAHTARSIZ İŞLER SERBEST ------------------------------------------
-- Her işin doğal bir anahtarı yoktur; NULL benzersizliği tetiklemez.
select public.enqueue_job('gunluk', 'normal', '{}'::jsonb, null);
select public.enqueue_job('gunluk', 'normal', '{}'::jsonb, null);

select is(
  (select count(*) from public.jobs where kind = 'gunluk'),
  2::bigint,
  '6) anahtarsiz isler birbirini engellemiyor'
);

-- --- 7-9) GEÇİCİ HATA → ÜSTEL GERİ ÇEKİLME --------------------------------
select is(
  public.fail_job((select id from public.jobs where idempotency_key='k-kritik'),
                  'gecici ag hatasi'),
  'yeniden'::public.job_status,
  '7) gecici hata isi yeniden denemeye alıyor'
);

select ok(
  (select available_at from public.jobs where idempotency_key='k-kritik') > now(),
  '8) yeniden deneme GELECEGE planlandi (geri cekilme uygulandi)'
);

-- Geri çekilme beklerken iş ALINAMAZ: bekleme süresi anlamlı olmalı.
select is(
  (select count(*) from public.claim_jobs(10, 'yenile')
    where idempotency_key = 'k-kritik'),
  0::bigint,
  '9) geri cekilme suresi dolmadan is alinamiyor'
);

-- --- 10) GERİ ÇEKİLME ÜSTEL ARTIYOR ---------------------------------------
/*
 * İkinci başarısızlığın beklemesi birincisinden UZUN olmalı. Sabit
 * gecikme, çöken bir kaynağı aynı hızda dövmeye devam etmek olurdu.
 */
update public.jobs set available_at = now() - interval '1 second'
 where idempotency_key = 'k-kritik';
select public.claim_jobs(1, 'yenile');
select public.fail_job((select id from public.jobs where idempotency_key='k-kritik'), 'yine hata');

select ok(
  (select available_at from public.jobs where idempotency_key='k-kritik')
    > now() + interval '2 seconds',
  '10) ikinci basarisizligin beklemesi daha uzun (ustel)'
);

-- --- 11) KALICI HATA YENİDEN DENENMİYOR -----------------------------------
-- 404 dönen bir adresi beş kez denemek kaynağı boşuna yorar.
select is(
  public.fail_job((select id from public.jobs where idempotency_key='k-yuksek'),
                  '404 bulunamadi', true),
  'basarisiz'::public.job_status,
  '11) kalici hata yeniden denenmiyor'
);

-- --- 12-13) ÖLÜ MEKTUP ----------------------------------------------------
select public.enqueue_job('olu', 'normal', '{}'::jsonb, 'k-olu', null, null, null, 2);

update public.jobs set available_at = now() - interval '1 second' where idempotency_key='k-olu';
select public.claim_jobs(1, 'olu');
select public.fail_job((select id from public.jobs where idempotency_key='k-olu'), 'hata 1');
update public.jobs set available_at = now() - interval '1 second' where idempotency_key='k-olu';
select public.claim_jobs(1, 'olu');

select is(
  public.fail_job((select id from public.jobs where idempotency_key='k-olu'), 'hata 2'),
  'olu_mektup'::public.job_status,
  '12) deneme hakki bitince olu mektup'
);

-- İş SİLİNMİYOR: neyin neden başarısız olduğu kayıtta kalmalı.
select is(
  (select last_error from public.jobs where idempotency_key = 'k-olu'),
  'hata 2',
  '13) olu mektup silinmiyor, son hata korunuyor'
);

-- --- 14) TAMAMLAMA --------------------------------------------------------
update public.jobs set available_at = now() - interval '1 second'
 where idempotency_key = 'k-normal';

select ok(
  public.complete_job((select id from public.jobs where idempotency_key='k-normal')),
  '14) calisan is tamamlanabiliyor'
);

-- --- 15) PARALEL WORKER AYNI İŞİ ALMIYOR ----------------------------------
/*
 * `for update skip locked` kuyruğun kalbi. Aynı işlemde iki ardışık alım,
 * iki worker'ın davranışını taklit eder: ikincisi birincinin aldığını
 * ALMAMALI.
 */
select public.enqueue_job('tek', 'normal', '{}'::jsonb, 'k-tek');

select is(
  (select count(*) from public.claim_jobs(5, 'tek'))
  + (select count(*) from public.claim_jobs(5, 'tek')),
  1::bigint,
  '15) ayni is iki kez alinamiyor'
);

-- --- 16) KUYRUK İSTEMCİYE KAPALI ------------------------------------------
-- Istemcinin is ekleyebilmesi kuyruk zehirleme yolu olurdu.
select ok(
  not exists (
    select 1 from unnest(array['anon','authenticated']) as r(rol)
     where has_table_privilege(r.rol, 'public.jobs', 'SELECT')
        -- İmza kiralama parametreleriyle genişledi (20260903240000).
        -- Test bunu yakaladı: davranış çağrıları varsayılanlarla çalışmaya
        -- devam ediyordu, kırılan yalnızca buradaki imza dizesiydi.
        or has_function_privilege(
             r.rol, 'public.claim_jobs(integer,text,integer,text)', 'EXECUTE')
  ),
  '16) jobs tablosu ve alim fonksiyonu istemci rollerine kapali'
);

select * from finish();
rollback;
