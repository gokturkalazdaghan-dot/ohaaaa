-- ============================================================================
-- COĞRAFİ REFERANSLARA BAĞLANMA + PARA BİRİMİNİN PAZARDAN AYRILMASI
-- ----------------------------------------------------------------------------
-- ÖN KOŞUL: 20260907100000 (referans veri) uygulanmış olmalı. Aşağıdaki ilk
-- iddia bunu doğrular.
--
-- İKİ İŞ, TEK GÖÇ -- ÇÜNKÜ AYNI OLGUNUN İKİ YÜZÜ
--
--  (1) `country_code` ve `currency` sütunları artık SERBEST METİN DEĞİL.
--      Bugün `merchants.country_code` bir char(2) ve içine 'XX' yazılabiliyor;
--      `products.currency` bir char(3) ve içine 'ZZZ' yazılabiliyor. Feed'den
--      gelen bir yazım hatası sessizce satıra giriyor ve fiyat karşılaştırması
--      var olmayan bir para biriminde yapılıyordu.
--
--  (2) Para birimi PAZARA bağlı olmaktan çıkıyor.
--      `20260903190000_market_isolation.sql` iki kısıt kurmuştu:
--        sources_market_currency_uyumlu  check (currency = market_currency(market))
--        products_market_currency_uyumlu check (currency = market_currency(market))
--
-- İkisi birlikte yapılıyor çünkü (2) tek başına korumayı GEVŞETİRDİ; (1) o
-- boşluğu aynı işlemde dolduruyor. Kısıt kalkarken yerine bir başkası
-- gelmiyorsa, göç bir güvenlik gerilemesi olurdu.
--
-- ----------------------------------------------------------------------------
-- NE KAYBEDİLDİĞİ AÇIKÇA YAZILIYOR
--
-- O kısıt `market_isolation.sql`'in yazılma SEBEBİYDİ. Engellediği somut
-- hata: aynı pazar içinde karşılaştırılamaz iki para birimi yan yana
-- listelenir ve kullanıcıya yanlış bir "en ucuz" gösterilir. Kısıt
-- kalktığında (market='DE', currency='TRY') satırını ŞEMA DÜZEYİNDE hiçbir
-- şey engellemez.
--
-- NEDEN YİNE DE KALKIYOR: hedef pazarlar bunu imkânsız kılıyor. NORDICS beş
-- ülkede dört para birimi, GCC altı ülkede altı para birimi taşıyor. "Bir
-- pazar = bir para birimi" varsayımı global ölçekte YANLIŞ; kısıt doğru bir
-- kuralı değil, dar bir varsayımı koruyordu.
--
-- Karşılaştırılabilirlik artık şemanın değil ARAMA KATMANININ sorumluluğu.
-- Bu bir devir teslimdir; sorumluluk yok olmadı.
--
-- ----------------------------------------------------------------------------
-- `market_currency()` DÜŞÜRÜLMÜYOR
-- Artık hiçbir kısıt onu çağırmıyor ama `enqueue_job`, `source_health()` ve
-- `due_sources()` hâlâ `public.market` tipini imzalarında taşıyor. Tipi ve
-- fonksiyonu düşürmek onların yeniden yaratılmasını gerektirir -- o M4'ün
-- işi. Burada düşürmek, M4'ün riskini M2'ye taşımak olurdu.
--
-- GERİ ALMA: dört FK düşürülür, iki CHECK geri konur. `products` ve
-- `sources` boş, `merchants` 20 satır ve dördü de kapsanıyor -- kısıt
-- doğrulaması anında geçer.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Ülke referansları
-- ---------------------------------------------------------------------------
-- NULL serbest: aday (prospect) bir mağazanın ülkesi henüz bilinmeyebilir
-- (20260905100000). FK yalnızca DOLU değerin gerçek olmasını zorlar.
alter table public.merchants
  drop constraint if exists merchants_country_code_fkey;
alter table public.merchants
  add constraint merchants_country_code_fkey
  foreign key (country_code) references public.countries (code);

alter table public.vendors
  drop constraint if exists vendors_country_code_fkey;
alter table public.vendors
  add constraint vendors_country_code_fkey
  foreign key (country_code) references public.countries (code);


