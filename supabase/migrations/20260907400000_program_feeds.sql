-- ===========================================================================
-- program_feeds: bir programin BIRDEN COK feed'i olabilir
-- ===========================================================================
--
-- `programs.network_feed_id` TEK sutundu. Back to the Office'in IKI feed'i
-- var ve ikincisi (35.952 urun) o sutuna sigmadigi icin hic kaydedilemiyordu.
--
-- Bu bir istisna degil. Yayinci hesabinin feed dizini (07/09/2026, 577 satir
-- / 383 advertiser) OLCULDU:
--
--   advertiser basina feed:  1->306  2->43  3->21  4->5  5->3  6->2  8->1
--                            21->1   46->1
--   cok feedli advertiser:   77/383 (%20) -- ama 271/577 feed'i (%47) tasiyor
--   KATILDIKLARIMIZDA:       7 advertiser'in 3'u cok feedli
--
-- Tek sutunla bu yapinin yarisi kaydedilemez. Hedef milyonlarca saticiysa
-- kayip kalici olur.
--
-- ---------------------------------------------------------------------------
-- AGIN BEYANI ILE BIZIM OLCUMUMUZ AYRI SUTUNLARDA
-- ---------------------------------------------------------------------------
--
-- 20260907390000'in Alison'da kurdugu ayrim burada tabloya tasiniyor:
--
--   network_item_count / last_imported_at   AGIN dedigi
--   measured_*  / ingestable_count          BIZIM olctugumuz
--
-- Alison ikisinin nicin ayri durmasi gerektiginin kanitidir: ag 5.594 diyor,
-- hattan 0 urun geciyor. Tek hucreye cokertilseydi kaynak acma karari yanlis
-- sayiya bakardi.
--
-- ---------------------------------------------------------------------------
-- ADRES SAKLANIYOR AMA ANAHTAR SAKLANMIYOR
-- ---------------------------------------------------------------------------
--
-- `feed_access='verified'` https bir adres ISTIYOR (20260907380000). Awin'in
-- gercek indirme adresi ise anahtari YOL SEGMENTINDE tasiyor:
--
--   .../datafeed/download/apikey/<ANAHTAR>/language/en/fid/108580/...
--
-- Anahtari oldugu gibi yazmak, onu yedeklere, `pg_dump` ciktisina ve yonetim
-- panelindeki her ekran goruntusune tasirdi. Bu yuzden adres GERCEK ama
-- anahtarin yerinde ADI duruyor: `{AWIN_DATAFEED_API_KEY}`. Uydurma degil --
-- ag'in verdigi adresin, sirrin yerine adinin konmus hali.
--
-- Iki kisit bunu YAPISAL hale getiriyor (yorum degil):
--   feed_url icinde 24+ haneli hex dizisi OLAMAZ
--   `/apikey/` segmentinden hemen sonra `{` GELMEK ZORUNDA
--
-- ---------------------------------------------------------------------------
-- OLCUM (07/09/2026, gercek indirme, HER SATIR okundu -- orneklenmedi)
-- ---------------------------------------------------------------------------
--
--   fid     satir     currency   HATTAN GECEN   elenen  sebep
--   108580       5     USD                   5        0  --
--   111515   5.594     USD                   0    5.594  fiyat sifir/negatif
--   102827 116.417     GBP             116.415        2  fiyat makul ust
--                                                        sinirin ustunde
--   111663  35.952     GBP              35.952        0  --
--
-- Satir sayilari agin dizinindeki sayilarla BIREBIR tutuyor. Para birimi
-- `currency` sutunundan OKUNDU; GB->GBP cikarimi YAPILMADI.
--
-- `ingestable_count` CIKARIM DEGIL: her satir gercek normalize hattindan
-- (`scripts/awin-feed-dryrun.mjs`, allowedHosts=www.awin1.com) gecirildi.
-- "Fiyati var" demek "hattan gecer" demek DEGIL -- 102827'de fiyati olan iki
-- satir makul ust sinirda elendi, ve ilk olcum yanlis host bayragiyla
-- calistirildiginda DORT feed de 0 vermisti. Sayilar hattin kendi ciktisidir.
--
-- GTIN: 102827'de 77.862 satirda EAN dolu ama 77.474'u gecerli (kontrol
-- hanesi); 111663'te 30.986 -> 30.867. 20260907300000'in reddettigi fark.
--
-- `last_updated` dort feed'de de tamamen bos -> feed ICERIGINDEN son
-- guncelleme cikarilamaz. `last_imported_at` bu yuzden feed dizininin
-- "Last Imported" alanindan geliyor: ag'in kendi beyani, uydurma degil.
--
-- BU GOC HICBIR KAYNAK ACMAZ VE HICBIR URUN YAZMAZ. Mooncool ve BTO artik
-- teknik olarak cekilebilir; 152.374 urunluk gercek katalogun alinmasi AYRI
-- ve acik bir karardir.
-- ===========================================================================

