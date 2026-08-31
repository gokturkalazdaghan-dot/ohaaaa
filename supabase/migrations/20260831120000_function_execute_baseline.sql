-- ============================================================================
-- FONKSİYON YETKİ TABANI — PUBLIC grant'i kapatılıyor
-- ----------------------------------------------------------------------------
-- BULUNAN AÇIK
-- Postgres'te bir fonksiyon oluşturulduğunda EXECUTE yetkisi VARSAYILAN OLARAK
-- `PUBLIC` rolüne verilir. `anon` ve `authenticated` de PUBLIC'in üyesidir.
--
-- Depoda `revoke_internal_function_execute` adında, iç fonksiyonları
-- `anon, authenticated` rollerinden geri alan bir göç zaten vardı. O göç
-- HİÇBİR ŞEY YAPMIYORDU: rolden geri almak, PUBLIC üzerinden gelen yetkiyi
-- kaldırmaz. Katalogda görünen hâli şuydu:
--
--   purge_old_api_logs → {=X/postgres, postgres=X/postgres, service_role=X/postgres}
--                         ^^^^^^^^^^^ bastaki bos taraf PUBLIC grant'idir
--
-- SONUÇ — İKİ GERÇEK AÇIK
--   • `purge_old_api_logs` içinde hiçbir yetki kontrolü yok ve koşulsuz
--     `delete` çalıştırıyor. SECURITY DEFINER olduğu için RLS'e de uğramıyor.
--     Yani imzasız bir ziyaretçi API istek günlüklerini silebiliyordu.
--   • `record_conversion` ve `record_click` de korumasız yazıyor. Bunlar PARA
--     YOLU: sahte dönüşüm kaydı, ciro atıfını bozar.
--
-- `affiliate_dashboard` ise içinde `is_admin()` kontrolü taşıyor; anon
-- çağırsa reddediliyordu. Yine de yüzeyden kaldırılıyor: bir fonksiyonun
-- kendi içindeki kontrole güvenmek, o kontrolü yazmayı unutan bir sonraki
-- fonksiyonda çöker.
--
-- NEDEN TOPTAN REVOKE DEĞİL
-- `search_products` SECURITY INVOKER'dır: anon çağırdığında içerideki
-- `normalize_search`, `similarity`, `word_similarity` çağrıları da ANON
-- olarak çalışır. Şemadaki tüm fonksiyonlardan PUBLIC'i çekmek aramayı
-- kırardı. Bu yüzden liste adı adına yazıldı; her satır bilinçli.
-- ============================================================================

-- --- 1) İç fonksiyonlar: PUBLIC yüzeyinden kaldırılır -----------------------
-- ADA GÖRE eşleştirilir, imzaya göre değil.
--
-- İlk yazışta imzaları elle yazmıştım ve ÜÇÜ YANLIŞTI — aralarında
-- `record_conversion` (para yolu) da vardı. Yanlış imza "fonksiyon yok"
-- sayılıp sessizce atlanır ve delik açık kalırdı. Ada göre eşleştirmek bu
-- sınıf hatayı imkânsız kılar ve aşırı yüklenmiş (overloaded) fonksiyonların
-- hepsini birden kapsar.
--
-- Beklenen adların GERÇEKTEN bulunduğu ayrıca doğrulanır: sessizce hiçbir şey
-- yapmayan bir güvenlik göçü, hiç olmayan göçten kötüdür — kapalı sanırsınız.
do $$
declare
  beklenen text[] := array[
    'purge_old_api_logs', 'record_click', 'record_conversion',
    'log_api_request', 'touch_api_key', 'refresh_product_group_stats',
    'consume_api_rate_limit'
  ];
  ad     text;
  r      record;
  bulunan int;
begin
  foreach ad in array beklenen loop
    select count(*) into bulunan
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = ad;

    if bulunan = 0 then
      raise exception
        'Beklenen fonksiyon bulunamadi: public.%. Goc sessizce gecmemeli.', ad;
    end if;

    for r in
      select p.oid::regprocedure as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = ad
    loop
      execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end loop;
  end loop;
end
$$;

