-- ============================================================================
-- OHAAAA SKORU — yalnızca ölçebildiğimiz şeylerden
-- ----------------------------------------------------------------------------
-- Bir tekliften tek bir sayı üretmek kolaydır; o sayının neyi topladığını
-- gizlemek daha da kolay. Bu fonksiyon TAM TERSİNİ yapar: her bileşeni
-- ayrı ayrı döndürür, ölçemediğini "yok" diye işaretler ve SEBEBİNİ yazar.
--
-- ÜÇ KURAL
--   1) Ölçülemeyen bileşen puana KATILMAZ. Sıfır puan verilmez -- "ölçmedik"
--      ile "kötü" aynı şey değildir.
--   2) Skor, yalnızca ölçülebilen ağırlık üzerinden normalize edilir ve o
--      ağırlık (`measured_weight`) çıktıda durur. Tek bileşenle 100 almak
--      mümkün olmasın diye eşik var: ağırlığın yarısı ölçülemiyorsa skor
--      NULL döner.
--   3) Mağazanın BEYANI ile bizim ÖLÇÜMÜMÜZ ayrı etiketlenir (`source`).
--      Teslimat süresi beyandır; fiyat konumu ölçümdür. Arayüz ikisini aynı
--      güvenle sunmamalı.
--
-- `deal_score()` ile ilişkisi: o fonksiyon TEK bir ürünün fiyat geçmişini
-- özetler ve duruyor. Burada yeniden yazılmadı; fiyat konumu bileşeni aynı
-- `price_points` verisinden, aynı pencere mantığıyla hesaplanıyor.
-- ============================================================================

