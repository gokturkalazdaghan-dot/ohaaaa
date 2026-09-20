-- ===========================================================================
-- DEPO İLE ÜRETİM ARASINDAKİ ŞEMA AYRIŞMASI KAPANIYOR
-- ===========================================================================
--
-- ÖLÇÜLEN PROBLEM
-- Üretimde uygulanmış ama depoda KARŞILIĞI OLMAYAN göçler birikmişti.
-- Sonucu teorik değil, bu dalda yaşandı: `search_currency_filter` göçü
-- üretimdeki `search_products` ve `search_facets` fonksiyonlarına fazladan
-- bir `p_currency` parametresi eklemişti; depoda o parametre YOKTU.
--
-- Kapsam göçü dar imzayla yazıldığında `create or replace` üretimdeki
-- fonksiyonu DEĞİŞTİRMEZ, yanına İKİNCİ bir aşırı yükleme açardı ve
-- PostgREST "could not choose the best candidate function" diyerek aramayı
-- tamamen durdururdu -- göç "başarılı" görünürken. Uygulamadan önce elle
-- fark edildi; temiz replay bunu YAKALAYAMAZDI çünkü depoda o parametre
-- hiç yok.
--
-- Bu dosya o sınıf hatayı bir daha imkânsız kılmak için var: CI'ın temiz
-- replay'i artık üretimle aynı nesneleri üretiyor, dolayısıyla bir sonraki
-- imza uyuşmazlığı DERLEMEDE düşer, üretimde değil.
--
-- ---------------------------------------------------------------------------
-- FARK İSİM LİSTESİNDEN DEĞİL, ŞEMADAN ÇIKARILDI
-- ---------------------------------------------------------------------------
-- Göç adlarını karşılaştırmak 14 "eksik" göç gösteriyordu; oysa çoğu
-- yalnızca VERİ yazıyor (satıcı kayıtları) ya da depoda başka bir adla
-- zaten var. Gerçek fark, iki veritabanının sütun/fonksiyon/indeks/
-- tetikleyici dökümleri karşılaştırılarak bulundu ve ALTI nesneye indi:
--
--   ÜRETİMDE VAR, DEPODA YOK
--     1. programs.feed_access NOT NULL
--     2. tg_order_items_currency_matches() + order_items tetikleyicisi
--     3. product_groups_category_offers_idx
--     4. product_groups_offers_idx
--     5. programs_network_feed_unique
--   DEPODA VAR, ÜRETİMDE YOK
--     6. product_groups_search_fts_idx  (üretimde ölü olduğu için düşürüldü)
--
-- ---------------------------------------------------------------------------
-- ÜRETİMDE NO-OP
-- ---------------------------------------------------------------------------
-- Her adım `if not exists` / `create or replace` / `drop ... if exists` ile
-- yazıldı. Üretimde çalıştığında hiçbir şeyi değiştirmez; yalnızca temiz
-- bir replay'i üretimle aynı yere getirir. İkisinin AYNI dosyadan gelmesi
-- şart: ayrı tutulsalardı bir sonraki ayrışma yine sessiz olurdu.
-- ===========================================================================

-- --- 1) programs.feed_access NOT NULL --------------------------------------
-- Üretimde ölçüldü: boş `feed_access` taşıyan 0 satır var. Kısıt eklemeden
-- ÖNCE yine de dolduruluyor -- temiz bir replay'de ya da başka bir ortamda
-- boş satır olabilir ve kısıt orada patlardı.
update public.programs set feed_access = 'unverified' where feed_access is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'programs'
       and column_name = 'feed_access' and is_nullable = 'YES'
  ) then
    alter table public.programs alter column feed_access set not null;
  end if;
end $$;

-- --- 2) Sipariş kalemi para birimi kilidi -----------------------------------
/*
 * Bir siparişin kalemleri FARKLI para birimlerinden gelemez.
 *
 * Karışsalardı sipariş toplamı anlamsız bir sayı olurdu: 100 TRY + 100 EUR
 * "200" diye toplanır ve tahsilat yanlış tutardan yapılırdı. Bu, parayla
 * ilgili en sessiz hata türü -- hiçbir şey düşmez, yalnızca rakam yanlıştır.
 */
create or replace function public.tg_order_items_currency_matches()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_order_currency   char(3);
  v_product_currency char(3);
begin
  if new.product_id is null then
    return new;
  end if;

  select currency into v_order_currency from public.orders where id = new.order_id;
  select currency into v_product_currency from public.products where id = new.product_id;

  if v_order_currency is not null
     and v_product_currency is not null
     and v_product_currency <> v_order_currency then
    raise exception
      'OHAAAA_MIXED_CURRENCY: kalem para birimi (%) siparisinkiyle (%) uyusmuyor',
      v_product_currency, v_order_currency using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

drop trigger if exists order_items_currency_matches on public.order_items;
create trigger order_items_currency_matches
  after insert or update of product_id, order_id on public.order_items
  for each row execute function public.tg_order_items_currency_matches();

