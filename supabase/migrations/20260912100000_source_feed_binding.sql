-- ===========================================================================
-- Kaynak ↔ feed ↔ reklamveren BAĞI
--
-- MIMARI KURAL: bir magaza -> bir kaynak -> bir dogrulanmis feed.
--
-- NEDEN: `upsertOffers(merchant_id, source_id, rows, market_code)` bir
-- turdaki HER satiri kaynagin TEK magazasina yazar; satirin gercekten o
-- magazaya ait olup olmadigini sormaz. Awin'in Product Data indirmesi ise
-- tek bir .csv.gz icinde YUZLERCE reklamverenin urununu tasiyabiliyor
-- (elimizdeki ornek: 215 feed). Boyle bir dosyayi tek kaynaga baglamak,
-- 215 magazanin urununu tek magazaya yazmak demek -- ve ariza SESSIZDIR:
-- sayaclar yesil, created yuksek, katalog yanlis.
--
-- Bu migration iki sutun ekler ve BAGI VERITABANINDA ZORLAR:
--   feed_id                -> agin feed kimligi (Awin'de sayisal, ör. 2281)
--   expected_advertiser_id -> bu kaynagin tasidigi reklamveren (MID)
--
-- feed_id ile MID AYRI numaralandirma uzaylaridir. F2281 bir feed
-- kimligi, 158122 bir reklamveren kimligi; ikisini esitlemek ya da
-- birinden digerini turetmek sessiz bir eslestirme hatasi olurdu.
-- Bu yuzden ikisi AYRI sutunda durur ve eslestirmeyi yalnizca
-- expected_advertiser_id yapar.
-- ===========================================================================

alter table public.sources
  add column if not exists feed_id text,
  add column if not exists expected_advertiser_id text;

comment on column public.sources.feed_id is
  'Agin feed kimligi (Awin Product Data: sayisal, ör. 2281). MID DEGILDIR.';
comment on column public.sources.expected_advertiser_id is
  'Bu kaynagin YALNIZCA bu reklamverenin urunlerini tasidigi iddiasi (MID). '
  'Doluysa alim hatti her satiri bu kimlige karsi dogrular ve tek yabanci '
  'satirda turu durdurur. Bossa denetim calismaz (geriye donuk uyumluluk).';

-- Bos dize ile null ayni sey degil; bos dize bir iddia DEGILDIR.
alter table public.sources
  drop constraint if exists sources_feed_ids_not_blank;
alter table public.sources
  add constraint sources_feed_ids_not_blank
  check (
    (feed_id is null or length(btrim(feed_id)) > 0)
    and (expected_advertiser_id is null or length(btrim(expected_advertiser_id)) > 0)
  );

-- ---------------------------------------------------------------------------
-- DETERMINISTIK BAG: expected_advertiser_id, magazanin GERCEK MID'i olmali.
--
-- CHECK baska tabloya bakamaz, bu yuzden tetikleyici. Amaci: kaynagin
-- iddiasi ile merchants.network_advertiser_id'nin AYRISMASINI engellemek.
-- Ayrisirlarsa alim hatti yanlis MID'e karsi dogrulama yapar ve koruma
-- sessizce anlamsizlasir -- korumanin en tehlikeli bozulma bicimi.
-- ---------------------------------------------------------------------------
create or replace function public.tg_source_advertiser_matches_merchant()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_mid text;
begin
  if new.expected_advertiser_id is null then
    return new;  -- iddia yok, denetim yok
  end if;

  select network_advertiser_id into v_mid
    from public.merchants
   where id = new.merchant_id;

  if v_mid is null then
    raise exception
      'Kaynak % reklamveren % bekliyor ama magazanin network_advertiser_id alani bos.',
      new.slug, new.expected_advertiser_id
      using errcode = 'check_violation';
  end if;

  if v_mid <> new.expected_advertiser_id then
    raise exception
      'Kaynak % reklamveren % bekliyor ama bagli magazanin MID i %.',
      new.slug, new.expected_advertiser_id, v_mid
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists sources_advertiser_matches_merchant on public.sources;
create trigger sources_advertiser_matches_merchant
  before insert or update of expected_advertiser_id, merchant_id
  on public.sources
  for each row execute function public.tg_source_advertiser_matches_merchant();

-- ---------------------------------------------------------------------------
-- Simple Project / MID 158122 / feed F2281 kaynagi.
--
-- is_enabled = FALSE ve bu bilincli. Kaynagin calisabilmesi icin HENUZ
-- SAGLANMAMIS iki sart var (ikisi de operatör bilgisi; uydurulamaz):
--
--   1) merchants.homepage_url BOS. `loadSources` izinli alan adini
--      ana sayfadan turetiyor; bos olunca allowedHosts = [] oluyor ve
--      normalize.ts HER urun adresini reddediyor (fail-closed). Yani
--      ana sayfa girilmeden tek bir urun bile alinamaz.
--
--   2) merchants.status <> 'active'. Aktiflik
--      merchants_active_needs_verified_terms kisitina takiliyor:
--      terms_verified_at dolmadan magaza yayina alinamiyor.
--
-- Kaynagi simdiden yazmanin sebebi: F2281 <-> 158122 bagini KAYIT altina
-- almak ve yukaridaki iki eksigi tek bir yerde gorunur kilmak.
-- ---------------------------------------------------------------------------
insert into public.sources
  (merchant_id, slug, name, kind, endpoint_url, field_mapping,
   currency, market_code, country_code, auth_type, auth_secret_ref,
   feed_id, expected_advertiser_id, is_enabled, schedule_cron)
