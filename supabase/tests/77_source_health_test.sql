-- Kaynak sağlığı ve alarmlar: sessiz başarısızlık mümkün olmamalı.
begin;
select plan(16);

-- --- 1) HİÇ KAYNAK YOKKEN ALARM VAR ---------------------------------------
/*
 * ÜRETİMDEKİ GERÇEK DURUM BU.
 *
 * Denetimde ölçüldü: sources = 0, ingest_runs = 0 ve sistem sessizdi.
 * "Veri yok" bir başlangıç durumu sanılıp beklenmişti; oysa kaynak
 * tanımlanmadan katalog ASLA dolamaz.
 */
-- Seed verisi kaynak iceriyor; onkosul islem icinde kuruluyor ve
-- `rollback` ile geri aliniyor.
update public.sources set is_enabled = false;

select ok(
  exists (select 1 from public.system_alerts() where code = 'NO_ENABLED_SOURCE'),
  '1) hic etkin kaynak yokken kritik alarm uretiliyor'
);

select is(
  (select severity from public.system_alerts() where code = 'NO_ENABLED_SOURCE'),
  'critical',
  '2) siddet kritik'
);

-- --- Zemin: bir satıcı ve bir kaynak --------------------------------------
insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template, country_code)
values
  ('saglik-m', 'Saglik Magaza', 'https://sag.gecersiz', 'direct', 'active',
   'https://sag.gecersiz/g?u={url}', 'TR');

insert into public.sources
  (merchant_id, slug, name, kind, endpoint_url, market, currency)
select id, 'saglik-feed', 'Saglik Feed', 'feed_csv',
       'https://sag.gecersiz/f.csv', 'TR', 'TRY'
  from public.merchants where slug = 'saglik-m';

select ok(
  not exists (select 1 from public.system_alerts() where code = 'NO_ENABLED_SOURCE'),
  '3) kaynak tanimlaninca o alarm susuyor'
);

-- --- 4-5) HİÇ ÇALIŞMAMIŞ KAYNAK -------------------------------------------
select is(
  (select state from public.source_health() where source_slug = 'saglik-feed'),
  'hic_calismadi'::public.source_health_state,
  '4) hic calismamis kaynak "hic_calismadi" durumunda'
);

select ok(
  exists (
    select 1 from public.system_alerts()
     where code = 'INGESTION_NEVER_RAN' and subject = 'saglik-feed'
       and severity = 'critical'
  ),
  '5) hic calismamis kaynak KRITIK alarm uretiyor'
);

-- --- 6) Devre dışı kaynak alarm üretmez -----------------------------------
-- Kapatılmış bir kaynağın çalışmaması arıza değil, karardır.
update public.sources set is_enabled = false where slug = 'saglik-feed';

select ok(
  not exists (select 1 from public.source_health() where source_slug = 'saglik-feed'),
  '6) devre disi kaynak saglik listesinde yok'
);

update public.sources set is_enabled = true where slug = 'saglik-feed';

-- --- 7-8) BAŞARISIZ ÇALIŞMA -----------------------------------------------
insert into public.ingest_runs (source_id, status, started_at, finished_at)
select id, 'failed', now() - interval '1 hour', now() - interval '1 hour'
  from public.sources where slug = 'saglik-feed';

update public.sources
   set last_run_at = now() - interval '1 hour',
       last_status = 'failed',
       last_error = 'Feed 503 dondu',
       last_item_count = 0
 where slug = 'saglik-feed';

select is(
  (select state from public.source_health() where source_slug = 'saglik-feed'),
  'basarisiz'::public.source_health_state,
  '7) son calismasi hata veren kaynak "basarisiz"'
);

select is(
  (select detail from public.system_alerts()
    where code = 'SOURCE_FAILED' and subject = 'saglik-feed'),
  'Feed 503 dondu',
  '8) alarm gercek hata metnini tasiyor'
);

-- --- 9-10) BAYAT KAYNAK ---------------------------------------------------
-- Eşiğin (varsayılan 720 dk) ötesinde çalışmamış ama hata da vermemiş.
update public.sources
   set last_run_at = now() - interval '30 hours',
       last_status = 'success',
       last_error = null,
       last_item_count = 120
 where slug = 'saglik-feed';

select is(
  (select state from public.source_health() where source_slug = 'saglik-feed'),
  'bayat'::public.source_health_state,
  '9) esigin otesinde calismamis kaynak "bayat"'
);

select ok(
  exists (select 1 from public.system_alerts()
           where code = 'SOURCE_STALE' and subject = 'saglik-feed'),
  '10) bayat kaynak alarm uretiyor'
);

-- --- 11) TEK GECİKME ALARM ÜRETMEZ ----------------------------------------
/*
 * Her geçici ağ hatasında alarm çalan bir sistem kısa sürede görmezden
 * gelinir. Eşik iki ardışık çalışmanın kaçırılması; bir tanesi değil.
 */
update public.sources set last_run_at = now() - interval '7 hours'
 where slug = 'saglik-feed';

select is(
  (select state from public.source_health() where source_slug = 'saglik-feed'),
  'saglikli'::public.source_health_state,
  '11) tek bir calismanin gecikmesi alarm uretmiyor'
);

-- --- 12-13) BOŞ FEED ------------------------------------------------------
/*
 * "Başarılı" dönen ama BOŞ bir feed sağlıklı değildir: katalog sessizce
 * boşalır ve durum kodu bunu göstermez. Sessiz veri kaybının tam hâli bu.
 */
update public.sources
   set last_run_at = now() - interval '1 hour',
       last_status = 'success',
       last_item_count = 0
 where slug = 'saglik-feed';

select is(
  (select state from public.source_health() where source_slug = 'saglik-feed'),
  'yavas'::public.source_health_state,
  '12) basarili ama BOS donen feed saglikli sayilmiyor'
);

select ok(
  exists (select 1 from public.system_alerts()
           where code = 'EMPTY_FEED' and subject = 'saglik-feed'),
  '13) bos feed alarm uretiyor'
);

-- --- 14) SAĞLIKLI DURUM ---------------------------------------------------
update public.sources set last_item_count = 250 where slug = 'saglik-feed';

select is(
  (select state from public.source_health() where source_slug = 'saglik-feed'),
  'saglikli'::public.source_health_state,
  '14) zamaninda ve dolu calisan kaynak saglikli'
);

-- --- 15) VAR OLMAYAN BİLEŞEN İÇİN ALARM ÜRETİLMİYOR ------------------------
/*
 * Webhook, kuyruk ve worker HENÜZ YOK. Bunlar için "sağlıklı" ya da
 * "başarısız" bildirmek izleme değil, izleme taklidi olurdu -- ve
 * sahibine var olmayan bir güvence verirdi.
 */
select ok(
  not exists (
    select 1 from public.system_alerts()
     where code in ('WEBHOOK_FAILURE', 'QUEUE_BACKLOG', 'WORKER_FAILURE')
  ),
  '15) var olmayan bilesenler icin sahte alarm uretilmiyor'
);

-- --- 16) Operasyonel bilgi istemciye kapalı -------------------------------
select ok(
  not exists (
    select 1
      from unnest(array['source_health()', 'system_alerts()']) as f(fn)
     cross join unnest(array['anon', 'authenticated']) as r(rol)
     where has_function_privilege(r.rol, 'public.' || f.fn, 'EXECUTE')
  ),
  '16) saglik ve alarm fonksiyonlari istemci rollerine kapali'
);

select * from finish();
rollback;