-- --- 1) Tablo --------------------------------------------------------------
create table if not exists public.program_feeds (
  id                  uuid primary key default gen_random_uuid(),
  program_id          uuid not null references public.programs(id) on delete cascade,
  network             text not null,
  network_feed_id     text not null,
  feed_name           text,
  region              char(2),
  language            text,

  -- AGIN BEYANI
  network_item_count  integer,
  last_imported_at    timestamptz,

  -- BIZIM OLCUMUMUZ
  measured_currency   char(3) references public.currencies(code),
  measured_item_count integer,
  ingestable_count    integer,
  checked_at          timestamptz,

  feed_access         text not null default 'unverified',
  feed_url            text,
  is_primary          boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.program_feeds is
  'Bir programin feed''leri. Advertiser''larin %20''si cok feedli ve bunlar '
  'butun feed''lerin %47''sini tasiyor; tek sutun bu yapinin yarisini '
  'kaydedemiyordu.';
comment on column public.program_feeds.network_item_count is
  'AGIN bu feed icin bildirdigi kalem sayisi.';
comment on column public.program_feeds.measured_item_count is
  'BIZIM indirip saydigimiz satir sayisi.';
comment on column public.program_feeds.ingestable_count is
  'Alim hattindan GECEBILEN kalem sayisi. Alison''da ag 5.594 der, bu 0''dir.';
comment on column public.program_feeds.measured_currency is
  'Feed''in `currency` sutunundan OKUNAN para birimi. Ulkeden CIKARILMAZ.';
comment on column public.program_feeds.feed_url is
  'Gercek indirme adresi -- anahtarin yerinde `{AWIN_DATAFEED_API_KEY}` adi '
  'durur. Ham anahtar iki kisitla YAPISAL olarak engellenir.';
comment on column public.program_feeds.is_primary is
  'Programin `programs` satirina aynalanan feed. Program basina en fazla bir '
  'tane (kismi tekil indeks).';

-- --- 2) Kisitlar -----------------------------------------------------------
alter table public.program_feeds drop constraint if exists program_feeds_access_vocab;
alter table public.program_feeds add constraint program_feeds_access_vocab
  check (feed_access in ('unverified','credentials_required','unsupported_transport',
                         'manual_required','verified'));

-- FAIL-CLOSED: "cekebiliyoruz" demek CEKILEBILIR bir adres ister.
alter table public.program_feeds drop constraint if exists program_feeds_verified_needs_https;
alter table public.program_feeds add constraint program_feeds_verified_needs_https
  check (feed_access <> 'verified' or (feed_url is not null and feed_url like 'https://%'));

-- ANAHTAR ADRESE YAZILAMAZ. Awin anahtari 32 haneli hex; 24+ hane esigi
-- kisaltilmis bir kopyayi da yakalar.
alter table public.program_feeds drop constraint if exists program_feeds_url_no_secret;
alter table public.program_feeds add constraint program_feeds_url_no_secret
  check (feed_url is null or feed_url !~ '[0-9a-f]{24,}');

-- `/apikey/` segmentinden sonra MUTLAKA yer tutucu gelir.
alter table public.program_feeds drop constraint if exists program_feeds_url_placeholder;
alter table public.program_feeds add constraint program_feeds_url_placeholder
  check (feed_url is null or feed_url !~ '/apikey/(?!\{)');

-- Olcum tarihsiz olamaz: tarihsiz sayi bayatladigini soylemez.
alter table public.program_feeds drop constraint if exists program_feeds_measure_needs_time;
alter table public.program_feeds add constraint program_feeds_measure_needs_time
  check ((ingestable_count is null and measured_item_count is null) = (checked_at is null));

