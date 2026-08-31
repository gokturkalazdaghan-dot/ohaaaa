-- ============================================================================
-- YETKİ TABANI — "önce her şeyi geri al, sonra gerekeni ver"
-- ----------------------------------------------------------------------------
-- SORUN
-- Supabase'in stok kurulumu şu satırı içerir:
--
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- Yani `public` şemasında AÇILAN HER TABLO, daha ilk andan itibaren anon ve
-- authenticated rollerine SELECT, INSERT, UPDATE, DELETE **ve TRUNCATE**
-- yetkisiyle gelir. Bu depodaki 18 tablonun 18'i de bu şekilde açıldı.
--
-- RLS bunun büyük kısmını kurtarır: politikalar SELECT/INSERT/UPDATE/DELETE
-- için satır satır karar verir ve ölçüldüğünde hiçbir tabloda satır sızıntısı
-- çıkmadı.
--
-- AMA TRUNCATE RLS'E TABİ DEĞİLDİR.
--
-- Satır düzeyi güvenlik satırlar üzerinde çalışır; TRUNCATE tablo düzeyinde
-- bir işlemdir ve hiçbir politikaya uğramaz. Ölçüldü: yetkiler yerindeyken
-- `anon` rolü boş olmayan DOKUZ tablonun hepsini boşaltabiliyor —
-- products, product_groups, categories, vendors, users, merchants,
-- flash_deals, price_points, sources. Tek deyim:
--
--   truncate table public.products cascade;   -- 16 satır -> 0
--
-- ULAŞILABİLİRLİK — abartmamak için:
-- PostgREST TRUNCATE'i bir HTTP eylemi olarak DIŞARI AÇMAZ. Yani bugün
-- internetten doğrudan tetiklenebilir bir açık değil; SESSİZ BEKLEYEN bir
-- açık. Yetkiyi yerinde bırakmanın gerekçesi yok: bir SECURITY INVOKER
-- fonksiyon, ileride açılacak bir uç nokta ya da PostgREST'in davranış
-- değişikliği bunu canlı hale getirir. Deponun kendi testi zaten
-- "RLS'ten önce gelen ikinci bir savunma katmanı" diyordu; o katman
-- gerçekte YOKTU.
--
-- ÇÖZÜM
-- Önce kök neden (gelecek tablolar), sonra bugünkü durum. Sıra önemli:
-- varsayılan yetkiler düzeltilmezse, bundan sonra açılan her tablo aynı
-- delikle doğar ve bu göç tek seferlik bir temizlikten ibaret kalır.
--
-- service_role'a DOKUNULMAZ: sunucu tarafı kod onunla yazar ve zaten
-- RLS'i atlar (bypassrls).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Kök neden: bundan sonra açılan tablolar geniş yetkiyle doğmasın.
-- ---------------------------------------------------------------------------
-- `alter default privileges` YALNIZCA onu veren rolün açtığı nesneleri
-- etkiler. Göçleri hangi rolün çalıştırdığı ortama göre değişebildiği için
-- (Supabase'de `postgres`, kurulumda `supabase_admin` olabilir) var olan
-- adayların hepsi için geri alınır.
--
-- `supabase_admin` PLATFORMA aittir ve onun varsayilanlari degistirilemez:
-- deneme "42501 permission denied to change default privileges" ile doner.
-- Bu bir eksiklik degil, sinir: o rolun actigi nesneler Supabase'in kendi
-- altyapisidir, bu deponun gocleri degil. Goc dosyalari `postgres` rolu ile
-- calisir; uygulamanin actigi HER tablo onun varsayilanindan gelir, yani
-- asil delik orada ve orasi kapatilabiliyor.
--
-- Yine de liste denenir: ortamlar arasi rol adlari degisebilir ve
-- yetkimizin YETTIGI her rolde varsayilan kapatilmali. Yetmeyeni atlamak,
-- gocun tamamini dusurmekten iyidir.
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
           revoke all on tables from anon, authenticated', r);
      execute format(
        'alter default privileges for role %I in schema public
           revoke all on sequences from anon, authenticated', r);
    exception
      when insufficient_privilege then
        raise notice
          'Varsayilan yetkiler % rolu icin degistirilemedi (yetki yok) - atlandi.', r;
    end;
  end loop;
end
$$;

-- Göçü çalıştıran rol yukarıdaki listede olmasa bile kendi varsayılanı
-- kapatılır.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Bugünkü durum: her şey geri alınır.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Gereken yetki, adı adına geri verilir.
-- ---------------------------------------------------------------------------
-- Bu liste 20260829090200_rls_policies.sql, 20260830100000_affiliate_model.sql
-- ve 20260830100100_tracking.sql içindeki GRANT'lerin BİREBİR aynısıdır;
-- amaç yetki daraltmak değil, TRUNCATE ve fazlalıkları düşürmek.
-- Hiçbir yere TRUNCATE verilmez.

grant usage on schema public to anon, authenticated;

-- Vitrin: herkes okur.
grant select on
  public.categories, public.product_groups, public.products,
  public.vendors, public.flash_deals, public.merchants, public.price_points
  to anon, authenticated;

-- Taşeron kendi kaydını yönetir; hangi SATIRA dokunabildiğine RLS karar verir.
grant select, insert, update, delete on
  public.api_keys, public.vendors, public.products
  to authenticated;

grant select on public.api_keys_safe to authenticated;
grant select, update on public.vendor_orders to authenticated;
grant select on public.orders, public.order_items, public.api_request_logs to authenticated;
grant select, update on public.users to authenticated;
