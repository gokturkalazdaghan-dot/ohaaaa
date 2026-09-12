-- ===========================================================================
-- Simple Project kaynagini alima acar (is_enabled = true)
--
-- Onceki goc (20260912120000) sartlari dogrulayip magazayi yayina aldi ama
-- kaynagi BILEREK kapali birakti: alim ayri bir karardi. Bu goc yalnizca o
-- karari veriyor.
--
-- KOSULLU ACILIR. `where` yan tumcesi dort sarti birden arar; biri bile
-- tutmazsa SATIR GUNCELLENMEZ ve asagidaki dogrulama bunu yakalar. Kaynagi
-- kosulsuz acmak, MID'i ya da feed bagi bozulmus bir kaynagi da acmak
-- olurdu -- ve alim hatti o durumda yanlis reklamverene karsi dogrulama
-- yapardi.
--
-- `loadSources` iki kosul birden arar: sources.is_enabled = true VE
-- merchants.status = 'active'. Ikincisi onceki gocte saglandi.
-- ===========================================================================

update public.sources s
   set is_enabled = true
  from public.merchants m
 where s.merchant_id = m.id
   and s.slug                    = 'simple-project-awin-f2281'
   and s.feed_id                 = '2281'
   and s.expected_advertiser_id  = '99013'
   and m.network_advertiser_id   = '99013'
   and m.status                  = 'active'
   and m.terms_verified_at is not null;

do $$
declare s record; m record; v_bto integer; v_acik integer;
begin
  select * into s from public.sources  where slug = 'simple-project-awin-f2281';
  select * into m from public.merchants where slug = 'simple-project';

  if not s.is_enabled then
    raise exception
      'DOGRULAMA 1: kaynak acilmadi. Kosullardan biri tutmadi '
      '(feed=%, kaynak_mid=%, magaza_mid=%, durum=%, sart=%).',
      s.feed_id, s.expected_advertiser_id, m.network_advertiser_id,
      m.status, (m.terms_verified_at is not null);
  end if;

  -- Bag hala deterministik mi: kaynagin iddiasi magazanin MID i ile ayni.
  if s.expected_advertiser_id <> m.network_advertiser_id then
    raise exception 'DOGRULAMA 2: kaynak % bekliyor, magaza %.',
      s.expected_advertiser_id, m.network_advertiser_id;
  end if;

  -- Izolasyon sinyali eslenmis olmali; yoksa hat FAIL CLOSED durur.
  if s.field_mapping->>'merchant_id' is null then
    raise exception 'DOGRULAMA 3: field_mapping.merchant_id yok -- '
      'satirlarin hangi magazaya ait oldugu dogrulanamaz.';
  end if;

  -- `loadSources` suzgecinin gercekten bu kaynagi dondurdugunu kanitla.
  select count(*) into v_acik
    from public.sources x join public.merchants y on y.id = x.merchant_id
   where x.is_enabled and y.status = 'active';
  if v_acik <> 1 then
    raise exception 'DOGRULAMA 4: alima acik kaynak sayisi 1 olmaliydi, bulunan %.', v_acik;
  end if;

  -- BTO / MID 61655: ne magaza ne de kaynak tarafinda hicbir sey acilmadi.
  select count(*) into v_bto
    from public.sources x join public.merchants y on y.id = x.merchant_id
   where y.network_advertiser_id = '61655';
  if v_bto > 0 then
    raise exception 'DOGRULAMA 5: BTO icin kaynak var -- onaysiz programa trafik riski.';
  end if;

  raise notice
    'Simple Project kaynagi alima acildi (feed 2281, reklamveren 99013). '
    'Alima acik tek kaynak bu. BTO/61655 degismedi.';
end $$;
