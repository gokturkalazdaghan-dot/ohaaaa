-- ===========================================================================
-- TOPLU TEKLİF YAZMA: KENDİ SÜRE TAVANINI TAŞIYAN RPC
-- ---------------------------------------------------------------------------
-- NEDEN: 8 SANİYE ETKİLEŞİMLİ İSTEK İÇİN, TOPLU YAZMA İÇİN DEĞİL
--
-- PostgREST'in bağlandığı `authenticator` rolünde `statement_timeout = 8s`
-- (üretimde ölçüldü) ve `service_role` kendi ayarı olmadığı için onu miras
-- alıyor. O eşik bir API isteği için DOĞRU bir korumadır: bir sayfa sorgusu
-- sekiz saniye sürüyorsa zaten bir şey yanlıştır.
--
-- Ama alım turu bir API isteği değil: kendi sunucumuzun, tek partide onlarca
-- teklifi tam yüküyle (başlık, açıklama, görseller) yazan toplu işlemi.
--
-- ---------------------------------------------------------------------------
-- ÖNCE İŞ AZALTILDI, SONRA SÜRE VERİLDİ -- SIRA ÖNEMLİ
-- ---------------------------------------------------------------------------
-- Süreyi önce uzatmak, gereksiz işi gizlemek olurdu. Yapılan sıra ve ölçülen
-- kazançlar:
--
--   1. Tetikleyici kapsamı  -> ~283 sn tamamen boşa giden hesap kalktı
--                              (satır başı 13,53 -> 5,746 ms)
--   2. Yazma büyütmesi      -> hiç taranmayan 3 indeks düştü
--                              (satır başı 36,72 -> 21,87 ms, 1,68 kat)
--   3. Parti boyutu         -> bayat ölçüm düzeltildi (100 -> 50)
--
-- Üçü de gerçek kazanç sağladı ve HİÇBİRİ yetmedi. Kalan tablo:
--
--   boşta 50 satırlık parti ..... 1.171 ms  (eşiğin %14,6'sı)
--   üretimde aynı parti ......... 8 sn'yi aşıyor
--
-- Aradaki ~7 kat turun kendi yükünden geliyor (yazma + tetiklenen
-- autovacuum, paylaşımlı I/O). Yani kalan fark işin gereksizliği değil,
-- altyapı kapasitesi. Parti boyutunu dördüncü kez düşürmek uçurumun
-- kenarında biraz daha geriye çekilmekti; bu fonksiyon uçurumu kaldırıyor.
--
-- ---------------------------------------------------------------------------
-- KAPSAM: ROL DEĞİL, YALNIZCA BU FONKSİYON
-- ---------------------------------------------------------------------------
-- Alternatif `alter role service_role set statement_timeout` idi. Seçilmedi:
-- o, service_role'ün HER sorgusuna uzun süre verirdi. Buradaki `set` yalnızca
-- BU fonksiyonun çalıştığı süre boyunca geçerli.
--
--   anon           3 sn   dokunulmadı
--   authenticated  8 sn   dokunulmadı
--   service_role   8 sn   dokunulmadı
--   bu fonksiyon  60 sn   (yalnızca kendi gövdesi boyunca)
--
-- Fonksiyon `SECURITY DEFINER` olduğu için yetkisi de daraltıldı: `public`,
-- `anon` ve `authenticated` çağıramaz. Dışarıya açık bir uç nokta olsaydı,
-- uzun süreli sorgularla veritabanını tüketmenin yolu olurdu.
--
-- ---------------------------------------------------------------------------
-- SÜTUN LİSTESİ NEDEN BURADA YAZILI DEĞİL
-- ---------------------------------------------------------------------------
-- Sütunları elle yazmak, TypeScript tarafındaki payload ile ikinci bir
-- doğruluk kaynağı üretirdi. İkisi zamanla AYRIŞIR ve ayrışma sessizdir:
-- SQL'de unutulan bir sütun, yazılıyor sanılan ama hiç yazılmayan bir alan
-- demektir (bu depoda `category_id` ile bir kez yaşandı).
--
-- Bunun yerine liste GÖNDERİLEN JSON'DAN türetiliyor ve her anahtar
-- `products`'ın gerçek sütunlarına karşı DOĞRULANIYOR. Tanınmayan bir
-- anahtar sessizce düşmüyor, hata veriyor. Böylece TypeScript payload'ına
-- bir alan eklendiğinde SQL'i güncellemek gerekmiyor -- ve yanlış bir alan
-- eklendiğinde de fark ediliyor.
--
-- Dinamik SQL enjeksiyona açık değil: sütun adları önce `products`'ın
-- katalogdaki sütunlarıyla eşleştiriliyor, sonra `quote_ident` ile
-- alıntılanıyor. Katalogda olmayan bir ad zaten hata veriyor.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- ÖNCE: ÇAKIŞMA İNDEKSİ ÜRETİM İLE DEPO ARASINDA AYRIŞMIŞTI
-- ---------------------------------------------------------------------------
-- Bu göç yazılırken ölçüldü ve fark yalnızca bir AD farkı değildi:
--
--   depo replay'i : (merchant_id, external_id) WHERE merchant_id IS NOT NULL
--                   -> KISMİ indeks, adı products_merchant_external_id_key
--   üretim        : (merchant_id, external_id)
--                   -> TAM indeks, adı products_merchant_external_unique
--
-- `on conflict (merchant_id, external_id)` yalnızca TAM indeksle eşleşir;
-- kısmi olanı hedeflemek için `where` yan tümcesini de yazmak gerekir.
-- Yani uygulamanın YAZMA YOLU üretimde çalışıyordu ama DEPONUN KENDİ
-- ŞEMASINA karşı çalışmazdı. Fark edilmemişti çünkü upsert yolu temiz bir
-- replay'de hiç koşturulmamıştı -- bu göçün testi onu ilk kez koşturdu.
--
-- İkisi burada aynı şekle getiriliyor. Üretimde her iki ifade de NO-OP:
-- tam indeks zaten var (`if not exists`), kısmi olan zaten yok (`if exists`).
-- Replay'de ise tam indeks açılıyor ve kısmi olan düşüyor.
--
-- KISMİ OLANI DEĞİL TAM OLANI SEÇTİK: `merchant_id` null olan satırlarda
-- (satıcı ürünleri) benzersizlik davranışı ikisinde de aynıdır -- standart
-- gereği NULL'lar birbirinden farklı sayılır, yani kısmi koşul orada bir
-- şey kazandırmıyor. Buna karşılık TAM indeks, uygulamanın kullandığı
-- `on conflict` biçimini destekleyen tek seçenek.
create unique index if not exists products_merchant_external_unique
  on public.products (merchant_id, external_id);

drop index if exists public.products_merchant_external_id_key;

create or replace function public.ingest_upsert_offers(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
declare
  v_anahtarlar text[];
  v_bilinmeyen text[];
  v_sutunlar   text;
  v_atamalar   text;
  v_sql        text;
  v_yazilan    bigint;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'OHAAAA_GECERSIZ_YUK: p_rows bir JSON dizisi olmali'
      using errcode = 'invalid_parameter_value';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('yazilan', 0);
  end if;

  -- Anahtarlar İLK satırdan. Partinin tamamı aynı şekilde kuruluyor
  -- (tek bir `map` çağrısından çıkıyor), dolayısıyla ilk satır partiyi
  -- temsil eder.
  select array_agg(k order by k) into v_anahtarlar
    from jsonb_object_keys(p_rows -> 0) k;

  -- DOĞRULAMA: tanınmayan anahtar sessizce düşmez.
  select array_agg(a) into v_bilinmeyen
    from unnest(v_anahtarlar) a
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'products'
        and c.column_name = a
   );

  if v_bilinmeyen is not null then
    raise exception
      'OHAAAA_BILINMEYEN_SUTUN: products tablosunda yok: %',
      array_to_string(v_bilinmeyen, ', ')
      using errcode = 'undefined_column';
  end if;

  -- Çakışma anahtarının kendisi SET listesine girmez: aynı değeri yeniden
  -- atamak boşuna yazmadır.
  select string_agg(quote_ident(a), ', ' order by a) into v_sutunlar
    from unnest(v_anahtarlar) a;

  select string_agg(
           format('%1$s = excluded.%1$s', quote_ident(a)), ', ' order by a)
    into v_atamalar
    from unnest(v_anahtarlar) a
   where a not in ('merchant_id', 'external_id');

  v_sql := format($sql$
    insert into public.products (%1$s)
    select %1$s
      from jsonb_populate_recordset(null::public.products, $1)
    on conflict (merchant_id, external_id) do update set %2$s
  $sql$, v_sutunlar, v_atamalar);

  execute v_sql using p_rows;
  get diagnostics v_yazilan = row_count;

  return jsonb_build_object('yazilan', v_yazilan);
end;
$function$;

-- YETKİ DARALTMA: dışarıya açık bir uzun-sorgu ucu bırakmıyoruz.
revoke all on function public.ingest_upsert_offers(jsonb) from public;
revoke all on function public.ingest_upsert_offers(jsonb) from anon;
revoke all on function public.ingest_upsert_offers(jsonb) from authenticated;
grant execute on function public.ingest_upsert_offers(jsonb) to service_role;

do $$
declare
  v_timeout text;
  v_anon    boolean;
begin
  select cfg into v_timeout
    from (select unnest(proconfig) as cfg from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'ingest_upsert_offers') t
   where cfg like 'statement_timeout=%';

  if v_timeout is null then
    raise exception 'ingest_upsert_offers kendi statement_timeout ayarini tasimiyor';
  end if;

  select has_function_privilege('anon', 'public.ingest_upsert_offers(jsonb)', 'execute')
    into v_anon;

  if v_anon then
    raise exception
      'ingest_upsert_offers anon tarafindan cagrilabiliyor -- disariya acik '
      'bir uzun-sorgu ucu birakilamaz';
  end if;

  raise notice 'toplu teklif yazma RPC kuruldu: % (anon cagiramaz)', v_timeout;
end $$;