alter table public.program_feeds drop constraint if exists program_feeds_counts_non_negative;
alter table public.program_feeds add constraint program_feeds_counts_non_negative
  check (coalesce(network_item_count, 0) >= 0
     and coalesce(measured_item_count, 0) >= 0
     and coalesce(ingestable_count, 0) >= 0);

alter table public.program_feeds drop constraint if exists program_feeds_id_not_blank;
alter table public.program_feeds add constraint program_feeds_id_not_blank
  check (length(btrim(network_feed_id)) > 0);

-- AYNI FEED IKI YERE BAGLANAMAZ: baglansaydi ayni katalog iki kez sayilirdi.
drop index if exists public.program_feeds_unique;
create unique index program_feeds_unique
  on public.program_feeds (network, network_feed_id);

-- Program basina EN FAZLA BIR birincil feed.
drop index if exists public.program_feeds_one_primary;
create unique index program_feeds_one_primary
  on public.program_feeds (program_id) where is_primary;

create index if not exists program_feeds_program_idx on public.program_feeds (program_id);

drop trigger if exists program_feeds_set_updated_at on public.program_feeds;
create trigger program_feeds_set_updated_at
  before update on public.program_feeds
  for each row execute function public.tg_set_updated_at();

-- --- 3) programs.feed_url'e de ayni sir korumasi ---------------------------
-- Aynalanan sutun da anahtar tasiyamaz; koruma yalnizca cocuk tabloda
-- olsaydi ayna onu delip gecerdi.
alter table public.programs drop constraint if exists programs_feed_url_no_secret;
alter table public.programs add constraint programs_feed_url_no_secret
  check (feed_url is null or feed_url !~ '[0-9a-f]{24,}');

alter table public.programs drop constraint if exists programs_feed_url_placeholder;
alter table public.programs add constraint programs_feed_url_placeholder
  check (feed_url is null or feed_url !~ '/apikey/(?!\{)');

-- --- 4) Ayna: birincil feed -> programs ------------------------------------
--
-- TEK KAYNAK `program_feeds`. `programs` uzerindeki feed sutunlari artik
-- TURETILMIS: eski testler ve panolar orayi okumaya devam ediyor ama iki
-- yerde birbirinden habersiz iki gercek olusamiyor.
create or replace function public.tg_program_feeds_sync_primary()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_program uuid;
  f         record;
begin
  v_program := coalesce(new.program_id, old.program_id);

  select * into f
    from public.program_feeds
   where program_id = v_program and is_primary
   limit 1;

  if f is null then
    update public.programs
       set network_feed_id       = null,
           feed_url              = null,
           feed_access           = 'unverified',
           network_item_count    = null,
           feed_ingestable_count = null,
           feed_checked_at       = null,
           feed_last_updated_at  = null
     where id = v_program;
  else
    update public.programs
       set network_feed_id       = f.network_feed_id,
           feed_url              = f.feed_url,
           feed_access           = f.feed_access,
           network_item_count    = f.network_item_count,
           feed_ingestable_count = f.ingestable_count,
           feed_checked_at       = f.checked_at,
           feed_last_updated_at  = f.last_imported_at,
           feed_available        = true,
           -- OLCULEN para birimi programa da tasiniyor; olculmediyse
           -- programin mevcut degeri KORUNUR (null ile ezilmez).
           currency              = coalesce(f.measured_currency, programs.currency)
     where id = v_program;
  end if;

  return null;
end;
$$;

drop trigger if exists program_feeds_sync_primary on public.program_feeds;
create trigger program_feeds_sync_primary
  after insert or update or delete on public.program_feeds
  for each row execute function public.tg_program_feeds_sync_primary();

revoke execute on function public.tg_program_feeds_sync_primary() from public;

-- --- 5) Yetkiler: TAMAMEN SUNUCU TARAFI ------------------------------------
-- `programs` ile ayni gerekce: hangi feed'e erisebildigimiz is istihbaratidir.
alter table public.program_feeds enable row level security;
revoke all on public.program_feeds from anon, authenticated;
grant select, insert, update, delete on public.program_feeds to service_role;

-- ===========================================================================
-- OLCULMUS FEED VERISI
-- ===========================================================================
--
-- Dort feed de 07/09/2026'da GERCEKTEN indirildi (http=200, application/gzip)
-- ve her satiri okundu. Asagidaki hicbir sayi tahmin degil.

