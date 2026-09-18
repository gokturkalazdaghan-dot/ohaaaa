-- Bakım ve tetikleyici fonksiyonlarını herkese açık API'den kaldır.
--
-- SORUN: Supabase denetimi 24 SECURITY DEFINER fonksiyonun anon rolüyle
-- /rest/v1/rpc/... üzerinden çağrılabildiğini bildirdi. Bir kısmı bilerek
-- açık (arama, fiyat geçmişi, tıklama kaydı) — ama bakım fonksiyonları değil:
--
--   purge_old_api_logs          — LOG SİLER. Giriş yapmamış biri çağırabiliyordu.
--   refresh_product_group_stats — pahalı toplu güncelleme, kötüye kullanıma açık.
--
-- İkisi de uygulamanın hiçbir yerinden çağrılmıyor (kaynak tarandı).
-- service_role bu revoke'tan etkilenmez; arka uç çalışmaya devam eder.
--
-- Tetikleyici fonksiyonlar da kapatıldı. Tetikleyicilerin çalışması bu
-- yetkiye bağlı DEĞİLDİR: PostgreSQL tetikleyici fonksiyonunu çalıştırırken
-- çağıran rolün EXECUTE hakkını aramaz.

revoke execute on function public.purge_old_api_logs(integer)       from anon, authenticated;
revoke execute on function public.refresh_product_group_stats(uuid) from anon, authenticated;

revoke execute on function public.tg_handle_new_auth_user()         from anon, authenticated;
revoke execute on function public.tg_order_items_decrement_stock()  from anon, authenticated;
revoke execute on function public.tg_order_items_reject_affiliate() from anon, authenticated;
revoke execute on function public.tg_products_record_price()        from anon, authenticated;
revoke execute on function public.tg_products_sync_group_stats()    from anon, authenticated;
revoke execute on function public.tg_products_sync_vendor_count()   from anon, authenticated;
revoke execute on function public.tg_vendors_promote_owner()        from anon, authenticated;