create or replace function public.ohaaaa_score(
  p_product_id uuid,
  p_days       int default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_pencere    int := greatest(1, least(p_days, 730));
  v_since      timestamptz := now() - make_interval(days => v_pencere);
  v_urun       record;
  v_min        bigint;
  v_max        bigint;
  v_ilk        timestamptz;
  v_olcum      int;
  v_gozlem_gun int := 0;
  v_toplam     bigint;
  v_en_ucuz    bigint;
  v_teklif     int;
  v_puan       numeric := 0;   -- kazanılan puan
  v_agirlik    numeric := 0;   -- ölçülebilen toplam ağırlık
  v_bilesenler jsonb := '[]'::jsonb;
  v_pay        numeric;
  v_skor       int;
  v_guven      text;
begin
  select p.id, p.price_cents, p.shipping_fee_cents, p.estimated_delivery_days,
         p.group_id, p.fulfillment, p.vendor_id, p.status,
         v.rating as vendor_rating, v.rating_count as vendor_rating_count
    into v_urun
    from public.products p
    left join public.vendors v on v.id = p.vendor_id
   where p.id = p_product_id;

  if v_urun.id is null then
    return jsonb_build_object('available', false, 'reason', 'urun_yok');
  end if;

  v_toplam := v_urun.price_cents + v_urun.shipping_fee_cents;

  -- --- 1) Fiyat konumu (ağırlık 40, ÖLÇÜM) ----------------------------------
  -- Bugünkü fiyat, gözlem penceresindeki en yüksek ve en düşük fiyat
  -- arasında nerede duruyor? Dipteyse tam puan.
  select min(price_cents), max(price_cents), min(observed_at), count(*)
    into v_min, v_max, v_ilk, v_olcum
    from public.price_points
   where product_id = p_product_id
     and observed_at >= v_since;

  if v_ilk is not null then
    v_gozlem_gun := greatest(0, extract(day from now() - v_ilk)::int);
  end if;

  if v_olcum >= 2 and v_max > v_min then
    v_pay := 40 * greatest(0, least(1,
      (v_max - v_urun.price_cents)::numeric / (v_max - v_min)));
    v_puan := v_puan + v_pay;
    v_agirlik := v_agirlik + 40;
    v_bilesenler := v_bilesenler || jsonb_build_object(
      'key', 'fiyat_konumu', 'available', true, 'source', 'olcum',
      'weight', 40, 'points', round(v_pay, 1),
      'detail', jsonb_build_object(
        'current_price_cents', v_urun.price_cents,
        'min_price_cents', v_min, 'max_price_cents', v_max,
        'observations', v_olcum, 'observed_days', v_gozlem_gun,
        'window_days', v_pencere));
  else
    v_bilesenler := v_bilesenler || jsonb_build_object(
      'key', 'fiyat_konumu', 'available', false, 'source', 'olcum',
      'weight', 40,
      -- Sebep AYRI YAZILIR: "hiç ölçmedik" ile "ölçtük ama fiyat hiç
      -- değişmedi" kullanıcı için farklı bilgilerdir.
      'reason', case when coalesce(v_olcum, 0) < 2 then 'yeterli_fiyat_olcumu_yok'
                     else 'fiyat_hic_degismedi' end,
      'detail', jsonb_build_object('observations', coalesce(v_olcum, 0)));
  end if;

  -- --- 2) Kargo dahil toplam maliyet (ağırlık 25, ÖLÇÜM) --------------------
  -- Karşılaştırılacak başka teklif yoksa bu bileşen ölçülemez: tek teklifin
  -- "en ucuz" olması bir bilgi değildir.
  if v_urun.group_id is not null then
    select count(*), min(p.price_cents + p.shipping_fee_cents)
      into v_teklif, v_en_ucuz
      from public.products p
     where p.group_id = v_urun.group_id
       and p.status = 'active'
       and p.stock > 0;
  else
    v_teklif := 0;
  end if;

  if coalesce(v_teklif, 0) >= 2 and v_en_ucuz > 0 and v_toplam > 0 then
    v_pay := 25 * least(1, v_en_ucuz::numeric / v_toplam);
    v_puan := v_puan + v_pay;
    v_agirlik := v_agirlik + 25;
    v_bilesenler := v_bilesenler || jsonb_build_object(
      'key', 'toplam_maliyet', 'available', true, 'source', 'olcum',
      'weight', 25, 'points', round(v_pay, 1),
      'detail', jsonb_build_object(
        'total_cost_cents', v_toplam,
        'cheapest_total_cents', v_en_ucuz,
        'offer_count', v_teklif,
        'is_cheapest', v_toplam <= v_en_ucuz));
  else
    v_bilesenler := v_bilesenler || jsonb_build_object(
      'key', 'toplam_maliyet', 'available', false, 'source', 'olcum',
      'weight', 25, 'reason', 'karsilastirilacak_teklif_yok',
      'detail', jsonb_build_object('offer_count', coalesce(v_teklif, 0)));
  end if;

  -- --- 3) Satıcı değerlendirmesi (ağırlık 20, ÖLÇÜM) ------------------------
  -- Beş değerlendirmenin altında ortalama puan gürültüdür; tek bir yorum
  -- satıcıyı 5 yıldızlı gösterebilir. Ortak mağazalarda (affiliate) bizim
  -- topladığımız bir puan hiç yok.
  if v_urun.fulfillment = 'marketplace' and coalesce(v_urun.vendor_rating_count, 0) >= 5 then
    v_pay := 20 * least(1, v_urun.vendor_rating / 5.0);
    v_puan := v_puan + v_pay;
    v_agirlik := v_agirlik + 20;
    v_bilesenler := v_bilesenler || jsonb_build_object(
      'key', 'satici_degerlendirmesi', 'available', true, 'source', 'olcum',
      'weight', 20, 'points', round(v_pay, 1),
      'detail', jsonb_build_object(
        'rating', v_urun.vendor_rating, 'rating_count', v_urun.vendor_rating_count));
  else
    v_bilesenler := v_bilesenler || jsonb_build_object(
      'key', 'satici_degerlendirmesi', 'available', false, 'source', 'olcum',
      'weight', 20,
      'reason', case when v_urun.fulfillment <> 'marketplace'
                     then 'ortak_magazanin_puani_bizde_yok'
                     else 'yeterli_degerlendirme_yok' end,
      'detail', jsonb_build_object('rating_count', coalesce(v_urun.vendor_rating_count, 0)));
  end if;

  -- --- 4) Teslimat süresi (ağırlık 15, BEYAN) -------------------------------
  -- Bunu ÖLÇMÜYORUZ: mağazanın söylediği süre. Kaynağı 'beyan' olarak
  -- işaretleniyor ki arayüz onu ölçülmüş bir değer gibi sunmasın.
  v_pay := 15 * greatest(0, least(1, (10 - v_urun.estimated_delivery_days)::numeric / 9));
  v_puan := v_puan + v_pay;
  v_agirlik := v_agirlik + 15;
  v_bilesenler := v_bilesenler || jsonb_build_object(
    'key', 'teslimat', 'available', true, 'source', 'beyan',
    'weight', 15, 'points', round(v_pay, 1),
    'detail', jsonb_build_object('estimated_delivery_days', v_urun.estimated_delivery_days));

  -- --- Skor -----------------------------------------------------------------
  -- Ağırlığın yarısından azını ölçebildiysek sayı üretmiyoruz. Tek bileşenle
  -- "100 üzerinden 92" yazmak, ölçmediğimizi ölçmüş gibi göstermektir.
  if v_agirlik >= 50 then
    v_skor := round(100 * v_puan / v_agirlik)::int;
    v_guven := case
      when v_agirlik >= 85 and v_gozlem_gun >= 30 then 'yuksek'
      when v_agirlik >= 65 then 'orta'
      else 'dusuk'
    end;
  else
    v_skor := null;
    v_guven := 'yetersiz';
  end if;

  return jsonb_build_object(
    'available',       v_skor is not null,
    'score',           v_skor,
    'max_score',       100,
    'measured_weight', v_agirlik,
    'total_weight',    100,
    'confidence',      v_guven,
    'window_days',     v_pencere,
    'components',      v_bilesenler);
end;
$$;

comment on function public.ohaaaa_score is
  'Bir teklifin skoru. Olculemeyen bilesen puana KATILMAZ; sebebi cikti icinde yazar.';

grant execute on function public.ohaaaa_score(uuid, int)
  to anon, authenticated, service_role;