select
  m.id,
  'simple-project-awin-f2281',
  'Simple Project — Awin Product Data F2281',
  'feed_csv',
  -- SIR DEGIL, SIRRIN ADI. Gercek anahtar yalnizca calisma aninda
  -- ortamdan okunur; veritabaninda duz metin kimlik bilgisi bulunmaz.
  'https://ui.awin.com/productdata-darwin-download/publisher/3074081/'
    || '${AWIN_DATAFEED_API_KEY}/1/feed/F2281.csv.gz',
  -- ONERILEN baslangic eslemesi. DOGRULANMADI: ui.awin.com bu ortamdan
  -- engelli oldugu icin F2281'in gercek baslik satiri hic gorulmedi.
  -- Kaynak etkinlestirilmeden ONCE verifyAwinMapping ile dogrulanmali.
  jsonb_build_object(
    'external_id',      'aw_product_id',
    'title',            'product_name',
    'price',            'search_price',
    'url',              'merchant_deep_link',
    'gtin',             'ean',
    'brand',            'brand_name',
    'image',            'merchant_image_url',
    'description',      'description',
    'stock',            'in_stock',
    'compare_at_price', 'rrp_price',
    'category',         'merchant_category',
    'shipping_fee',     'delivery_cost',
    'currency',         'currency',
    'merchant_id',      'merchant_id'
  ),
  'USD',
  'US',
  'US',
  'query',
  'AWIN_DATAFEED_API_KEY',
  '2281',
  '158122',
  false,
  '0 */6 * * *'
from public.merchants m
where m.slug = 'simple-project'
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- DOGRULAMA
-- ---------------------------------------------------------------------------
do $$
declare
  v record;
  v_bto_mid   text;
  v_bto_durum text;
  v_sayi      integer;
begin
  select s.*, m.slug as magaza_slug, m.network_advertiser_id as magaza_mid
    into v
    from public.sources s
    join public.merchants m on m.id = s.merchant_id
   where s.slug = 'simple-project-awin-f2281';

  if v is null then
    raise exception 'DOGRULAMA 1: simple-project kaynagi olusturulamadi.';
  end if;

  if v.magaza_slug <> 'simple-project' then
    raise exception 'DOGRULAMA 2: kaynak yanlis magazaya bagli -> %', v.magaza_slug;
  end if;

  if v.feed_id <> '2281' or v.expected_advertiser_id <> '158122' then
    raise exception 'DOGRULAMA 3: feed/MID bagi yanlis -> feed=%, mid=%',
      v.feed_id, v.expected_advertiser_id;
  end if;

  -- Deterministik bag: kaynagin iddiasi magazanin gercek MID'i ile ayni mi.
  if v.magaza_mid <> v.expected_advertiser_id then
    raise exception 'DOGRULAMA 4: kaynak MID % bekliyor, magazanin MID i %.',
      v.expected_advertiser_id, v.magaza_mid;
  end if;

  -- Sir veritabanina DUZ METIN girmemis olmali.
  if position('${AWIN_DATAFEED_API_KEY}' in v.endpoint_url) = 0 then
    raise exception 'DOGRULAMA 5: adres sablonunda sir yer tutucusu yok -- '
      'kimlik bilgisi duz metin yazilmis olabilir.';
  end if;

  if v.is_enabled then
    raise exception 'DOGRULAMA 6: kaynak etkin -- ana sayfa ve dogrulanmis '
      'sartlar gelmeden etkinlestirilemez.';
  end if;

  -- Tetikleyici gercekten calisiyor mu: yanlis MID reddedilmeli.
  begin
    update public.sources set expected_advertiser_id = '61655'
     where slug = 'simple-project-awin-f2281';
    raise exception 'DOGRULAMA 7: yanlis MID kabul edildi -- deterministik bag yok.';
  exception
    when check_violation then
      null;  -- beklenen
  end;

  -- BTO / MID 61655 DEGISMEDI.
  select network_advertiser_id, status::text into v_bto_mid, v_bto_durum
    from public.merchants where slug = 'back-to-the-office';

  if v_bto_mid is distinct from '61655' or v_bto_durum is distinct from 'prospect' then
    raise exception 'DOGRULAMA 8: BTO kaydi degismis (mid=%, durum=%).',
      v_bto_mid, v_bto_durum;
  end if;

  -- BTO icin kaynak ACILMAMIS olmali.
  select count(*) into v_sayi
    from public.sources s join public.merchants m on m.id = s.merchant_id
   where m.slug = 'back-to-the-office';

  if v_sayi > 0 then
    raise exception 'DOGRULAMA 9: BTO icin kaynak acilmis -- onaysiz programa trafik riski.';
  end if;

  raise notice
    'Simple Project kaynagi kaydedildi: feed 2281 <-> MID 158122, pazar US, USD. '
    'ETKIN DEGIL. Eksik: merchants.homepage_url (izinli alan adi bundan turetiliyor) '
    've terms_verified_at (aktiflik kisiti). BTO/61655 degismedi.';
end $$;
