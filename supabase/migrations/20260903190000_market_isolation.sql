-- ===========================================================================
-- PAZAR İZOLASYONU — tekliflerin hangi ülkeye ait olduğu
-- ---------------------------------------------------------------------------
-- SORUN
-- Bir teklif bugün yalnızca `currency` taşıyor. Para birimi pazar DEĞİLDİR:
--   * EUR hem Almanya hem Avusturya hem İrlanda demektir,
--   * Almanya'daki bir satıcı TRY ile fiyat verebilir,
--   * ABD'ye gönderim yapmayan bir teklif USD etiketli olabilir.
--
-- Para birimini pazar sanmak somut bir hataya yol açar: Türkiye'den bakan
-- kullanıcıya, kendisine hiç gönderilmeyecek bir Alman teklifi "en ucuz"
-- diye gösterilir. Fiyat karşılaştırmasının tamamı çöker -- çünkü
-- karşılaştırılamayacak iki şey karşılaştırılmış olur.
--
-- ÇÖZÜM
-- Pazar AÇIK bir alan olarak taşınır ve para biriminden BAĞIMSIZ tutulur.
-- Ama ikisi keyfî de olamaz: her pazarın bir para birimi vardır ve
-- uyuşmazlık şema düzeyinde reddedilir.
--
-- NEDEN TEKLİFTE DE DENORMALİZE
-- Arama, teklifleri pazara göre süzmek zorunda ve bunu HER sorguda yapıyor.
-- Kaynağa join atmak, en sıcak sorgu yoluna kalıcı bir maliyet ekler.
-- Denormalizasyon tetikleyiciyle değil, alım hattı tarafından yazılır ve
-- CHECK ile tutarlı tutulur.
-- ===========================================================================

-- Desteklenen pazarlar. Yeni pazar eklemek = enum'a değer eklemek.
create type public.market as enum ('TR', 'DE', 'US');

comment on type public.market is
  'Faaliyet gosterilen pazar (ISO 3166-1 alpha-2). Para biriminden AYRI bir kavram.';

-- ---------------------------------------------------------------------------
-- Pazar → para birimi eşlemesi. Tek doğruluk kaynağı.
-- ---------------------------------------------------------------------------
create or replace function public.market_currency(p_market public.market)
returns char(3)
language sql
immutable
set search_path = ''
as $$
  select case p_market
           when 'TR' then 'TRY'
           when 'DE' then 'EUR'
           when 'US' then 'USD'
         end::char(3);
$$;

comment on function public.market_currency(public.market) is
  'Bir pazarin para birimi. Pazar ile para biriminin uyumunu tek yerden tanimlar.';

-- ---------------------------------------------------------------------------
-- sources.market — bu feed hangi pazara veri getiriyor?
-- ---------------------------------------------------------------------------
-- Varsayilan 'TR': mevcut tek pazarimiz o ve bu migration hicbir satirin
-- anlamini degistirmemeli. Bos birakip NULL yapmak, "pazari bilinmeyen
-- teklif" diye bir kategori yaratirdi -- ve o teklifler her aramada
-- gorunur ya da hic gorunmez olurdu; ikisi de yanlis.
alter table public.sources
  add column market public.market not null default 'TR';

alter table public.sources
  add constraint sources_market_currency_uyumlu
  check (currency = public.market_currency(market));

comment on column public.sources.market is
  'Bu kaynagin veri getirdigi pazar. currency ile uyumlu olmak ZORUNDA.';

create index sources_market_idx on public.sources (market) where is_enabled;

-- ---------------------------------------------------------------------------
-- products.market — teklifin ait olduğu pazar
-- ---------------------------------------------------------------------------
alter table public.products
  add column market public.market not null default 'TR';

alter table public.products
  add constraint products_market_currency_uyumlu
  check (currency = public.market_currency(market));

comment on column public.products.market is
  'Teklifin ait oldugu pazar. Kaynaktan denormalize edilir; arama bununla suzer.';

-- Aramanin sicak yolu: pazar + kategori + fiyat.
create index products_market_status_idx
  on public.products (market, status)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Sütun izinleri: yeni sütunlar da vitrine açık olmalı.
-- ---------------------------------------------------------------------------
-- products/merchants üzerinde tablo düzeyinde SELECT KALDIRILMIŞTI
-- (20260903130000_secret_column_grants.sql); yeni sütun otomatik olarak
-- görünmez. Açıkça verilmezse arama sonuçları sessizce pazar bilgisiz kalır.
grant select (market) on public.products to anon, authenticated;
grant select (market) on public.sources to service_role;
