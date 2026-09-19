-- ===========================================================================
-- KALAN İKİ TOPLU İŞLEM DE KENDİ SÜRE TAVANINI TAŞIYAN RPC'YE ALINIYOR
-- ---------------------------------------------------------------------------
-- `ingest_upsert_offers` (#84) teklif yazmayı kurtardı ve ölçüm bunu
-- doğruladı: ilk kez `items_created = 1042`, `items_updated = 2477`.
-- Hata ise zincirin SON adımına taşındı:
--
--   Bayat teklifler işaretlenemedi: canceling statement due to statement timeout
--
-- `markStale` TEK bir toplu UPDATE (bu turda 1.766 satır) ve hâlâ PostgREST
-- üzerinden 8 saniyelik `authenticator` tavanına tabi. ~20 ms/satır ile
-- yaklaşık 35 saniye sürüyor -- eşiğin dört katı.
--
-- ---------------------------------------------------------------------------
-- touchSeen DE ALINIYOR, AMA SEBEBİ FARKLI
-- ---------------------------------------------------------------------------
-- `touchSeen` bugün ÇALIŞIYOR: `chunkByUrlBudget` onu 166 satırlık parçalara
-- bölüyor. Ama o parçalama bir süre kararı değil, bir ADRES UZUNLUĞU kararı:
-- `.in(...)` değerleri GET adresine giriyor ve adres 2.000 karakterle
-- sınırlanıyor. RPC ise POST gövdesiyle çağrılır -- o sınır ortadan kalkar.
--
-- Ölçülen bedeli: 35.591 kimlik / 166 = 216 ayrı HTTP turu ve turun 408
-- saniyesinin ~205'i bu adımda geçiyor. Aynı iş tek ifadede yapılabilir.
--
-- ---------------------------------------------------------------------------
-- İKİSİNDE DE KAPSAM ROL DEĞİL, FONKSİYON
-- ---------------------------------------------------------------------------
--   anon 3 sn · authenticated 8 sn · service_role 8 sn -- HİÇBİRİ DEĞİŞMİYOR
--   yalnızca bu iki fonksiyon, yalnızca kendi gövdeleri boyunca 60 sn
--
-- `SECURITY DEFINER` oldukları için yetkileri de daraltıldı: `anon` ve
-- `authenticated` çağıramaz. Dışarıya açık bir uzun-sorgu ucu bırakmıyoruz.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) GÖRÜLME DAMGASI
-- ---------------------------------------------------------------------------
create or replace function public.ingest_touch_seen(
  p_source_id    uuid,
  p_external_ids text[],
  p_checked_at   timestamptz
)
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
declare
  v_sayi integer;
begin
  if p_source_id is null then
    raise exception 'OHAAAA_KAYNAK_YOK: p_source_id zorunlu'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_external_ids is null or cardinality(p_external_ids) = 0 then
    return 0;
  end if;

  /*
   * Dört damga birden: bir feed satırı bu bilgilerin hepsini AYNI
   * gözlemden taşıyor. Ayrı ayrı yazmak, tek bir gözlemi üç farklı ana
   * bölmek olurdu.
   *
   * `last_price_change_at` BURADA YAZILMAZ -- onu tetikleyici, fiyat
   * gerçekten değiştiğinde atıyor.
   */
  update public.products
     set last_seen_at     = p_checked_at,
         price_checked_at = p_checked_at,
         stock_checked_at = p_checked_at,
         offer_checked_at = p_checked_at
   where source_id = p_source_id
     and external_id = any(p_external_ids);

  get diagnostics v_sayi = row_count;
  return v_sayi;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2) BAYAT TEKLİFLER
-- ---------------------------------------------------------------------------
create or replace function public.ingest_mark_stale_offers(
  p_source_id       uuid,
  p_run_started_at  timestamptz
)
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
declare
  v_sayi integer;
begin
  if p_source_id is null or p_run_started_at is null then
    raise exception 'OHAAAA_EKSIK_PARAMETRE: p_source_id ve p_run_started_at zorunlu'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * Bu çalışmada görülmeyen teklifler STOKSUZ işaretlenir -- SİLİNMEZ.
   * Silme geri alınamaz; stoksuz işaretleme bir sonraki başarılı alımda
   * kendiliğinden düzelir.
   *
   * `status = 'active'` koşulu şart: zaten stoksuz olanları tekrar yazmak
   * boşuna güncelleme ve boşuna tetikleyici demek.
   */
  update public.products
     set status = 'out_of_stock',
         stock  = 0
   where source_id = p_source_id
     and last_seen_at < p_run_started_at
     and status = 'active';

  get diagnostics v_sayi = row_count;
  return v_sayi;
end;
$function$;

-- ---------------------------------------------------------------------------
-- YETKİ DARALTMA
-- ---------------------------------------------------------------------------
revoke all on function public.ingest_touch_seen(uuid, text[], timestamptz) from public;
revoke all on function public.ingest_touch_seen(uuid, text[], timestamptz) from anon;
revoke all on function public.ingest_touch_seen(uuid, text[], timestamptz) from authenticated;
grant execute on function public.ingest_touch_seen(uuid, text[], timestamptz) to service_role;

revoke all on function public.ingest_mark_stale_offers(uuid, timestamptz) from public;
revoke all on function public.ingest_mark_stale_offers(uuid, timestamptz) from anon;
revoke all on function public.ingest_mark_stale_offers(uuid, timestamptz) from authenticated;
grant execute on function public.ingest_mark_stale_offers(uuid, timestamptz) to service_role;

do $$
declare
  v_ad      text;
  v_eksik   text := '';
begin
  foreach v_ad in array array['ingest_touch_seen', 'ingest_mark_stale_offers'] loop
    if not exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace,
           unnest(p.proconfig) cfg
       where n.nspname = 'public' and p.proname = v_ad
         and cfg like 'statement_timeout=%'
    ) then
      v_eksik := v_eksik || v_ad || ' (sure tavani) ';
    end if;

    if not exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace,
           unnest(p.proconfig) cfg
       where n.nspname = 'public' and p.proname = v_ad
         and cfg like 'search\_path=%'
    ) then
      v_eksik := v_eksik || v_ad || ' (search_path) ';
    end if;
  end loop;

  if v_eksik <> '' then
    raise exception 'RPC ayarlari eksik: %', v_eksik;
  end if;

  if has_function_privilege('anon',
       'public.ingest_touch_seen(uuid, text[], timestamptz)', 'execute')
     or has_function_privilege('anon',
       'public.ingest_mark_stale_offers(uuid, timestamptz)', 'execute') then
    raise exception 'RPC''ler anon tarafindan cagrilabiliyor';
  end if;

  raise notice 'toplu damga ve bayat RPC''leri kuruldu (60 sn, anon cagiramaz)';
end $$;
