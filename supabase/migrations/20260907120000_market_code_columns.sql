-- ============================================================================
-- market_code SÜTUNLARI — enum'dan referans tabloya geçişin köprüsü
-- ----------------------------------------------------------------------------
-- ÖN KOŞUL: 20260907100000 (referans veri) ve 20260907110000 (yabancı
-- anahtarlar) uygulanmış olmalı.
--
-- BU GÖÇ ESKİ SÜTUNLARI DÜŞÜRMEZ. `sources.market`, `products.market` ve
-- `jobs.market` enum sütunları YERİNDE KALIR ve yeni `market_code` sütunları
-- onların YANINA eklenir. Sebep geri dönüş yolu: bu göçten sonra bir kod
-- dağıtımı gelecek ve o dağıtım sorun çıkarırsa kod geri alınabilmeli --
-- eski sütunlar duruyorsa eski kod çalışmaya devam eder. Enum'un düşürülmesi
-- M4'ün işi ve bilerek kod dağıtımının ARDINDAN geliyor.
--
-- ----------------------------------------------------------------------------
-- BACKFILL KİMLİK EŞLEMESİ DEĞİLDİR -- BU GÖÇÜN EN ÖNEMLİ SATIRI
--
-- Eski enum üç değer taşıyordu: 'TR', 'DE', 'US'. Bunlar "pazar" diye
-- adlandırılmıştı ama aslında ÜLKE idiler. Yeni modelde pazar bir TİCARİ
-- BÖLGE ve Almanya onun bir ÜYESİ:
--
--   eski 'TR' → yeni 'TR'   (Türkiye pazarı, tek üyeli)
--   eski 'US' → yeni 'US'   (ABD pazarı, tek üyeli)
--   eski 'DE' → yeni 'EU'   ← ALMANYA BİR PAZAR DEĞİL, EU'NUN BİR ÜLKESİ
--
-- `market::text` ile körlemesine kopyalamak 'DE' üretirdi ve `markets`
-- tablosunda 'DE' diye bir satır OLMADIĞI için yabancı anahtar düşerdi.
-- Düşmeseydi daha kötüsü olurdu: Alman teklifleri var olmayan bir pazara
-- yazılır ve hiçbir aramada görünmezdi.
--
-- Üç tablo da bugün ÜRETİMDE BOŞ (ölçüldü: sources 0, products 0, jobs 0),
-- yani bu eşleme pratikte hiçbir satıra dokunmuyor. Yine de doğru yazılıyor:
-- göç dosyası kalıcıdır ve verili bir ortamda tekrar çalışabilir.
--
-- GERİ ALMA: üç sütun düşürülür. Eski enum sütunları hiç değişmediği için
-- sistem tam olarak bu göçten önceki hâline döner.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Yeni sütunlar — NULL serbest (NOT NULL M4'te)
-- ---------------------------------------------------------------------------
alter table public.sources
  add column if not exists market_code  text,
  add column if not exists country_code char(2);

alter table public.products
  add column if not exists market_code text;

alter table public.jobs
  add column if not exists market_code text;

alter table public.sources
  drop constraint if exists sources_market_code_fkey;
alter table public.sources
  add constraint sources_market_code_fkey
  foreign key (market_code) references public.markets (code);

alter table public.sources
  drop constraint if exists sources_country_code_fkey;
alter table public.sources
  add constraint sources_country_code_fkey
  foreign key (country_code) references public.countries (code);

alter table public.products
  drop constraint if exists products_market_code_fkey;
alter table public.products
  add constraint products_market_code_fkey
  foreign key (market_code) references public.markets (code);

alter table public.jobs
  drop constraint if exists jobs_market_code_fkey;
alter table public.jobs
  add constraint jobs_market_code_fkey
  foreign key (market_code) references public.markets (code);

comment on column public.sources.market_code is
  'Bu kaynagin veri getirdigi TICARI BOLGE. markets tablosuna baglidir. '
  'Para birimiyle ve ulkeyle uyumlu olmak ZORUNDA DEGIL.';
comment on column public.sources.country_code is
  'Kaynagin urun verdigi ULKE. Pazardan AYRI: bir EU kaynagi Almanya''dan da '
  'Ispanya''dan da veri getirebilir.';
comment on column public.products.market_code is
  'Teklifin ait oldugu ticari bolge. Kaynaktan denormalize edilir.';


-- ---------------------------------------------------------------------------
-- 2) Backfill — açık eşleme
-- ---------------------------------------------------------------------------
update public.sources
   set market_code = case market::text
                       when 'TR' then 'TR'
                       when 'US' then 'US'
                       when 'DE' then 'EU'
                     end
 where market_code is null;

