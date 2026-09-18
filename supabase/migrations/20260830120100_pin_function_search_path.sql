-- Fonksiyonlarda search_path sabitlenmemişti.
--
-- NEDEN ÖNEMLİ: search_path'i sabit olmayan bir fonksiyon, çağıran rolün
-- search_path'ini kullanır. Saldırgan kendi şemasında sahte bir `slugify`
-- tanımlayıp search_path'ini öne alırsa, SECURITY DEFINER fonksiyonun sahibi
-- yetkisiyle kendi kodunu çalıştırabilir. Klasik yetki yükseltme yolu.
--
-- ALTER FUNCTION ... SET search_path gövdeyi değiştirmez, davranış aynı kalır.

alter function public.normalize_search(text)                    set search_path = public;
alter function public.slugify(text)                             set search_path = public;
alter function public.tg_set_updated_at()                       set search_path = public;
alter function public.tg_orders_set_order_number()              set search_path = public;
alter function public.tg_conversions_stamp_status()             set search_path = public;
alter function public.assert_orderable(public.products)         set search_path = public;
alter function public.search_products(text, uuid, bigint, bigint, text, integer, integer)
                                                                set search_path = public;