-- ---------------------------------------------------------------------------
-- 2) Para birimi referansları
-- ---------------------------------------------------------------------------
alter table public.products
  drop constraint if exists products_currency_fkey;
alter table public.products
  add constraint products_currency_fkey
  foreign key (currency) references public.currencies (code);

alter table public.sources
  drop constraint if exists sources_currency_fkey;
alter table public.sources
  add constraint sources_currency_fkey
  foreign key (currency) references public.currencies (code);


-- ---------------------------------------------------------------------------
-- 3) AYRIŞMA: para birimi artık pazara bağlı değil
-- ---------------------------------------------------------------------------
alter table public.sources  drop constraint if exists sources_market_currency_uyumlu;
alter table public.products drop constraint if exists products_market_currency_uyumlu;

comment on column public.sources.market is
  'Bu kaynagin veri getirdigi pazar. Para birimiyle uyumlu olmak ZORUNDA DEGIL '
  '-- para birimi currencies tablosuna baglidir.';
comment on column public.products.market is
  'Teklifin ait oldugu pazar. Kaynaktan denormalize edilir; arama bununla suzer. '
  'Para birimiyle uyumlu olmak ZORUNDA DEGIL.';
comment on function public.market_currency(public.market) is
  'Bir pazarin VARSAYILAN para birimi. ARTIK KISIT DEGILDIR -- yalnizca oneri. '
  'Bir teklif pazarindan farkli bir para biriminde fiyatlanabilir.';


-- ---------------------------------------------------------------------------
-- KENDİ KENDİNİ DOĞRULAYAN KONTROL
-- ---------------------------------------------------------------------------
do $$
declare
  v_kalan text;
  v_sayi  int;
begin
  -- 1) ÖN KOŞUL: referans veri yerinde mi?
  if (select count(*) from public.countries) = 0
     or (select count(*) from public.currencies) = 0 then
    raise exception
      'BASARISIZ: referans veri bos -- 20260907100000 once uygulanmali';
  end if;

  -- 2) Dört yabancı anahtar da kuruldu mu?
  select string_agg(x.ad, ', ' order by x.ad) into v_kalan
    from (values
      ('merchants_country_code_fkey'), ('vendors_country_code_fkey'),
      ('products_currency_fkey'),      ('sources_currency_fkey')
    ) as x(ad)
   where not exists (select 1 from pg_constraint c where c.conname = x.ad and c.contype = 'f');

  if v_kalan is not null then
    raise exception 'BASARISIZ: su yabanci anahtarlar kurulmadi: %', v_kalan;
  end if;

  /*
   * 3) AYRIŞMA GERÇEKTEN OLDU MU?
   *
   * Kısıt ADI değil TANIMI aranıyor: aynı bağı başka adla taşıyan bir kısıt
   * kalmış olsaydı ad kontrolü bunu kaçırırdı.
   */
  select string_agg(t.relname || '.' || c.conname, ', ') into v_kalan
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname in ('sources', 'products')
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%market_currency%';

  if v_kalan is not null then
    raise exception
      'BASARISIZ: para birimi hala pazara bagli -- su kisitlar market_currency cagiriyor: %',
      v_kalan;
  end if;

  -- 4) Mevcut veri yetim kalmadı mı? (FK zaten engeller; bu, sayının da
  --    beklendiği gibi olduğunu gösterir -- sessiz bir silme olmadı.)
  select count(*) into v_sayi from public.merchants where country_code is not null;
  if v_sayi <> (select count(*) from public.merchants m
                 join public.countries c on c.code = m.country_code) then
    raise exception 'BASARISIZ: bazi merchant ulkeleri referansta yok';
  end if;

  -- 5) M4'ün işi burada YAPILMADI: enum ve market_currency yerinde kalmalı.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'market') then
    raise exception 'BASARISIZ: public.market enum''u dusurulmus -- o M4''un isi';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'market_currency') then
    raise exception 'BASARISIZ: market_currency dusurulmus -- o M4''un isi';
  end if;

  raise notice
    '✓ 4 yabanci anahtar kuruldu (merchants/vendors -> countries, '
    'products/sources -> currencies); para birimi pazardan AYRILDI. '
    'Enum ve market_currency M4 icin yerinde birakildi.';
end $$;