update public.products
   set market_code = case market::text
                       when 'TR' then 'TR'
                       when 'US' then 'US'
                       when 'DE' then 'EU'
                     end
 where market_code is null;

update public.jobs
   set market_code = case market::text
                       when 'TR' then 'TR'
                       when 'US' then 'US'
                       when 'DE' then 'EU'
                     end
 where market_code is null and market is not null;


-- ---------------------------------------------------------------------------
-- 3) Indexler — eskilerin market_code karşılıkları
-- ---------------------------------------------------------------------------
-- Eskiler M4'te düşürülecek; şimdilik ikisi de duruyor çünkü kod dağıtımı
-- arada ve iki sütun da okunabilir olmalı.
create index if not exists sources_market_code_idx
  on public.sources (market_code) where is_enabled;

create index if not exists products_market_code_status_idx
  on public.products (market_code, status) where status = 'active';

create index if not exists products_market_code_freshness_idx
  on public.products (market_code, price_checked_at nulls first);


-- ---------------------------------------------------------------------------
-- 4) Sütun izinleri
-- ---------------------------------------------------------------------------
-- `products` üzerinde yetki SÜTUN BAZLIDIR (20260903130000): yeni sütun
-- kendiliğinden görünmez. `market` sütunu vitrine açıktı; `market_code` de
-- açılmazsa arama sonuçları sessizce pazar bilgisiz kalırdı.
grant select (market_code) on public.products to anon, authenticated;
grant select (market_code, country_code) on public.sources to service_role;


-- ---------------------------------------------------------------------------
-- KENDİ KENDİNİ DOĞRULAYAN KONTROL
-- ---------------------------------------------------------------------------
do $$
declare
  v_kalan text;
  v_sayi  int;
begin
  -- 1) ÖN KOŞUL
  if (select count(*) from public.markets) = 0 then
    raise exception 'BASARISIZ: markets tablosu bos -- 20260907100000 once uygulanmali';
  end if;

  -- 2) Sütunlar ve yabancı anahtarlar
  select string_agg(x.ad, ', ' order by x.ad) into v_kalan
    from (values
      ('sources_market_code_fkey'), ('sources_country_code_fkey'),
      ('products_market_code_fkey'), ('jobs_market_code_fkey')
    ) as x(ad)
   where not exists (select 1 from pg_constraint c where c.conname = x.ad and c.contype = 'f');
  if v_kalan is not null then
    raise exception 'BASARISIZ: su yabanci anahtarlar kurulmadi: %', v_kalan;
  end if;

  /*
   * 3) BACKFILL EKSİKSİZ Mİ?
   *
   * `market` dolu ama `market_code` boş kalan bir satır, CASE'de eşleşmeyen
   * bir enum değeri demektir -- yani eşleme tablosu enum'un gerisinde
   * kalmıştır. Sessizce geçerse o satırlar hiçbir aramada görünmez.
   */
  select count(*) into v_sayi from public.sources  where market_code is null;
  if v_sayi > 0 then
    raise exception 'BASARISIZ: % kaynak market_code olmadan kaldi', v_sayi;
  end if;
  select count(*) into v_sayi from public.products where market_code is null;
  if v_sayi > 0 then
    raise exception 'BASARISIZ: % teklif market_code olmadan kaldi', v_sayi;
  end if;
  select count(*) into v_sayi from public.jobs
   where market is not null and market_code is null;
  if v_sayi > 0 then
    raise exception 'BASARISIZ: % is market_code olmadan kaldi', v_sayi;
  end if;

  -- 4) 'DE' KÖRLEMESİNE KOPYALANMADI: hiçbir satır var olmayan 'DE'
  --    pazarını taşımamalı. (FK zaten engeller; bu, eşlemenin gerçekten
  --    yazıldığını gösterir.)
  if exists (select 1 from public.sources  where market_code = 'DE')
     or exists (select 1 from public.products where market_code = 'DE') then
    raise exception
      'BASARISIZ: market_code = ''DE'' bulundu -- Almanya bir pazar degil, EU''nun ulkesi';
  end if;

  -- 5) ESKİ SÜTUNLAR DURUYOR MU? Bu göç köprüdür, yıkım değil.
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='products' and column_name='market') then
    raise exception 'BASARISIZ: products.market dusurulmus -- o M4''un isi';
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'market') then
    raise exception 'BASARISIZ: public.market enum''u dusurulmus -- o M4''un isi';
  end if;

  raise notice
    '✓ market_code sutunlari eklendi (sources/products/jobs) + sources.country_code; '
    'backfill acik eslemeyle yapildi (DE -> EU). Eski enum sutunlari M4 icin yerinde.';
end $$;
