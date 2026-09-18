-- ===========================================================================
-- KATEGORİ SAYIM SORGUSU ANON ZAMAN AŞIMINA TAKILIYORDU
-- ===========================================================================
--
-- ÖLÇÜLEN ARIZA
-- `kategori_grup_sayilari()` 3.444 ms sürüyordu. `anon` rolünün deyim zaman
-- aşımı 3 saniye. Yani üst çubuğun kategori ağacı HER TAZELEMEDE düşüyor,
-- Next.js önbellekteki eski kopyayı sunmaya devam ediyor ve vitrin bir veri
-- düzeltmesinden sonra ESKİ SAYILARDA KALIYORDU. Dışarıdan bakınca
-- "önbellek boşalmıyor" gibi görünen şey aslında buydu.
--
-- SEBEP
-- 27.802 ürün grubu yeni kategorilerine taşındı; bu, görünürlük haritasını
-- bayatlattı ve index-only tarama 16.177 HEAP FETCH yapmaya başladı
-- (buffers: 17.577). Vacuum sonrası heap fetch 0, buffers 1.220, süre 41 ms.
--
-- NEDEN VACUUM YETMİYOR
-- Vacuum bir kerelik. Bir sonraki toplu yeniden sınıflandırma aynı durumu
-- geri getirir ve arıza yine sessizce döner: sorgu düşer, kimse görmez,
-- vitrin eski sayıyı gösterir.
--
-- Mevcut indeks (`product_groups_category_offers_idx`) bu sorgu için
-- fazladan `title` taşıyor -- geniş bir metin sütunu, yani her index-only
-- taramada gereksiz sayfa. Bu indeks YALNIZCA sayım sorgusunun okuduğu
-- sütunu taşıyor, dolayısıyla aynı satır sayısı çok daha az sayfaya sığıyor
-- ve görünürlük haritası bayatladığında bile bütçe içinde kalıyor.
--
-- Eskisi DÜŞÜRÜLMÜYOR: kategori sayfasının sıralama sorgusu (`offer_count
-- desc, title`) onu kullanıyor.
-- ===========================================================================

create index if not exists product_groups_kategori_sayim_idx
  on public.product_groups (category_id)
  where offer_count > 0 and category_id is not null;

comment on index public.product_groups_kategori_sayim_idx is
  'kategori_grup_sayilari() icin dar kapsayici indeks. Genis olani title '
  'tasiyor ve gorunurluk haritasi bayatladiginda anon un 3 saniyelik deyim '
  'zaman asimini asiyordu.';

analyze public.product_groups;

do $$
declare
  v_ms numeric;
  v_bas timestamptz;
begin
  v_bas := clock_timestamp();
  perform count(*) from public.kategori_grup_sayilari();
  v_ms := extract(epoch from (clock_timestamp() - v_bas)) * 1000;

  -- anon deyim zaman asimi 3000 ms. 1000 ms uzerinde kalmak, bir sonraki
  -- toplu guncellemeden sonra tekrar asilacagi anlamina gelir.
  if v_ms > 1000 then
    raise exception
      'DOGRULAMA: kategori sayimi hala % ms -- anon un 3 saniyelik butcesine '
      'cok yakin ve bir sonraki toplu guncellemede yine duserdi.', round(v_ms);
  end if;

  raise notice 'Kategori sayimi % ms (once 3444 ms).', round(v_ms);
end $$;