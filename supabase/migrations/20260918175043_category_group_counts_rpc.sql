-- ============================================================================
-- KATEGORİ GRUP SAYILARI — TEK SORGU
--
-- ⚠️  ÜRETİMDE UYGULANDI (schema_migrations 20260918175043).
--
-- NEDEN: `kategoriAgaciniOku` her kategori için AYRI bir `count` isteği
-- atıyordu. Taksonomi 9 kategoriden 132'ye çıkınca bu, önbellek her
-- tazelendiğinde 132 gidiş-dönüş demek oldu. Eşzamanlılık tavanı yükü
-- sınırlıyor ama gecikmeyi ortadan kaldırmıyor.
--
-- Tek gruplu sorgu aynı cevabı tek turda veriyor ve sayımlar
-- `product_groups (category_id)` indeksinden karşılanıyor.
--
-- YALNIZCA TEKLİFİ OLAN GRUPLAR sayılıyor: şerit ürünsüz kategoriyi
-- göstermiyor, dolayısıyla sayım da aynı kuralı taşımak zorunda. Farklı
-- olsalardı menü "Telefon (814)" deyip boş sayfa açabilirdi.
-- ============================================================================

create or replace function public.kategori_grup_sayilari()
returns table (category_id uuid, adet bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select g.category_id, count(*)
  from public.product_groups g
  where g.category_id is not null
    and g.offer_count > 0
  group by g.category_id;
$$;

comment on function public.kategori_grup_sayilari() is
  'Kategori basina teklifi olan urun grubu sayisi. Serit icin tek turluk sayim.';

grant execute on function public.kategori_grup_sayilari() to anon;
grant execute on function public.kategori_grup_sayilari() to authenticated;
grant execute on function public.kategori_grup_sayilari() to service_role;
