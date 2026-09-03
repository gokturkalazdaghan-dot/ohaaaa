-- ===========================================================================
-- TAZELİK MOTORU — hangi bilgiyi NE ZAMAN doğruladık?
-- ---------------------------------------------------------------------------
-- ÇÖZÜLEN PROBLEM
-- Bugün tek bir tazelik sinyali var: `last_seen_at` -- teklifin feed'de en
-- son ne zaman GÖRÜLDÜĞÜ. Ama bir teklifi görmek, fiyatını doğrulamak
-- değildir. Feed teklifi listelemeye devam ederken fiyatı saatler önce
-- ölçülmüş olabilir.
--
-- Somut sonuç: kullanıcıya "şu an 1.200 TL" diyoruz ama o sayıyı en son
-- ne zaman ölçtüğümüzü bilmiyoruz. Fiyat karşılaştırma sitesinin
-- söyleyebileceği en kötü yalan, eski bir fiyatı güncel diye sunmaktır.
--
-- ÜÇ AYRI SORU, ÜÇ AYRI DAMGA
--   price_checked_at  — fiyatı en son ne zaman DOĞRULADIK?
--   stock_checked_at  — stok bilgisini en son ne zaman doğruladık?
--   offer_checked_at  — teklifin kendisini (adres, kargo) ne zaman?
--
-- Bunlar `last_seen_at`'in yerine geçmiyor, onu AYRIŞTIRIYOR.
--
-- DEĞİŞİM DAMGALARI AYRI
--   last_price_change_at / last_stock_change_at
-- "Kontrol ettik" ile "değişti" farklı olaylardır. Uyarlanabilir yoklama
-- (adaptive polling) tam olarak bu ikisinin arasındaki orana bakar: sık
-- kontrol edilip hiç değişmeyen bir ürün daha seyrek kontrol edilebilir.
-- ===========================================================================

alter table public.products
  add column price_checked_at      timestamptz,
  add column stock_checked_at      timestamptz,
  add column offer_checked_at      timestamptz,
  add column last_price_change_at  timestamptz,
  add column last_stock_change_at  timestamptz;

comment on column public.products.price_checked_at is
  'Fiyatin en son DOGRULANDIGI an. last_seen_at ile ayni sey degil: teklifi '
  'gormek fiyatini dogrulamak degildir.';
comment on column public.products.stock_checked_at is
  'Stok bilgisinin en son dogrulandigi an.';
comment on column public.products.offer_checked_at is
  'Teklifin kendisinin (adres, kargo) en son dogrulandigi an.';
comment on column public.products.last_price_change_at is
  'Fiyatin en son DEGISTIGI an. Kontrol ile degisim ayri olaylar.';
comment on column public.products.last_stock_change_at is
  'Stok durumunun en son degistigi an.';

/*
 * NULL = "HİÇ ÖLÇMEDİK", 0 dakika değil.
 *
 * Sütunlar bilerek NULL kabul ediyor ve varsayılanları yok. `now()`
 * varsayılanı vermek, hiç ölçülmemiş bir fiyatı "az önce doğrulandı"
 * diye işaretlerdi -- yani veriyi olduğundan taze göstermek. Mevcut
 * satırlar da bu yüzden NULL kalıyor.
 */

-- Tazelik sorgularının sıcak yolu: "şu pazarda fiyatı en bayat olanlar".
create index products_price_freshness_idx
  on public.products (market, price_checked_at nulls first)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Tetikleyici: fiyat/stok gerçekten DEĞİŞTİĞİNDE damgala
-- ---------------------------------------------------------------------------
create or replace function public.tg_products_touch_freshness()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  /*
   * Alım hattı her çalışmada tüm teklifleri upsert eder; çoğunda fiyat
   * AYNIDIR. Değişim damgasını her upsert'te güncellemek, "bu ürünün
   * fiyatı sürekli değişiyor" yanılsaması üretirdi -- ve uyarlanabilir
   * yoklama tam olarak bu sinyale bakıyor.
   */
  if tg_op = 'UPDATE' then
    if new.price_cents is distinct from old.price_cents then
      new.last_price_change_at := pg_catalog.now();
    end if;

    -- Stokta DEĞİŞİM, "var/yok" geçişidir; 12'den 11'e düşmek değil.
    if (new.stock > 0) is distinct from (old.stock > 0) then
      new.last_stock_change_at := pg_catalog.now();
    end if;
  end if;

  return new;
end;
$$;

comment on function public.tg_products_touch_freshness() is
  'Fiyat/stok DEGISTIGINDE damga atar. Her upsert''te degil -- aksi halde '
  'degismeyen bir urun surekli degisiyor gorunurdu.';

create trigger products_touch_freshness
  before update on public.products
  for each row execute function public.tg_products_touch_freshness();