-- --- 2) Tetikleyici fonksiyonları -------------------------------------------
-- Tetikleyici fonksiyonuna EXECUTE yetkisi YALNIZCA `create trigger` anında
-- aranır, tetikleme anında değil. PUBLIC'ten çekmek hiçbir tetikleyiciyi
-- bozmaz, yalnızca doğrudan çağrılmalarını engeller.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'tg\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end
$$;

-- --- 3) Yönetim paneli -------------------------------------------------------
-- İçindeki is_admin() kontrolü kalıyor; bu yalnızca ikinci katman. Bir
-- fonksiyonun kendi içindeki kontrole güvenmek, o kontrolü yazmayı unutan
-- bir sonraki fonksiyonda çöker.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'affiliate_dashboard'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end
$$;

-- --- 4) Gelecekte açılacak fonksiyonlar --------------------------------------
-- Kök neden: varsayılan yetkiler kapatılmazsa bir sonraki fonksiyon aynı
-- delikle doğar ve bu göç tek seferlik bir temizlikten ibaret kalır.
do $$
declare
  r text;
begin
  foreach r in array array['postgres', 'supabase_admin'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      continue;
    end if;
    begin
      execute format(
        'alter default privileges for role %I in schema public
           revoke all on functions from anon, authenticated', r);
    exception
      when insufficient_privilege then
        raise notice 'Varsayilan fonksiyon yetkileri % icin degistirilemedi - atlandi.', r;
    end;
  end loop;
end
$$;

alter default privileges in schema public revoke all on functions from anon, authenticated;

-- --- 5) RLS'in ihtiyaç duyduğu yardımcılar KALIR ------------------------------
-- Politika ifadeleri çağıranın yetkisiyle değerlendirilir: bu dördü olmadan
-- her RLS politikası hata verir ve site tamamen durur.
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.owns_vendor(uuid) to anon, authenticated;
grant execute on function public.order_belongs_to_current_user(uuid) to anon, authenticated;
grant execute on function public.order_has_vendor_of_current_user(uuid) to anon, authenticated;

-- --- 6) Vitrinin çağırdığı fonksiyonlar --------------------------------------
grant execute on function public.search_products(
  text, uuid, bigint, bigint, text, integer, integer, text[], boolean
) to anon, authenticated;
grant execute on function public.search_facets(text, uuid, text[], boolean) to anon, authenticated;
grant execute on function public.search_suggestions(text, integer) to anon, authenticated;
grant execute on function public.price_history(uuid, integer) to anon, authenticated;
grant execute on function public.deal_score(uuid, integer) to anon, authenticated;
grant execute on function public.create_order(jsonb, text, jsonb, text) to authenticated;
grant execute on function public.confirm_payment(uuid, text, text) to authenticated;
grant execute on function public.vendor_dashboard_stats(uuid, integer) to authenticated;

-- --- 7) Denetçi uyarısı: product_signature search_path'i sabitlenmemişti -----
-- Sabitlenmezse çağıran rol, önce gelen bir şemaya kendi `normalize_search`
-- fonksiyonunu koyup imzayı değiştirebilir. İmza kanonik eşleştirmenin
-- temeli; değişmesi katalogda sessiz bozulma demektir.
alter function public.product_signature(text, text) set search_path to 'public';

-- --- 8) confirm_payment istemciden tamamen kaldirilir ------------------------
-- Bir siparis kimligi alip onu "odendi" olarak isaretliyor ve icinde
-- SAHIPLIK KONTROLU YOK: kimligi ele geciren herkes odeme yapmadan odenmis
-- gosterebilirdi. Bugun odeme bir simulasyon oldugu icin para kaybi yok, ama
-- siparis durumu tedarik akisini tetikler ve gercek tahsilat eklendiginde bu
-- dogrudan dolandiricilik yoluna doner.
--
-- Cagri /api/checkout icinde SUNUCU anahtarina tasindi (bkz. o dosyadaki
-- gerekce). Siparis OLUSTURMA ziyaretcinin oturumunda kalir: misafir
-- alisverisi destekleniyor ve siparisin kime baglanacagi oturumdan geliyor.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_payment'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$$;
