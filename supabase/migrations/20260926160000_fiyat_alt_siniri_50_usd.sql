-- =============================================================================
-- FİYAT ALT SINIRI: 50 USD KARŞILIĞININ ALTINDAKİ TEKLİF YAYINDA OLMAZ
-- =============================================================================
-- Hesap sahibinin kararı (26/09/2026): "50 doların altında ürün istemiyorum
-- sitemde, globalde." Affiliate gelir sepet tutarıyla ölçeklenir; düşük
-- sepetli ürün aynı tıklama maliyetiyle kuruş bırakır.
--
-- NEREDE UYGULANIR: `products` üzerinde BEFORE tetikleyicisi. Teklifler dört
-- yoldan yazılıyor (feed alımı, taşeron API'si, panel, göçler); kuralı
-- bunların birine koymak diğer üçünü açık bırakırdı. Tablo seviyesinde tek
-- kapı hepsini kapsar ve yeni bir yazma yolu eklendiğinde de geçerli kalır.
--
-- NE YAPAR: `active` ya da `out_of_stock` durumuna girmek isteyen ve fiyatı
-- sınırın altında olan teklifi `archived` yapar. SİLMEZ: tıklama ve fiyat
-- geçmişi teklife bağlı. Fiyat sonra sınırın üstüne çıkarsa bir sonraki alım
-- turu teklifi `active` yazar ve kapı geçirir -- elle geri alma gerekmez.
--
-- SINIR TEK YERDE, USD CİNSİNDEN: `listing_price_floor`. Diğer para birimleri
-- `fx_rates` üzerinden çevrilir (`convert_money_cents`). Kur yoksa teklif
-- ARŞİVLENİR (fail-closed): kuru bilinmeyen bir fiyatın 50 USD'nin üstünde
-- olduğunu bilemeyiz, ve "hiç istemiyorum" kuralı belirsizlikte açık kalmaz.
-- Bu yüzden aşağıda etkin her para birimi için kur yazılıyor.
--
-- KURLAR YAKLAŞIK: canlı kur kaynağı bağlı değil (`fx_rates` şimdiye dek
-- boştu ve hiçbir kod onu okumuyordu). Değerler 26/09/2026 itibarıyla elle
-- girilen yaklaşık kurlar; kaynak sütununda böyle yazıyor. Birkaç yüzdelik
-- sapma sınırı birkaç dolar oynatır, kararın ruhunu değil. Kur tazelemesi
-- bağlandığında bu kapı kendiliğinden güncel kurla çalışır.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Sınır
-- -----------------------------------------------------------------------------
create table if not exists public.listing_price_floor (
  id            boolean primary key default true check (id),
  amount_cents  bigint  not null check (amount_cents >= 0),
  currency      char(3) not null references public.currencies (code),
  note          text    not null,
  updated_at    timestamptz not null default now()
);

comment on table public.listing_price_floor is
  'Yayindaki teklifler icin TEK fiyat alt siniri. Tek satir (id = true). '
  'Diger para birimleri fx_rates ile cevrilir; bkz. listing_min_price_cents.';

insert into public.listing_price_floor (id, amount_cents, currency, note)
values (true, 5000, 'USD',
        'Hesap sahibi karari 26/09/2026: 50 USD altindaki urun sitede olmaz.')
on conflict (id) do update
  set amount_cents = excluded.amount_cents,
      currency     = excluded.currency,
      note         = excluded.note,
      updated_at   = now();

alter table public.listing_price_floor enable row level security;
revoke all on public.listing_price_floor from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) Yaklaşık kurlar: 1 USD = rate × QUOTE
-- -----------------------------------------------------------------------------
insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
values
  ('USD', 'GBP',    0.75, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'EUR',    0.86, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'PLN',    3.65, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'CAD',    1.37, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'AUD',    1.52, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'NZD',    1.68, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'AED',  3.6725, date '2026-09-26', 'elle, sabit kur'),
  ('USD', 'SAR',    3.75, date '2026-09-26', 'elle, sabit kur'),
  ('USD', 'QAR',    3.64, date '2026-09-26', 'elle, sabit kur'),
  ('USD', 'BHD',   0.376, date '2026-09-26', 'elle, sabit kur'),
  ('USD', 'OMR',  0.3845, date '2026-09-26', 'elle, sabit kur'),
  ('USD', 'KWD',   0.307, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'CZK',    21.5, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'DKK',    6.40, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'HUF',   340.0, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'ISK',   125.0, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'NOK',    10.2, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'RON',    4.35, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'SEK',    9.60, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)'),
  ('USD', 'TRY',    42.0, date '2026-09-26', 'elle, yaklasik (fiyat alt siniri icin)')
on conflict (base_currency, quote_currency, as_of) do update
  set rate = excluded.rate, source = excluded.source, fetched_at = now();