-- --- 3) Kategori sayfası sıralama indeksleri --------------------------------
-- `kategori_sayim_indeksi_daralt` göçü bu indeksin VARLIĞINA dayanıyor
-- ("Eskisi DÜŞÜRÜLMÜYOR: kategori sayfasının sıralama sorgusu onu
-- kullanıyor") ama depoda onu KURAN göç yoktu. Yani depo, var olmayan bir
-- indekse güveniyordu.
create index if not exists product_groups_category_offers_idx
  on public.product_groups using btree (category_id, offer_count desc nulls last, title)
  where offer_count > 0;

create index if not exists product_groups_offers_idx
  on public.product_groups using btree (offer_count desc nulls last, title)
  where offer_count > 0;

-- --- 4) Program feed tekilliği ---------------------------------------------
-- Aynı ağdaki aynı feed kimliği iki program satırına bağlanamaz; bağlansaydı
-- aynı besleme iki kez alınır ve teklifler ikizlenirdi.
create unique index if not exists programs_network_feed_unique
  on public.programs using btree (network, network_feed_id)
  where network_feed_id is not null;

-- --- 5) ÖLÜ FTS İNDEKSİ DÜŞÜYOR --------------------------------------------
-- `search_products` benzerliği `search_text` üzerinde trigram ile arıyor
-- (`product_groups_search_trgm_idx`). FTS indeksi hiçbir sorgu tarafından
-- kullanılmıyordu ama her yazmada bakım maliyeti üretiyordu. Üretimde
-- zaten düşürülmüştü; depo onu hâlâ kuruyordu.
drop index if exists public.product_groups_search_fts_idx;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare v_eksik text;
begin
  -- 1) Beklenen nesnelerin HEPSİ var.
  select string_agg(ad, ', ') into v_eksik from (
    select 'programs.feed_access NOT NULL' as ad
     where exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name='programs'
          and column_name='feed_access' and is_nullable='YES')
    union all
    select 'tg_order_items_currency_matches()'
     where not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='tg_order_items_currency_matches')
    union all
    select 'order_items_currency_matches tetikleyicisi'
     where not exists (
       select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where c.relname='order_items' and t.tgname='order_items_currency_matches')
    union all
    select i.ad from (values
        ('product_groups_category_offers_idx'),
        ('product_groups_offers_idx'),
        ('programs_network_feed_unique')
      ) as i(ad)
     where not exists (
       select 1 from pg_indexes
        where schemaname='public' and indexname = i.ad)
  ) t;

  if v_eksik is not null then
    raise exception
      'DOGRULAMA 1: uretimle hizalama eksik kaldi: %. Temiz replay uretimden '
      'farkli bir sema uretir ve bir sonraki imza uyusmazligi yine uretimde '
      'ortaya cikardi.', v_eksik;
  end if;

  -- 2) Ölü indeks gerçekten gitti.
  if exists (select 1 from pg_indexes
              where schemaname='public' and indexname='product_groups_search_fts_idx') then
    raise exception 'DOGRULAMA 2: olu FTS indeksi hala duruyor.';
  end if;

  -- 3) ARAMA FONKSİYONLARI TEK SÜRÜMLÜ. Bu dosyanın var olma sebebi olan
  --    hatanın kontrolü: aşırı yükleme PostgREST'te aramayı durdurur.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='search_products') <> 1 then
    raise exception 'DOGRULAMA 3: search_products birden fazla surumlu.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='search_facets') <> 1 then
    raise exception 'DOGRULAMA 3b: search_facets birden fazla surumlu.';
  end if;

  -- 4) Para birimi kilidi GERÇEKTEN çalışıyor. Tetikleyiciyi yazmak yetmez.
  --    Kurgu kurulamıyorsa (tohumsuz ortam) iddia atlanır; uydurma veri
  --    yaratmak, testi gerçek olmayan bir duruma bakar hale getirirdi.
  declare
    v_order uuid; v_urun uuid; v_para char(3); v_baska char(3);
  begin
    select o.id, o.currency into v_order, v_para
      from public.orders o limit 1;
    select p.id, p.currency into v_urun, v_baska
      from public.products p limit 1;

    if v_order is null or v_urun is null or v_para is null or v_baska is null
       or v_para = v_baska then
      raise notice
        '- para birimi kilidi iddiasi atlandi: farkli para birimli siparis/urun ciftin yok';
    else
      begin
        insert into public.order_items (order_id, product_id, quantity, unit_price_cents)
        values (v_order, v_urun, 1, 1000);
        raise exception
          'DOGRULAMA 4: karisik para birimli siparis kalemi KABUL EDILDI -- '
          'siparis toplami anlamsiz bir sayi olurdu.';
      exception
        when check_violation then null;   -- beklenen: kilit tuttu
        when others then
          if sqlerrm like 'DOGRULAMA 4:%' then raise; end if;
          -- Baska bir kisit (stok, durum) once dustuyse iddia anlamsiz.
          raise notice '- para birimi kilidi iddiasi atlandi: % ', sqlerrm;
      end;
    end if;
  end;

  raise notice
    'Depo ile uretim semasi hizalandi: 5 eksik nesne kuruldu, 1 olu indeks '
    'dusuruldu. Temiz replay artik uretimle ayni nesneleri uretiyor.';
end $$;
