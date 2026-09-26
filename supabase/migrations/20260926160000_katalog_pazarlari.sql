-- =============================================================================
-- katalog_pazarlari(): KATALOGDA gerçekten ürünü olan pazarlar
-- =============================================================================
-- NEDEN GEREKLİ
-- 20260926150000 pazar süzgecini açtı. Süzgeci KOŞULSUZ uygulamak ana sayfayı
-- boşaltır: ölçüldü, `search_products(p_market => 'TR')` SIFIR satır
-- döndürüyor ve TR varsayılan pazar. Yani süzgeç, hangi pazarların gerçekten
-- ürünü olduğunu bilmeden kullanılamaz.
--
-- NEDEN `sunulan_pazarlar()` KULLANILMIYOR
-- O fonksiyon `sources` tablosundan okuyor (`is_enabled`), yani "alım
-- yapılandırdık" diyor, "ürün var" demiyor. İkisi bugün AYNI kümeyi veriyor
-- (AT, IE, IT, PL, UK, US -- ölçüldü) ama ayrışabilirler ve ayrıştıkları
-- durum tam olarak tehlikeli olan:
--
--   • Yeni bir Awin programı açılır, kaynak `is_enabled` olur, alım henüz
--     koşmamıştır. `sunulan_pazarlar()` o pazarı sayar, süzgeç devreye
--     girer ve o pazarın ziyaretçisi BOŞ katalog görür.
--   • Tersi de oldu: Lunzo PL kaynağı OOM'dan sonra kapatıldı, ama 1.006
--     PL grubu veritabanında duruyor. Kaynağa bakan bir ölçü o ürünleri
--     yok sayardı.
--
-- Süzgecin sorduğu soru "bu pazarda gösterilecek ürün var mı"; cevabı
-- yalnızca katalogda yazılı.
--
-- SAYIYI DA DÖNDÜRÜYOR: çağıran taraf "var/yok"tan fazlasını bilmek
-- istediğinde (yönetim ekranı, sağlık kontrolü) ikinci bir sorgu gerekmesin.
-- Maliyeti sıfır -- sayım zaten yapılıyor.
--
-- SECURITY DEFINER DEĞİL: `product_groups` anon rolü için zaten okunabilir
-- (RLS `using (true)`). Tanımlayıcı yetkisiyle çalıştırmak, gerekmeyen bir
-- ayrıcalık olurdu.
-- =============================================================================

create or replace function public.katalog_pazarlari()
returns table (market_code text, group_count bigint)
language sql
stable
set search_path to 'public'
as $function$
  select g.market_code, count(*)::bigint
    from public.product_groups g
   where g.offer_count > 0
     and g.market_code is not null
   group by g.market_code
   order by count(*) desc, g.market_code asc;
$function$;

comment on function public.katalog_pazarlari() is
  'Katalogda aktif teklifi olan pazarlar ve grup sayilari. '
  'sunulan_pazarlar() KAYNAK yapilandirmasina bakar; bu fonksiyon URUNE '
  'bakar. Pazar suzgecinin acilip acilmayacagina bu karar verir.';

grant execute on function public.katalog_pazarlari() to anon, authenticated, service_role;