-- -----------------------------------------------------------------------------
-- 3) Para birimi başına sınır (kuruş/küçük birim)
-- -----------------------------------------------------------------------------
-- `convert_money_cents` küçük birimleri 1:1 çarpıyor; 3 haneli (BHD, KWD,
-- OMR) ve 0 haneli (ISK) para birimlerinde küçük birim farkı ayrıca
-- düzeltilir, yoksa sınır 10 kat yanlış çıkardı.
create or replace function public.listing_min_price_cents(p_currency char(3))
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when f.currency = p_currency then f.amount_cents
    else (
      select round(
               public.convert_money_cents(f.amount_cents, f.currency, p_currency)
               * power(10, coalesce(q.minor_unit, 2) - coalesce(b.minor_unit, 2))
             )::bigint
        from public.currencies q, public.currencies b
       where q.code = p_currency and b.code = f.currency
    )
  end
  from public.listing_price_floor f;
$$;

comment on function public.listing_min_price_cents is
  'Verilen para biriminde yayin alt siniri (kucuk birim). Kur yoksa NULL; '
  'kapi NULL''i gecirmez (fail-closed).';

revoke all on function public.listing_min_price_cents(char) from public;
-- anon'a AÇILMAZ: onu yalnızca tekliflerin yazıldığı roller (alım hattı,
-- taşeron paneli) tetikleyici üzerinden çağırır. SECURITY DEFINER, çünkü
-- taşeron `authenticated` rolüyle yazıyor ve `listing_price_floor` ona kapalı.
grant execute on function public.listing_min_price_cents(char)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4) Kapı
-- -----------------------------------------------------------------------------
create or replace function public.tg_products_price_floor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_min bigint;
begin
  if new.status not in ('active', 'out_of_stock') then
    return new;
  end if;

  v_min := public.listing_min_price_cents(new.currency);

  if v_min is null or new.price_cents < v_min then
    new.status := 'archived';
  end if;

  return new;
end;
$$;

comment on function public.tg_products_price_floor is
  'listing_price_floor altindaki (ya da kuru bilinmeyen) teklifi yayina '
  'almaz: durumu archived yapar, satiri silmez.';

drop trigger if exists products_price_floor on public.products;

create trigger products_price_floor
before insert or update of status, price_cents, currency
on public.products
for each row
execute function public.tg_products_price_floor();

-- -----------------------------------------------------------------------------
-- 5) Mevcut teklifler
-- -----------------------------------------------------------------------------
-- Tetikleyici `status` sütununa dokunan güncellemede çalışır; aynı değeri
-- yazmak kapıyı mevcut satırlara uygular.
--
-- ÜRETİMDE BU ADIM PARTİLER HÂLİNDE UYGULANDI (26/09/2026): ~45 bin satır
-- ve her satır grup istatistiği tetikleyicisini çalıştırıyor; tek deyim
-- istemci zaman aşımına düştü ve geri alındı. Aynı UPDATE, para birimi
-- başına 5-7 bin satırlık partilerle koşturuldu; sonunda sınırın altında
-- yayında teklif sayısı 0 ölçüldü. Boş/yeni bir veritabanında tek deyim
-- yeterli.
update public.products
   set status = status
 where status in ('active', 'out_of_stock')
   and (public.listing_min_price_cents(currency) is null
        or price_cents < public.listing_min_price_cents(currency));

-- -----------------------------------------------------------------------------
-- 6) Kendi doğrulaması
-- -----------------------------------------------------------------------------
do $$
declare
  v_gbp bigint := public.listing_min_price_cents('GBP');
  v_bhd bigint := public.listing_min_price_cents('BHD');
  v_isk bigint := public.listing_min_price_cents('ISK');
  v_kalan int;
begin
  if public.listing_min_price_cents('USD') <> 5000 then
    raise exception 'USD siniri 5000 olmali';
  end if;
  if v_gbp <> 3750 then
    raise exception 'GBP siniri 3750 olmali, % cikti', v_gbp;
  end if;
  -- 50 USD = 18,80 BHD = 18800 fils (3 hane)
  if v_bhd <> 18800 then
    raise exception 'BHD siniri 18800 olmali, % cikti', v_bhd;
  end if;
  -- 50 USD = 6250 ISK (0 hane)
  if v_isk <> 6250 then
    raise exception 'ISK siniri 6250 olmali, % cikti', v_isk;
  end if;

  select count(*) into v_kalan
    from public.products
   where status in ('active', 'out_of_stock')
     and price_cents < coalesce(public.listing_min_price_cents(currency), 9223372036854775807);
  if v_kalan <> 0 then
    raise exception 'sinirin altinda % yayinda teklif kaldi', v_kalan;
  end if;
end;
$$;

commit;