insert into public.program_feeds (
  program_id, network, network_feed_id, feed_name, region, language,
  network_item_count, last_imported_at,
  measured_currency, measured_item_count, ingestable_count, checked_at,
  feed_access, feed_url, is_primary
)
select p.id, 'awin', v.fid, v.adi, v.bolge, 'en',
       v.ag_sayisi, v.son_import,
       v.pb, v.olculen, v.gecen, now(),
       'verified',
       'https://productdata.awin.com/datafeed/download'
       || '/apikey/{AWIN_DATAFEED_API_KEY}'
       || '/language/en/fid/' || v.fid
       || '/columns/data_feed_id,merchant_id,merchant_name,aw_product_id,'
       || 'aw_deep_link,product_name,search_price,rrp_price,currency,in_stock,'
       || 'stock_status,ean,brand_name,merchant_image_url,merchant_category,'
       || 'merchant_product_id,delivery_cost,last_updated'
       || '/format/csv/delimiter/%2C/compression/gzip/adultcontent/1/',
       v.birincil
  from (values
    -- MID      fid        feed adi                              bolge  ag     son import                        pb      olculen gecen  birincil
    ('66494',  '108580', 'sftp://datafeeds.shareasale.com/Awin/148320/', 'US', 5,      '2026-05-15 20:34:06+00'::timestamptz, 'USD',   5,      5,     true),
    ('120101', '111515', 'Alison Course Feeds',                  'US',  5594,  '2026-05-15 21:10:46+00'::timestamptz, 'USD',   5594,   0,     true),
    ('61655',  '102827', 'General Feed - Back to the Office',     'GB',  116417,'2026-09-07 09:38:10+00'::timestamptz, 'GBP',   116417, 116415,true),
    ('61655',  '111663', 'In Stock Feed',                         'GB',  35952, '2026-09-07 10:19:30+00'::timestamptz, 'GBP',   35952,  35952, false)
  ) as v(mid, fid, adi, bolge, ag_sayisi, son_import, pb, olculen, gecen, birincil)
  join public.programs p
    on p.network = 'awin' and p.network_program_id = v.mid
on conflict (network, network_feed_id) do nothing;

-- --- BTO: 116418 -> 116417 -------------------------------------------------
-- Bir fazla yaziliydi. Dizin de indirme de 116.417 diyor.
update public.programs
   set product_count = 116417,
       terms = coalesce(terms || ' | ', '') ||
         'DUZELTME (07/09/2026, gercek indirme): urun sayisi 116.418 degil '
         '116.417. Bu advertiser''in IKI feed''i var -- 102827 (General, '
         '116.417, birincil) ve 111663 (In Stock, 35.952); ikincisi tek '
         'sutunlu semaya sigmadigi icin daha once hic kaydedilememisti. Para '
         'birimi GBP, feed''in `currency` sutunundan OKUNDU (GB->GBP cikarimi '
         'yapilmadi). Iki feed''in de %100''u fiyatli.'
 where network = 'awin' and network_program_id = '61655';

-- --- Mooncool: "unsupported_transport" YANLISTI ----------------------------
update public.programs
   set currency = 'USD',
       terms = coalesce(terms || ' | ', '') ||
         'DUZELTME (07/09/2026, gercek indirme): "sftp://datafeeds.shareasale.'
         'com/Awin/148320/feed.zip" bir TASIMA ADRESI DEGIL, Awin''in Feed '
         'Name alanidir. Feed normal https+gzip ile cekiliyor (http=200, '
         'application/gzip, 6 satir = 1 baslik + 5 urun, merchant_id 66494, '
         '5/5 fiyatli). Onceki unsupported_transport kaydi bu yanlis okumaya '
         'dayaniyordu. Para birimi USD, feed''in `currency` sutunundan OKUNDU.'
 where network = 'awin' and network_program_id = '66494';

-- --- Alison: olcum teyit ---------------------------------------------------
update public.programs
   set terms = coalesce(terms || ' | ', '') ||
         'TEYIT (07/09/2026): feed ERISILEBILIR (http=200, 5.594 satir, tamami '
         'USD) ama hattan gecen urun hâlâ 0 -- butun fiyat sutunlari bos. '
         'Erisim sorunu degil, TICARI durum: Alison ucretsiz kurs saglayicisi.'
 where network = 'awin' and network_program_id = '120101';

