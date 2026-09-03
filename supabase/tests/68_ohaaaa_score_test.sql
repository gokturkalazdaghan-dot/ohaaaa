-- ============================================================================
-- OHAAAA SKORU — ölçemediğini uydurmuyor mu?
-- ----------------------------------------------------------------------------
-- Skorun tek riski, eksik veriyi sessizce doldurmasıdır: ölçülemeyen bir
-- bileşene sıfır vermek ("kötü") ya da tek bileşenden 100 üzerinden bir sayı
-- üretmek. Bu dosya ikisini de sınar.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'skor@ornek.com', '{"full_name":"Skor"}'::jsonb)
on conflict (id) do nothing;

do $$
declare
  v_satici uuid;
  v_grup   uuid := '4f000000-0000-4000-8000-0000000000e1';
  v_urun   uuid := '5f000000-0000-4000-8000-0000000000e1';
  v_urun2  uuid := '5f000000-0000-4000-8000-0000000000e2';
  v_elektronik uuid := 'c0000000-0000-4000-8000-000000000001';
  s        jsonb;
  b        jsonb;
begin
  -- Yeni, hiç değerlendirilmemiş satıcı: puanı olmayan durumu temsil eder.
  insert into public.vendors (id, owner_id, slug, display_name, status)
  values (gen_random_uuid(), 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          'skor-test-magaza', 'Skor Test Mağaza', 'approved')
  returning id into v_satici;

  ---------------------------------------------------------------------------
  -- 1) OLMAYAN ÜRÜN: sayı değil, "yok" döner
  ---------------------------------------------------------------------------
  s := public.ohaaaa_score('00000000-0000-4000-8000-000000000000');
  if (s ->> 'available')::boolean is not false or s ->> 'reason' <> 'urun_yok' then
    raise exception 'BAŞARISIZ: olmayan urun icin skor uretildi (%)', s;
  end if;
  raise notice '✓ olmayan urune skor uretilmiyor';

  ---------------------------------------------------------------------------
  -- 2) TEK ÖLÇÜLEBİLİR BİLEŞENLE SKOR ÜRETİLMEZ
  --    Gruba bağlı olmayan (karşılaştırılacak teklifi yok), fiyat geçmişi
  --    tek ölçümden ibaret, satıcısı hiç değerlendirilmemiş bir ürün.
  --    Geriye yalnızca "teslimat" (ağırlık 15) kalır.
  ---------------------------------------------------------------------------
  insert into public.products
    (id, vendor_id, group_id, external_id, title, category_id,
     price_cents, stock, estimated_delivery_days, status)
  values (v_urun, v_satici, null, 'SKOR-1', 'Skor Test Ürünü', v_elektronik,
          100000, 10, 1, 'active');

  s := public.ohaaaa_score(v_urun);

  if (s ->> 'available')::boolean is not false or s ->> 'score' is not null then
    raise exception 'BAŞARISIZ: olculebilen agirlik yetersizken skor uretildi (%)', s;
  end if;
  if (s ->> 'measured_weight')::numeric <> 15 then
    raise exception 'BAŞARISIZ: olculebilen agirlik yanlis (%)', s ->> 'measured_weight';
  end if;
  if s ->> 'confidence' <> 'yetersiz' then
    raise exception 'BAŞARISIZ: yetersiz veri "yetersiz" diye isaretlenmedi';
  end if;
  raise notice '✓ yetersiz veriyle skor uretilmiyor (NULL, sifir degil)';

  ---------------------------------------------------------------------------
  -- 3) ÖLÇÜLEMEYEN BİLEŞENE SIFIR PUAN VERİLMEZ
  --    Eksik bileşende `points` alanı HİÇ OLMAMALI; sebep yazmalı.
  --    Sıfır yazmak "kotu" demek olurdu, oysa bilmiyoruz.
  ---------------------------------------------------------------------------
  select value into b
    from jsonb_array_elements(s -> 'components') value
   where value ->> 'key' = 'fiyat_konumu';

  if (b ->> 'available')::boolean is not false then
    raise exception 'BAŞARISIZ: tek olcumle fiyat konumu olculdu sayildi';
  end if;
  if b ? 'points' then
    raise exception 'BAŞARISIZ: olculemeyen bilesene puan yazildi (%)', b;
  end if;
  if b ->> 'reason' <> 'yeterli_fiyat_olcumu_yok' then
    raise exception 'BAŞARISIZ: eksik bilesenin sebebi yazilmadi (%)', b ->> 'reason';
  end if;
  raise notice '✓ olculemeyen bilesen puansiz ve sebepli';

  ---------------------------------------------------------------------------
  -- 4) TEK TEKLİF KARŞILAŞTIRMA DEĞİLDİR
  ---------------------------------------------------------------------------
  select value into b
    from jsonb_array_elements(s -> 'components') value
   where value ->> 'key' = 'toplam_maliyet';
  if (b ->> 'available')::boolean is not false
     or b ->> 'reason' <> 'karsilastirilacak_teklif_yok' then
    raise exception 'BAŞARISIZ: karsilastirilacak teklif yokken maliyet olculdu (%)', b;
  end if;
  raise notice '✓ tek teklifte maliyet bileseni olculmuyor';

  ---------------------------------------------------------------------------
  -- 5) BEŞ DEĞERLENDİRMENİN ALTINDA SATICI PUANI KULLANILMAZ
  ---------------------------------------------------------------------------
  update public.vendors set rating = 5.00, rating_count = 4 where id = v_satici;
  s := public.ohaaaa_score(v_urun);
  select value into b
    from jsonb_array_elements(s -> 'components') value
   where value ->> 'key' = 'satici_degerlendirmesi';
  if (b ->> 'available')::boolean is not false
     or b ->> 'reason' <> 'yeterli_degerlendirme_yok' then
    raise exception 'BAŞARISIZ: 4 degerlendirmeyle satici puani kullanildi (%)', b;
  end if;
  raise notice '✓ az degerlendirmeli satici puani kullanilmiyor';

  ---------------------------------------------------------------------------
  -- 6) TESLİMAT SÜRESİ BEYAN OLARAK İŞARETLENİR
  --    Bunu biz ölçmüyoruz; ölçüm gibi sunulursa kullanıcı yanlış güvenir.
  ---------------------------------------------------------------------------
  select value into b
    from jsonb_array_elements(s -> 'components') value
   where value ->> 'key' = 'teslimat';
  if b ->> 'source' <> 'beyan' then
    raise exception 'BAŞARISIZ: magazanin beyani olcum diye etiketlendi (%)', b ->> 'source';
  end if;
  raise notice '✓ magaza beyani olcumden ayri etiketleniyor';

  ---------------------------------------------------------------------------
  -- 7) FİYAT KONUMU GERÇEK GÖZLEMDEN ÇIKAR
  --    Ürünü bir gruba bağlayıp fiyatı 1.000 -> 400 -> 1.000 gezdiriyoruz.
  --    Tepede 0, dipte tam puan beklenir.
  ---------------------------------------------------------------------------
  insert into public.product_groups (id, slug, title, category_id)
  values (v_grup, 'skor-test-grubu', 'Skor Test Grubu', v_elektronik);

  update public.vendors set rating = 4.00, rating_count = 50 where id = v_satici;
  update public.products set group_id = v_grup where id = v_urun;

  -- İkinci teklif: karşılaştırma bileşeni ölçülebilsin.
  insert into public.products
    (id, vendor_id, group_id, external_id, title, category_id,
     price_cents, stock, estimated_delivery_days, status)
  values (v_urun2, v_satici, v_grup, 'SKOR-2', 'Skor Test Ürünü', v_elektronik,
          90000, 10, 2, 'active');

  update public.products set price_cents = 40000 where id = v_urun;   -- dip
  s := public.ohaaaa_score(v_urun);
  select value into b
    from jsonb_array_elements(s -> 'components') value
   where value ->> 'key' = 'fiyat_konumu';
  if (b ->> 'available')::boolean is not true then
    raise exception 'BAŞARISIZ: iki olcumle fiyat konumu olculemedi (%)', b;
  end if;
  if (b ->> 'points')::numeric <> 40 then
    raise exception 'BAŞARISIZ: dip fiyatta tam puan verilmedi (%)', b ->> 'points';
  end if;
  raise notice '✓ dip fiyatta fiyat konumu tam puan';

  update public.products set price_cents = 100000 where id = v_urun;  -- tepe
  s := public.ohaaaa_score(v_urun);
  select value into b
    from jsonb_array_elements(s -> 'components') value
   where value ->> 'key' = 'fiyat_konumu';
  if (b ->> 'points')::numeric <> 0 then
    raise exception 'BAŞARISIZ: tepe fiyatta puan verildi (%)', b ->> 'points';
  end if;
  raise notice '✓ tepe fiyatta fiyat konumu sifir puan';

  ---------------------------------------------------------------------------
  -- 8) SKOR YALNIZCA ÖLÇÜLEBİLEN AĞIRLIK ÜZERİNDEN NORMALIZE EDİLİR
  --    Dört bileşen de ölçülebiliyorken ağırlık 100 olmalı ve skor,
  --    kazanılan puanın kendisi olmalı.
  ---------------------------------------------------------------------------
  s := public.ohaaaa_score(v_urun);
  if (s ->> 'measured_weight')::numeric <> 100 then
    raise exception 'BAŞARISIZ: dort bilesen olculurken agirlik 100 degil (%)',
      s ->> 'measured_weight';
  end if;
  if (s ->> 'score')::int is null then
    raise exception 'BAŞARISIZ: tam olculebilen teklife skor uretilmedi';
  end if;
  raise notice '✓ skor olculebilen agirlik uzerinden hesaplaniyor';

  ---------------------------------------------------------------------------
  -- 9) HER BİLEŞEN ÇIKTIDA VAR — ÖLÇÜLEMEYENLER DE
  --    Eksik bileşeni çıktıdan düşürmek, arayüzün "hepsi ölçüldü" gibi
  --    görünmesine yol açardı.
  ---------------------------------------------------------------------------
  if jsonb_array_length(s -> 'components') <> 4 then
    raise exception 'BAŞARISIZ: bilesen sayisi 4 degil (%)',
      jsonb_array_length(s -> 'components');
  end if;
  raise notice '✓ butun bilesenler ciktida listeleniyor';
end $$;

-- Skor ürün sayfasının vitrininde; giriş yapmamış ziyaretçi de görebilmeli.
do $$
begin
  if not has_function_privilege('anon', 'public.ohaaaa_score(uuid, int)', 'execute') then
    raise exception 'BAŞARISIZ: anon skoru okuyamiyor';
  end if;
  raise notice '✓ skor anon icin acik';
end $$;

rollback;
