-- =============================================================================
-- PAZAR SÜZGECİ: grubun pazarı `product_groups` üzerinde denormalize ediliyor
-- =============================================================================
-- ÖLÇÜLEN ARIZA (canlı, 26 Eylül 2026)
-- `/de-at`, `/en-us`, `/en-pl`, `/en-uk` adreslerinin dördü de AYNI 16 İngiltere
-- ürününü sterlinle gösteriyordu. Adres öneki dili ve para birimi SİMGESİNİ
-- değiştiriyor ama katalogu hiç süzmüyordu: `SearchParams` arayüzünde pazar
-- alanı hiç yoktu, dolayısıyla RPC'lere de gitmiyordu.
--
-- Avusturyalı ziyaretçiye 629 £'lik bir iPad gösteriliyordu; veritabanında
-- 11.132 aktif Avusturya teklifi (EUR) dururken.
--
-- NEDEN PARA BİRİMİ SÜZGECİ DEĞİL
-- `search_products`/`search_facets` zaten `p_currency` alıyor ve
-- `product_groups.price_currency` dolu. Yani bedava görünen bir yol vardı.
-- Ölçüm onu çürüttü -- para birimi pazarın vekili DEĞİL, iki yönde de yanlış:
--
--   • EUR dört pazarda ortak (AT 11.132, IE 6.779, PL 1.188, IT 2 aktif
--     teklif). EUR süzgeci Avusturyalıya İrlanda ve Polonya envanterini
--     gösterirdi.
--   • PL pazarının `markets.default_currency` değeri PLN, ama PL envanterinin
--     TAMAMI EUR. PLN süzgeci Polonyalıya BOŞ katalog gösterirdi.
--
-- Kullanıcıya verilen söz "bu ülkede alınabilen ürünler"; para birimi o sözün
-- sonucu, tanımı değil.
--
-- NEDEN YENİ BİR SÜTUN, `product_group_markets` DEĞİL
-- 20260914040000 göçü grup × pazar kırılımında bir tablo ve
-- `refresh_group_market_cache` fonksiyonu yarattı. İkisi de ÜRETİMDE VAR ama
-- tablo BOŞ (0 satır) ve onu besleyen hiçbir tetikleyici yok -- ölü altyapı.
-- (Göç başlığı "üretimde çalıştırılmadı" diyor; ölçüm aksini söylüyor. Bu
-- göç o tabloya DOKUNMUYOR, kaldırmıyor da: kaldırmak ayrı bir karar.)
--
-- Onu beslemek, `refresh_product_group_stats` her çağrıldığında bir ek
-- delete+insert demekti. O fonksiyon `products` üzerinde SATIR BAZLI bir
-- tetikleyiciden çağrılıyor ve alım koşusu başına ~50.000 satır yazıyoruz;
-- tetikleyici maliyetini 2-3 katına çıkarırdı. Burada eklenen ise aynı
-- fonksiyonun içinde tek bir `select ... into` -- grup başına, indeksten.
--
-- NEDEN TEK SÜTUN YETİYOR (VE YETMEDİĞİ GÜN NE OLACAK)
-- Ölçüldü: aktif teklifi olan 39.266 grubun TAMAMI tek pazara ait
-- (`count(distinct market_code) = 1`, çok pazarlı grup SIFIR). Yani bugün
-- grubun pazarı tek değerli bir olgudur ve `product_groups` üzerindeki
-- mevcut önbellek (`min_price_cents`, `offer_count`, `best_offer_id`) zaten
-- O PAZARIN rakamlarıdır -- 20260914040000 başlığındaki "küresel fiyat
-- gösterilir" itirazı bugünkü veride ısırmıyor.
--
-- Eşleştirme bir gün aynı kanonik gruba hem İngiltere hem Avusturya teklifi
-- bağladığında tek sütun bunu ifade EDEMEZ. O yüzden sütunun anlamı açıkça
-- "baskın para biriminin tekliflerinin ORTAK pazarı, birden fazlaysa NULL":
-- çok pazarlı grup pazar süzgecinden sessizce yanlış çıkmaz, GÖRÜNÜR biçimde
-- düşer. `product_group_markets`'a terfi etmenin işareti o gün gelir.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Sütun
-- ---------------------------------------------------------------------------
alter table public.product_groups
  add column if not exists market_code text
    references public.markets (code) on delete restrict;

