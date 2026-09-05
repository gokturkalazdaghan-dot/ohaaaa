-- Worker çalışma zamanı: kiralama, yetim kurtarma, kalıcı devre kesici.
begin;
select plan(17);

insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template, country_code, terms_verified_at)
values ('wr-m', 'WR Magaza', 'https://wr.gecersiz', 'direct', 'active',
        'https://wr.gecersiz/g?u={url}', 'TR', now());

insert into public.sources (merchant_id, slug, name, kind, endpoint_url, market, currency)
select id, 'wr-feed', 'WR Feed', 'feed_csv', 'https://wr.gecersiz/f.csv', 'TR', 'TRY'
  from public.merchants where slug = 'wr-m';

-- --- 1-3) KİRALAMA --------------------------------------------------------
select public.enqueue_job('is', 'normal', '{}'::jsonb, 'wr-1');
select public.claim_jobs(1, 'is', 60, 'worker-a');

select ok(
  (select lease_until from public.jobs where idempotency_key='wr-1') > now(),
  '1) alinan is kiralandi'
);

select is(
  (select claimed_by from public.jobs where idempotency_key='wr-1'),
  'worker-a',
  '2) isi hangi workerin aldigi kayitli'
);

select ok(
  public.extend_lease((select id from public.jobs where idempotency_key='wr-1'), 600),
  '3) canli worker kirayi uzatabiliyor'
);

-- --- 4-7) YETİM KURTARMA --------------------------------------------------
/*
 * ÇÖZÜLEN GERÇEK ARIZA.
 *
 * Worker isi alip sonra olurse -- surec coker, konteyner yeniden baslar,
 * Actions calismasi iptal edilir -- is SONSUZA DEK "calisiyor" kalirdi.
 * Kimse almaz, kimse yeniden denemez; kuyruk sessizce sizardi.
 */
update public.jobs set lease_until = now() - interval '1 minute'
 where idempotency_key = 'wr-1';

select is(public.recover_orphaned_jobs(), 1, '4) kirasi dolmus is kurtarildi');

select is(
  (select status from public.jobs where idempotency_key='wr-1'),
  'yeniden'::public.job_status,
  '5) kurtarilan is yeniden denenebilir'
);

select ok(
  (select lease_until from public.jobs where idempotency_key='wr-1') is null,
  '6) kurtarilan isin kirasi temizlendi'
);

-- Kurtarılan iş gerçekten yeniden ALINABİLİR olmalı.
select is(
  (select count(*) from public.claim_jobs(5, 'is', 60, 'worker-b')),
  1::bigint,
  '7) kurtarilan is baska worker tarafindan alinabiliyor'
);

-- --- 8) CANLI KİRA KURTARILMAZ --------------------------------------------
select is(public.recover_orphaned_jobs(), 0, '8) suresi dolmamis kira kurtarilmiyor');

-- --- 9) DENEME SAYACI SIFIRLANMIYOR ---------------------------------------
/*
 * Kurtarma sirasinda sayaci sifirlamak, surekli coken bir isi sonsuza dek
 * yeniden denemek olurdu. Hak biterse normal yolla olu mektuba dusmeli.
 */
select public.enqueue_job('olur', 'normal', '{}'::jsonb, 'wr-olu', null, null, null, 2);
select public.claim_jobs(1, 'olur', 60, 'w');
update public.jobs set lease_until = now() - interval '1 s' where idempotency_key='wr-olu';
select public.recover_orphaned_jobs();
select public.claim_jobs(1, 'olur', 60, 'w');
update public.jobs set lease_until = now() - interval '1 s' where idempotency_key='wr-olu';
select public.recover_orphaned_jobs();

select is(
  (select status from public.jobs where idempotency_key='wr-olu'),
  'olu_mektup'::public.job_status,
  '9) tekrar tekrar yetim kalan is olu mektuba dusuyor'
);

-- --- 10-17) KALICI DEVRE KESİCİ -------------------------------------------
-- Kaydı olmayan kaynak engellenmez: hic hata gormedigimiz bir kaynagi
-- pesinen kapatmak yanlis olurdu.
select ok(
  public.breaker_allows((select id from public.sources where slug='wr-feed')),
  '10) kaydi olmayan kaynak icin devre KAPALI (istek gecer)'
);

-- Eşiğin altında kalan hatalar devreyi açmaz.
select is(
  public.record_breaker_failure((select id from public.sources where slug='wr-feed'), 'e1', 3, 60),
  'kapali'::public.breaker_state,
  '11) esigin altindaki hata devreyi acmiyor'
);

select public.record_breaker_failure((select id from public.sources where slug='wr-feed'), 'e2', 3, 60);

select is(
  public.record_breaker_failure((select id from public.sources where slug='wr-feed'), 'e3', 3, 60),
  'acik'::public.breaker_state,
  '12) esige ulasan hata devreyi ACIYOR'
);

select ok(
  not public.breaker_allows((select id from public.sources where slug='wr-feed')),
  '13) acik devre istegi ENGELLIYOR'
);

-- Açık kalma süresi dolunca YARI AÇIK'a geçip TEK deneme veriyor.
update public.source_breakers set half_open_at = now() - interval '1 second'
 where source_id = (select id from public.sources where slug='wr-feed');

select ok(
  public.breaker_allows((select id from public.sources where slug='wr-feed')),
  '14) sure dolunca yari acik: tek deneme hakki veriliyor'
);

select is(
  (select state from public.source_breakers
    where source_id = (select id from public.sources where slug='wr-feed')),
  'yari_acik'::public.breaker_state,
  '15) durum yari_acik olarak kaydedildi'
);

/*
 * YARI AÇIKKEN BİR HATA DEVREYİ HEMEN AÇAR.
 *
 * Esigi yeniden beklemek, toparlanmamis bir kaynaga esik kadar istek
 * daha gondermek olurdu.
 */
select is(
  public.record_breaker_failure((select id from public.sources where slug='wr-feed'), 'yine', 3, 60),
  'acik'::public.breaker_state,
  '16) yari acikken tek hata devreyi hemen aciyor'
);

-- Başarı devreyi kapatır ve sayacı sıfırlar.
select is(
  public.record_breaker_success((select id from public.sources where slug='wr-feed')),
  'kapali'::public.breaker_state,
  '17) basari devreyi kapatiyor'
);

select * from finish();
rollback;