-- ---------------------------------------------------------------------------
-- Yardımcılar — offer_freshness'ten ÖNCE tanımlanır
-- ---------------------------------------------------------------------------
-- `search_path = ''` altında niteliksiz ad çözümlemesi kapalı; bu yüzden
-- çağrılar `public.` ile nitelenir. Nitelemeseydik fonksiyon derlenirdi ama
-- ÇALIŞMA ANINDA "function does not exist" verirdi -- yani hata testte
-- değil, üretimde çıkardı.

create or replace function public.freshness_age_minutes(p_an timestamptz)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_an is null then null
              else round(extract(epoch from (now() - p_an)) / 60.0, 1)
         end;
$$;

comment on function public.freshness_age_minutes(timestamptz) is
  'Bir damganin kac dakika onceye ait oldugu. NULL girdi NULL doner: '
  '"olculmedi" sifir dakika DEGILDIR.';

create or replace function public.freshness_component(
  p_an timestamptz, p_yas numeric, p_esik integer
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'checked_at', p_an,
    'age_minutes', p_yas,
    -- "olculmedi" ile "bayat" AYRI: birincisi hic bakmadigimiz,
    -- ikincisi baktigimiz ama uzun sure once baktigimiz anlamina gelir.
    'state', case when p_yas is null then 'olculmedi'
                  when p_yas <= p_esik then 'taze'
                  else 'bayat' end);
$$;

comment on function public.freshness_component(timestamptz, numeric, integer) is
  'Tek bir tazelik bileseninin govdesi.';

-- ---------------------------------------------------------------------------
-- offer_freshness() — bir teklifin tazelik tablosu
-- ---------------------------------------------------------------------------
create or replace function public.offer_freshness(
  p_product_id uuid,
  p_max_staleness_minutes integer default 720
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  v_price_yas numeric;
  v_stok_yas  numeric;
  v_teklif_yas numeric;
  v_en_kotu   numeric;
begin
  select price_checked_at, stock_checked_at, offer_checked_at, last_seen_at, status
    into v
    from public.products
   where id = p_product_id;

  if not found then
    return jsonb_build_object('available', false, 'reason', 'teklif_yok');
  end if;

  v_price_yas  := public.freshness_age_minutes(v.price_checked_at);
  v_stok_yas   := public.freshness_age_minutes(v.stock_checked_at);
  v_teklif_yas := public.freshness_age_minutes(v.offer_checked_at);

  /*
   * GENEL TAZELİK = EN BAYAT BİLEŞEN.
   *
   * Ortalama almak yanlış olurdu: stoğu 2 dakika önce, fiyatı 10 saat
   * önce doğrulanmış bir teklifin ortalaması "5 saat" der ve kimseye bir
   * şey anlatmaz. Kullanıcıyı yanıltan şey en bayat bilgidir.
   *
   * Hiç ölçülmemiş bir bileşen (NULL) en bayat sayılır -- "bilmiyoruz",
   * "taze" değildir.
   */
  if v_price_yas is null or v_stok_yas is null or v_teklif_yas is null then
    v_en_kotu := null;
  else
    v_en_kotu := greatest(v_price_yas, v_stok_yas, v_teklif_yas);
  end if;

  return jsonb_build_object(
    'available',   true,
    'product_id',  p_product_id,
    'price',  public.freshness_component(v.price_checked_at,  v_price_yas,  p_max_staleness_minutes),
    'stock',  public.freshness_component(v.stock_checked_at,  v_stok_yas,   p_max_staleness_minutes),
    'offer',  public.freshness_component(v.offer_checked_at,  v_teklif_yas, p_max_staleness_minutes),
    'last_seen_at', v.last_seen_at,
    'overall', jsonb_build_object(
      'age_minutes', v_en_kotu,
      'state', case
        when v_en_kotu is null then 'olculmedi'
        when v_en_kotu <= p_max_staleness_minutes then 'taze'
        else 'bayat'
      end,
      'max_staleness_minutes', p_max_staleness_minutes));
end;
$$;

-- --- Erişim ----------------------------------------------------------------
-- Tazelik bilgisi vitrinin bir parçası: kullanıcıya "bu fiyat ne kadar
-- güncel" diyebilmek için gerekli. Okumaya açık; yazma yolu yok.
grant execute on function public.offer_freshness(uuid, integer) to anon, authenticated, service_role;
grant execute on function public.freshness_age_minutes(timestamptz) to anon, authenticated, service_role;
grant execute on function public.freshness_component(timestamptz, numeric, integer) to anon, authenticated, service_role;

grant select (price_checked_at, stock_checked_at, offer_checked_at,
              last_price_change_at, last_stock_change_at)
  on public.products to anon, authenticated;