-- ===========================================================================
-- GOC KENDINI DOGRULUYOR
-- ===========================================================================
do $$
declare
  r       record;
  v_sayi  integer;
  v_prog  uuid;
begin
  -- 1) Dort feed de kayitli.
  select count(*) into v_sayi from public.program_feeds where network = 'awin';
  if v_sayi <> 4 then
    raise exception 'DOGRULAMA 1: 4 feed bekleniyordu, bulunan %.', v_sayi;
  end if;

  -- 2) BTO'nun IKI feed'i var -- bu gocun varlik sebebi.
  select count(*) into v_sayi
    from public.program_feeds pf
    join public.programs p on p.id = pf.program_id
   where p.network_program_id = '61655';
  if v_sayi <> 2 then
    raise exception 'DOGRULAMA 2: BTO''nun 2 feed''i olmali, bulunan % -- cok '
      'feedli advertiser hâlâ kaydedilemiyor.', v_sayi;
  end if;

  -- 3) OLCULEN satir sayilari AGIN dedigiyle birebir tutuyor.
  for r in select network_feed_id, network_item_count, measured_item_count
             from public.program_feeds where network = 'awin'
  loop
    if r.measured_item_count is distinct from r.network_item_count then
      raise exception 'DOGRULAMA 3: fid % icin ag % diyor, olculen % -- '
        'sayilar ayrisiyor.', r.network_feed_id, r.network_item_count,
        r.measured_item_count;
    end if;
  end loop;

  -- 4) PARA BIRIMI OLCULDU. GB->GBP bir cikarim olurdu; burada feed'in
  --    `currency` sutunundan geldi ve her satirda ayniydi.
  if (select measured_currency from public.program_feeds where network_feed_id='102827')
     is distinct from 'GBP'
   or (select measured_currency from public.program_feeds where network_feed_id='108580')
     is distinct from 'USD' then
    raise exception 'DOGRULAMA 4: olculen para birimi kaybedildi.';
  end if;

  -- 5) ALISON AYRIMI KORUNUYOR: ag 5.594 der, hattan 0 gecer.
  select * into r from public.program_feeds where network_feed_id = '111515';
  if r.network_item_count <> 5594 or r.ingestable_count <> 0 then
    raise exception 'DOGRULAMA 5: Alison''da agin iddiasi ile olcum ayrimi '
      'bozuldu (ag=%, gecen=%).', r.network_item_count, r.ingestable_count;
  end if;

  -- 5b) HATTAN GECEN SAYILAR HATTIN CIKTISI -- "fiyati var" degil.
  --     102827'de fiyati olan IKI satir makul ust sinirda elendi; gecen
  --     sayisi bu yuzden olculen satir sayisindan KUCUK. Esitlemek, olcumu
  --     cikarima geri cevirmek olurdu.
  select * into r from public.program_feeds where network_feed_id = '102827';
  if r.ingestable_count <> 116415 or r.measured_item_count <> 116417 then
    raise exception 'DOGRULAMA 5b: 102827 icin hattan gecen 116415 / olculen '
      '116417 olmali (bulunan %/%).', r.ingestable_count, r.measured_item_count;
  end if;

  -- 5c) HICBIR FEED'DE gecen > olculen OLAMAZ. Olsaydi sayi bir yerden
  --     uretilmis demektir; hat kendi girdisinden fazlasini cikaramaz.
  select count(*) into v_sayi
    from public.program_feeds
   where ingestable_count is not null and measured_item_count is not null
     and ingestable_count > measured_item_count;
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 5c: % feed''de hattan gecen sayi olculen satir '
      'sayisindan buyuk -- sayi uretilmis.', v_sayi;
  end if;

  -- 6) ANAHTAR HICBIR ADRESTE YOK. Kisit bunu yapisal kiliyor; burasi
  --    kisitin gercekten baglandigini kanitlar.
  select count(*) into v_sayi
    from public.program_feeds where feed_url ~ '[0-9a-f]{24,}';
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 6: % adreste ham anahtar var.', v_sayi;
  end if;

  select id into v_prog from public.programs
   where network='awin' and network_program_id='120101';
  begin
    update public.program_feeds
       set feed_url = 'https://productdata.awin.com/datafeed/download/apikey/'
                   || '0123456789abcdef0123456789abcdef/fid/111515/'
     where network_feed_id = '111515';
    raise exception 'DOGRULAMA 6b: ham anahtar tasiyan adres yazilabildi.';
  exception when check_violation then null;
  end;

  -- 7) AYNA CALISIYOR: birincil feed programs'a yansidi.
  select * into r from public.programs where network='awin' and network_program_id='61655';
  if r.network_feed_id <> '102827' or r.feed_access <> 'verified'
     or r.network_item_count <> 116417 then
    raise exception 'DOGRULAMA 7: birincil feed programs''a aynalanmadi '
      '(fid=%, erisim=%, sayi=%).', r.network_feed_id, r.feed_access,
      r.network_item_count;
  end if;

  -- 8) ...ve IKINCIL feed programs'a SIZMADI: orada yalnizca birincil durur.
  if r.network_feed_id = '111663' then
    raise exception 'DOGRULAMA 8: ikincil feed birincilin yerine gecmis.';
  end if;

  -- 9) PROGRAM BASINA TEK BIRINCIL.
  begin
    update public.program_feeds set is_primary = true where network_feed_id = '111663';
    raise exception 'DOGRULAMA 9: bir programa ikinci birincil feed eklenebildi.';
  exception when unique_violation then null;
  end;

  -- 10) AYNI FEED IKI PROGRAMA BAGLANAMAZ.
  begin
    insert into public.program_feeds (program_id, network, network_feed_id)
    values (v_prog, 'awin', '102827');
    raise exception 'DOGRULAMA 10: ayni feed iki programa baglanabildi.';
  exception when unique_violation then null;
  end;

  -- 11) FAIL-CLOSED HÂLÂ YERINDE: adressiz feed 'verified' olamaz.
  begin
    insert into public.program_feeds (program_id, network, network_feed_id, feed_access)
    values (v_prog, 'awin', 'test-adressiz', 'verified');
    raise exception 'DOGRULAMA 11: adressiz feed ''verified'' isaretlenebildi.';
  exception when check_violation then null;
  end;

  -- 11b) OLCULEN PARA BIRIMI PROGRAMA DA TASINDI. BTO'nun `programs.currency`
  --      alani daha once BOSTU: feed'de GBP olcmus olup programda bos
  --      birakmak, kaynak acildiginda fiyatlarin TRY varsayilanina dusmesi
  --      demekti (20260907310000'in kapattigi tam olarak bu delik).
  if (select currency from public.programs
       where network='awin' and network_program_id='61655') is distinct from 'GBP' then
    raise exception 'DOGRULAMA 11b: olculen GBP programa tasinmadi.';
  end if;

  -- 12) BTO SAYISI DUZELDI.
  if (select product_count from public.programs
       where network='awin' and network_program_id='61655') <> 116417 then
    raise exception 'DOGRULAMA 12: BTO urun sayisi 116417''ye duzeltilmedi.';
  end if;

  -- 13) WANAYOU'YA DOKUNULMADI: feed'i yok, uydurulmadi.
  select count(*) into v_sayi
    from public.program_feeds pf join public.programs p on p.id = pf.program_id
   where p.network_program_id = '127939';
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 13: feed''i olmayan WANAYOU''ya % feed uydurulmus.',
      v_sayi;
  end if;
  if (select feed_access from public.programs
       where network='awin' and network_program_id='127939') <> 'manual_required' then
    raise exception 'DOGRULAMA 13b: WANAYOU manual_required''dan cikarilmis.';
  end if;

  -- 14) HICBIR KAYNAK ACILMADI, HICBIR URUN YAZILMADI. Feed'ler artik
  --     cekilebilir; 152.374 urunun alinmasi AYRI bir karar.
  select count(*) into v_sayi
    from public.sources s join public.merchants m on m.id = s.merchant_id
   where m.network_advertiser_id in ('66494','120101','61655','127939');
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 14: bu goc % kaynak acmis.', v_sayi;
  end if;

  select count(*) into v_sayi
    from public.products p join public.merchants m on m.id = p.merchant_id
   where m.network_advertiser_id in ('66494','120101','61655','127939');
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 15: bu goc % urun yazmis.', v_sayi;
  end if;

  raise notice
    'program_feeds kuruldu: 4 feed (BTO''nun IKISI), olculen satir sayilari '
    'agin sayilariyla birebir, para birimleri feed''den OKUNDU (USD/USD/GBP/'
    'GBP). Anahtar hicbir adreste yok. Kaynak acilmadi, urun yazilmadi.';
end $$;
