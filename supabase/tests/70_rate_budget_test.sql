-- ============================================================================
-- HIZ SAYACI — tavan gerçekten durduruyor mu?
-- ----------------------------------------------------------------------------
-- Aynı sayaç hem yapay zekâ çağrılarını hem kimlik doğrulama denemelerini
-- sınırlıyor; bu yüzden burada sınanan şey mekanizmanın kendisi.
--
-- Bir hız sınırının en sinsi hâli, VARMIŞ GİBİ görünüp uygulanmayanıdır.
-- Bu depoda tam olarak bu bir kez yaşandı: bellekte tutulan sayaç sunucusuz
-- ortamda her istekte sıfırlanıyordu. O yüzden burada sınanan şey ayarın
-- varlığı değil, N+1'inci çağrının GERÇEKTEN reddedilmesi.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

do $$
declare
  s jsonb;
  i int;
begin
  ---------------------------------------------------------------------------
  -- 1) Tavana kadar izin var, tavanı geçince YOK
  ---------------------------------------------------------------------------
  for i in 1 .. 3 loop
    s := public.consume_rate_budget('test:kova:a', 3, 3600);
    if (s ->> 'allowed')::boolean is not true then
      raise exception 'BAŞARISIZ: %. cagri tavan icindeyken reddedildi (%)', i, s;
    end if;
  end loop;
  raise notice '✓ tavana kadar izin veriliyor';

  s := public.consume_rate_budget('test:kova:a', 3, 3600);
  if (s ->> 'allowed')::boolean is not false then
    raise exception 'BAŞARISIZ: tavan asildigi halde izin verildi (%)', s;
  end if;
  if (s ->> 'remaining')::int <> 0 then
    raise exception 'BAŞARISIZ: tavan asildiginda kalan negatif/yanlis (%)', s ->> 'remaining';
  end if;
  raise notice '✓ tavan asilinca reddediliyor, kalan 0';

  ---------------------------------------------------------------------------
  -- 2) KOVALAR BİRBİRİNDEN BAĞIMSIZ
  --    Bir kullanıcının hakkını doldurması, başka bir kullanıcıyı ya da
  --    küresel sayacı etkilememeli.
  ---------------------------------------------------------------------------
  s := public.consume_rate_budget('test:kova:b', 3, 3600);
  if (s ->> 'allowed')::boolean is not true then
    raise exception 'BAŞARISIZ: bir kovanin dolmasi digerini kapatti';
  end if;
  raise notice '✓ kovalar birbirinden bagimsiz';

  ---------------------------------------------------------------------------
  -- 3) PENCERE DEĞİŞİNCE SAYAÇ SIFIRLANIR
  --    Pencerenin geçtiğini, satırın penceresini geriye alarak taklit
  --    ediyoruz: fonksiyon şimdiki pencereyi hesaplayınca satırdakiyle
  --    uyuşmaz ve saymaya 1'den başlamalı.
  ---------------------------------------------------------------------------
  update public.rate_counters
     set window_start = window_start - interval '2 hours'
   where bucket = 'test:kova:a';

  s := public.consume_rate_budget('test:kova:a', 3, 3600);
  if (s ->> 'allowed')::boolean is not true then
    raise exception 'BAŞARISIZ: yeni pencerede sayac sifirlanmadi (%)', s;
  end if;
  if (s ->> 'used')::int <> 1 then
    raise exception 'BAŞARISIZ: yeni pencere 1 den baslamadi (%)', s ->> 'used';
  end if;
  raise notice '✓ pencere degisince sayac sifirlaniyor';

  ---------------------------------------------------------------------------
  -- 4) SAYAÇ ÖNCE ARTAR, SONRA KARAR VERİLİR
  --    Tersi (önce oku sonra yaz) eşzamanlı isteklerde sınırı sızdırırdı.
  --    Kanıt: tavanı 1 olan yepyeni bir kovada İLK çağrı zaten used=1 döner.
  ---------------------------------------------------------------------------
  s := public.consume_rate_budget('test:kova:c', 1, 3600);
  if (s ->> 'used')::int <> 1 or (s ->> 'allowed')::boolean is not true then
    raise exception 'BAŞARISIZ: ilk cagri beklenmedik (%)', s;
  end if;
  s := public.consume_rate_budget('test:kova:c', 1, 3600);
  if (s ->> 'allowed')::boolean is not false then
    raise exception 'BAŞARISIZ: tavan 1 iken ikinci cagriya izin verildi';
  end if;
  raise notice '✓ sayac cagri aninda artiyor';
end $$;

-- ---------------------------------------------------------------------------
-- Sayaç istemciden görülemez ve değiştirilemez
-- ---------------------------------------------------------------------------
-- Kullanıcının kendi sayacını sıfırlayabilmesi, sınırı olmamakla aynı şey.
do $$
begin
  if has_table_privilege('anon', 'public.rate_counters', 'SELECT') then
    raise exception 'BAŞARISIZ: anon sayaci okuyabiliyor';
  end if;
  if has_table_privilege('authenticated', 'public.rate_counters', 'UPDATE') then
    raise exception 'BAŞARISIZ: authenticated sayaci degistirebiliyor';
  end if;
  if has_function_privilege('anon', 'public.consume_rate_budget(text, integer, integer)', 'execute') then
    raise exception 'BAŞARISIZ: anon sayaci kendi artirabiliyor';
  end if;
  if not has_function_privilege('service_role', 'public.consume_rate_budget(text, integer, integer)', 'execute') then
    raise exception 'BAŞARISIZ: sunucu tarafi sayaci artiramiyor';
  end if;
  raise notice '✓ sayac yalnizca sunucu tarafindan yonetiliyor';
end $$;

rollback;