comment on column public.product_groups.market_code is
  'Grubun baskin para birimindeki aktif tekliflerinin ORTAK pazari. '
  'Teklifler birden fazla pazara yayiliyorsa NULL -- uydurma bir pazar '
  'secilmez. refresh_product_group_stats tarafindan yazilir.';

-- ---------------------------------------------------------------------------
-- 2) Besleme: mevcut fonksiyonun içine tek bir okuma eklendi
-- ---------------------------------------------------------------------------
-- Fonksiyonun geri kalanı BİREBİR aynı. Eklenen tek şey `v_pazar` ve onun
-- iki `update` içindeki yazımı.
--
-- Pazar, BASKIN PARA BİRİMİNİN satırlarından türetiliyor; `product_groups`
-- üzerindeki fiyat rakamları da aynı satırlardan geliyor. Başka bir küme
-- kullanmak, "şu fiyat" ile "şu pazar"ın farklı tekliflere işaret ettiği
-- sessiz bir tutarsızlık üretirdi.
create or replace function public.refresh_product_group_stats(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_baskin char(3);
  v_pazar  text;
begin
  if p_group_id is null then
    return;
  end if;

  delete from public.product_group_price_stats where group_id = p_group_id;

  insert into public.product_group_price_stats
    (group_id, currency, offer_count, min_price_cents, max_price_cents, best_offer_id)
  select
    p_group_id,
    p.currency,
    count(*),
    min(p.price_cents),
    max(p.price_cents),
    (select p2.id
       from public.products p2
      where p2.group_id = p_group_id
        and p2.currency = p.currency
        and p2.status = 'active' and p2.stock > 0
      order by (p2.price_cents + p2.shipping_fee_cents) asc,
               p2.estimated_delivery_days asc,
               p2.created_at asc
      limit 1)
  from public.products p
  where p.group_id = p_group_id
    and p.status = 'active'
    and p.stock > 0
  group by p.currency;

  select currency into v_baskin
    from public.product_group_price_stats
   where group_id = p_group_id
   order by offer_count desc, currency asc
   limit 1;

  /*
   * TEK PAZAR YOKSA NULL. `count(distinct) = 1` koşulu bilerek: teklifler
   * iki pazara yayılmışsa birini seçmek, seçilmeyen pazarın ziyaretçisine
   * o grubu göstermek ya da göstermemek arasında GÖRÜNMEZ bir karar
   * vermek olurdu.
   */
  if v_baskin is not null then
    select case when count(distinct p.market_code) = 1 then min(p.market_code) end
      into v_pazar
      from public.products p
     where p.group_id = p_group_id
       and p.status = 'active' and p.stock > 0
       and p.currency = v_baskin;
  end if;

  update public.product_groups g
     set offer_count     = coalesce(s.offer_count, 0),
         min_price_cents = s.min_price_cents,
         max_price_cents = s.max_price_cents,
         best_offer_id   = s.best_offer_id,
         price_currency  = v_baskin,
         market_code     = v_pazar,
         updated_at      = now()
    from (
      select * from public.product_group_price_stats
       where group_id = p_group_id and currency = v_baskin
    ) s
   where g.id = p_group_id;

  if v_baskin is null then
    update public.product_groups
       set offer_count = 0, min_price_cents = null, max_price_cents = null,
           best_offer_id = null, price_currency = null, market_code = null,
           updated_at = now()
     where id = p_group_id;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Geri doldurma
-- ---------------------------------------------------------------------------
-- Fonksiyonu 39.266 kez çağırmak yerine aynı kuralı TEK ifadede uyguluyoruz;
-- sonuç birebir aynı küme (ikisi de "baskın para biriminin ortak pazarı").
--
-- PARÇA PARÇA, ÇÜNKÜ TEK İFADE ZAMAN AŞIMINA UĞRADI. İlk deneme tek
-- `update` ile yapıldı ve 60 saniyelik istemci sınırını aştı; göç tamamen
-- geri alındı (ölçüldü: sütun oluşmamıştı). Pazar pazar yürümek her adımı
-- küçük ve yeniden çalıştırılabilir tutuyor.
--
-- `updated_at` TAZELENİR. `product_groups_set_updated_at` her `update`'te
-- ateşlenen bir BEFORE tetikleyicisi ve bunu burada bastırmıyoruz: satır
-- gerçekten değişiyor. Zararsız olduğu doğrulandı -- `sitemap.ts`
-- `lastModified` değerlerinin tamamını `now`'dan üretiyor, `updated_at`'i
-- hiç okumuyor; yani arama motoruna "39 bin URL değişti" denmiyor.
--
-- `product_groups_kategori_ata` ateşlenmez: tanımı `update of title, brand,
-- category_id` ile sınırlı, burada yalnızca `market_code` yazılıyor. Bu
-- önemli -- ateşlenseydi geri doldurma sessizce KATEGORİ de değiştirirdi.
with baskin as (
  select distinct on (group_id) group_id, currency
    from public.product_group_price_stats
   order by group_id, offer_count desc, currency asc
),
pazar as (
  select p.group_id,
         case when count(distinct p.market_code) = 1 then min(p.market_code) end as market_code
    from public.products p
    join baskin b on b.group_id = p.group_id and b.currency = p.currency
   where p.status = 'active' and p.stock > 0
   group by p.group_id
)
update public.product_groups g
   set market_code = pazar.market_code
  from pazar
 where g.id = pazar.group_id
   and g.market_code is distinct from pazar.market_code;

-- ---------------------------------------------------------------------------
-- 4) İndeksler
-- ---------------------------------------------------------------------------
-- Her biri GERÇEK bir sorgu yolunun karşılığı; pazar öneki eklenmiş hâlleri
-- dışında mevcut indekslerle aynı sütun ve YÖNLERİ taşıyorlar. `desc` için
-- `nulls last` açıkça yazılıyor: varsayılan `nulls first` olduğu için
-- eşleşmezse planlayıcı indeksi sıralama için kullanamaz.

