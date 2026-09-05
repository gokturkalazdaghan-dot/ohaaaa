-- Zamanlayıcı: due kaynak seçimi ve SOURCE_SYNC kuyruğa alma.
begin;
select plan(14);

insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template, country_code, terms_verified_at)
values
  ('sch-tr', 'SCH TR', 'https://schtr.gecersiz', 'direct', 'active',
   'https://schtr.gecersiz/g?u={url}', 'TR', now()),
  ('sch-de', 'SCH DE', 'https://schde.gecersiz', 'direct', 'active',
   'https://schde.gecersiz/g?u={url}', 'DE', now());

-- Seed kaynakları karışmasın: bu test yalnızca kendi kaynaklarına bakar.
update public.sources set is_enabled = false;

insert into public.sources
  (merchant_id, slug, name, kind, endpoint_url, market, currency, next_refresh_at)
select m.id, v.slug, v.slug, 'feed_csv', 'https://x.gecersiz/f.csv',
       v.market::public.market, v.cur, v.nra
  from (values
    -- Geçmişte: due
    ('due-tr',    'TR', 'TRY', now() - interval '1 minute', 'sch-tr'),
    -- Gelecekte: due DEĞİL
    ('future-tr', 'TR', 'TRY', now() + interval '1 hour',   'sch-tr'),
    -- Planı hiç yok: due (hiç çalışmamış)
    ('plansiz',   'TR', 'TRY', null,                        'sch-tr'),
    -- Başka pazar, gelecekte
    ('future-de', 'DE', 'EUR', now() + interval '2 hours',  'sch-de')
  ) as v(slug, market, cur, nra, msl)
  join public.merchants m on m.slug = v.msl;

-- --- 1-4) DUE SEÇİMİ ------------------------------------------------------
select is(
  (select count(*) from public.due_sources(100) d
     where d.slug in ('due-tr','future-tr','plansiz','future-de')),
  2::bigint,
  '1) yalnizca gecmis planli ve plansiz kaynaklar due'
);

select ok(
  exists (select 1 from public.due_sources(100) where slug = 'due-tr'),
  '2) plan zamani gecmis kaynak due'
);

/*
 * PLANI OLMAYAN KAYNAK DA DUE.
 *
 * Hic calismamis bir kaynagi beklemek, onu hic calistirmamaktir.
 */
select is(
  (select reason from public.due_sources(100) where slug = 'plansiz'),
  'plan_yok_ilk_calisma',
  '3) plansiz kaynak due ve sebebi yazili'
);

select ok(
  not exists (select 1 from public.due_sources(100) where slug = 'future-tr'),
  '4) gelecekteki plan due DEGIL'
);

-- --- 5) DEVRE DIŞI KAYNAK ADAY DEĞİL --------------------------------------
update public.sources set is_enabled = false where slug = 'due-tr';
select ok(
  not exists (select 1 from public.due_sources(100) where slug = 'due-tr'),
  '5) devre disi kaynak due listesinde yok'
);
update public.sources set is_enabled = true where slug = 'due-tr';

-- --- 6-7) AÇIK DEVRE ADAY DEĞİL -------------------------------------------
insert into public.source_breakers (source_id, state, opened_at, half_open_at)
select id, 'acik', now(), now() + interval '10 minutes'
  from public.sources where slug = 'due-tr';

select ok(
  not exists (select 1 from public.due_sources(100) where slug = 'due-tr'),
  '6) devresi ACIK kaynak due listesinde yok'
);

-- Yarı açık zamanı gelince yeniden aday olur.
update public.source_breakers set half_open_at = now() - interval '1 second'
 where source_id = (select id from public.sources where slug = 'due-tr');

select ok(
  exists (select 1 from public.due_sources(100) where slug = 'due-tr'),
  '7) yari acik zamani gelince kaynak tekrar aday'
);

/*
 * SEÇİM SORGUSUNUN YAN ETKİSİ YOK.
 *
 * `breaker_allows()` durum degistirir (acik → yari_acik); bu yuzden
 * due_sources onu CAGIRMIYOR. Iki kez calistirilan bir secim sorgusu
 * farkli sonuc vermemeli.
 */
select is(
  (select state from public.source_breakers
    where source_id = (select id from public.sources where slug = 'due-tr')),
  'acik'::public.breaker_state,
  '8) due_sources devre durumunu DEGISTIRMIYOR'
);

delete from public.source_breakers;

-- --- 9-11) KUYRUĞA ALMA ---------------------------------------------------
select is(
  (select count(*) from public.schedule_due_sources(100)),
  2::bigint,
  '9) due kaynaklar icin SOURCE_SYNC isi acildi'
);

select is(
  (select count(*) from public.jobs where kind = 'SOURCE_SYNC'),
  2::bigint,
  '10) kuyrukta iki is var'
);

select is(
  (select payload ->> 'source_id' from public.jobs
    where kind = 'SOURCE_SYNC'
      and source_id = (select id from public.sources where slug = 'due-tr')),
  (select id::text from public.sources where slug = 'due-tr'),
  '11) is yuku yalnizca kaynak kimligi tasiyor'
);

-- --- 12) TEKRAR ZAMANLAMA YENİ İŞ AÇMAZ -----------------------------------
/*
 * Iki katmanli koruma: idempotency anahtari plan zamanini iceriyor VE
 * acik bir is varsa yenisi acilmiyor.
 */
select is(
  (select count(*) from public.schedule_due_sources(100)),
  0::bigint,
  '12) ikinci zamanlama turu yeni is ACMIYOR'
);

select is(
  (select count(*) from public.jobs where kind = 'SOURCE_SYNC'),
  2::bigint,
  '13) kuyrukta hala iki is var (yigilma yok)'
);

-- --- 14) PAZAR İZOLASYONU -------------------------------------------------
select ok(
  not exists (
    select 1 from public.jobs j
     where j.kind = 'SOURCE_SYNC'
       and j.source_id = (select id from public.sources where slug = 'future-de')
  ),
  '14) gelecekteki DE kaynagi icin is acilmadi'
);

select * from finish();
rollback;