-- Ana sayfa / mağaza: `relevance` (serbest metin yokken yalnızca title asc).
create index if not exists product_groups_pazar_baslik_idx
  on public.product_groups (market_code, title)
  where offer_count > 0;

-- `offers` sıralaması.
create index if not exists product_groups_pazar_teklif_idx
  on public.product_groups (market_code, offer_count desc nulls last, title)
  where offer_count > 0;

-- `price_asc` ve `price_desc` (aynı indeks ters yönde de okunur).
create index if not exists product_groups_pazar_fiyat_idx
  on public.product_groups (market_code, min_price_cents, title)
  where offer_count > 0;

-- Kategori sayfası.
create index if not exists product_groups_pazar_kategori_idx
  on public.product_groups (market_code, category_id, offer_count desc nulls last, title)
  where offer_count > 0;

-- Facet: product_groups_facet_covering_idx'in pazar önekli ikizi.
create index if not exists product_groups_pazar_facet_idx
  on public.product_groups (market_code, category_id)
  include (id, min_price_cents, brand, price_currency)
  where offer_count > 0;

-- ---------------------------------------------------------------------------
-- 5) VACUUM -- ATLANAMAZ
-- ---------------------------------------------------------------------------
-- 39.266 satırlık geri doldurmadan sonra görünürlük haritası boş kalıyor ve
-- indeks-YALNIZ taramalar yığına inmek zorunda kalıyor. Ölçüldü:
--
--   vacuum ÖNCE   katalog_pazarlari()  3.205 ms  (Heap Fetches: 26.505)
--   vacuum SONRA  katalog_pazarlari()    326 ms  (Heap Fetches: 0)
--
-- `anon` rolünün `statement_timeout` sınırı 3 saniye; yani vacuum atlanırsa
-- bu fonksiyon üretimde SINIRA DAYANIR ve pazar süzgeci sessizce kapanır
-- (okunamayan liste = süzgeç yok).
--
-- Göç dosyasının içinde DEĞİL, çünkü `vacuum` bir işlem bloğunda
-- çalıştırılamaz. Göç uygulandıktan sonra ayrıca çalıştırılır:
--
--   vacuum (analyze) public.product_groups;

-- ---------------------------------------------------------------------------
-- GERİ ALMA
-- ---------------------------------------------------------------------------
-- drop index if exists public.product_groups_pazar_facet_idx;
-- drop index if exists public.product_groups_pazar_kategori_idx;
-- drop index if exists public.product_groups_pazar_fiyat_idx;
-- drop index if exists public.product_groups_pazar_teklif_idx;
-- drop index if exists public.product_groups_pazar_baslik_idx;
-- alter table public.product_groups drop column if exists market_code;
-- (refresh_product_group_stats'in onceki tanimi 20260829090100 gocunde.)
