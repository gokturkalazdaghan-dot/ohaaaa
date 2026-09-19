-- ============================================================================
-- GRADE MOBILE: SABİT ÜCRET ORANA ÇEVRİLEMEZ
-- ----------------------------------------------------------------------------
-- Grade Mobile'ın oran kartındaki ON ÜÇ grubun ON BİRİ SABİT ÜCRET
-- (GBP 7 .. GBP 70), yalnızca İKİSİ oran (%10 ve %4). `merchants`
-- şemasındaki sütun bir ORAN tutuyor (0 <= x <= 0,9) ve sabit ücreti
-- ifade edemiyor.
--
-- Buradaki sessiz bozulma şudur: biri "GBP 35 ortalama sepette ~%12 eder"
-- deyip sütuna 0.12 yazar. Sabit ücret sepet tutarından BAĞIMSIZDIR; orana
-- çevirmek sepet büyüdükçe kazancı olduğundan yüksek gösterir ve bu hata
-- yalnızca ödeme mutabakatında, aylar sonra fark edilir.
--
-- İkinci sessiz bozulma: sabit ücretli feed'lerin (BuyBack, Pay Monthly,
-- SIM, Repair) katalogda ürün gibi görünmesi. BuyBack'te müşteri telefon
-- SATAR; "Pay Monthly" bir sözleşmedir. Fiyat karşılaştırma motoruna
-- girerlerse kıyaslanamaz kalemler kıyaslanabilir görünür.
--
-- Dört iddia:
--   1) yüklenen oran YÜKLENEN FEED'in grubuna eşit (%4)
--   2) hizmet/abonelik feed'leri adreste YOK
--   3) mağaza active ve deeplink DOĞRU advertiser'ı taşıyor
--   4) anahtar sütunda değil
-- ============================================================================
begin;

\set ON_ERROR_STOP on

-- --------------------------------------------------------------------------
-- 1) ORAN YÜKLENEN FEED'İN GRUBUNA EŞİT
-- --------------------------------------------------------------------------
do $$
declare
  v_oran  numeric;
  v_cerez integer;
begin
  select default_commission_rate, cookie_window_days
    into v_oran, v_cerez
    from public.merchants where slug = 'grade-mobile';

  if v_oran is null then
    raise exception 'Grade Mobile bulunamadi';
  end if;

  -- %4: "Refurbished devices (grademobile.co.uk)" -- MAIN SITE feed'inin grubu.
  if v_oran <> 0.0400 then
    raise exception
      'default_commission_rate % -- %%4 olmaliydi. Kartta yalnizca IKI oran var '
      '(%%10 Unlocking, %%4 Refurbished); geri kalan ON BIR grup SABIT UCRET ve '
      'bu sutunda temsil edilemez. Farkli bir sayi gorulduyse buyuk ihtimalle '
      'bir sabit ucret orana CEVRILMISTIR -- sepet buyudukce kazanc oldugundan '
      'yuksek gorunur.', v_oran;
  end if;

  if v_cerez <> 30 then
    raise exception 'Cerez penceresi % (30 olmaliydi)', v_cerez;
  end if;

  raise notice 'oran %%4, cerez 30 gun.';
end $$;

-- --------------------------------------------------------------------------
-- 2) HİZMET / ABONELİK FEED'LERİ KATALOGDA OLMAMALI
-- --------------------------------------------------------------------------
do $$
declare
  v_adres text;
  v_fid   text;
begin
  select endpoint_url into v_adres
    from public.sources where slug = 'grade-mobile-main';

  if v_adres is null then
    raise exception 'Grade Mobile kaynagi yok';
  end if;

  foreach v_fid in array array[
    '58895',  -- BUY_BACK      : musteri telefon SATAR (GBP 7 sabit)
    '95085',  -- Pay Monthly   : sozlesme (GBP 35 sabit)
    '94188',  -- SIM Only      : hizmet (GBP 10..23 sabit)
    '50529'   -- Repair Site   : tamir hizmeti, AYRI alan adi (%10)
  ] loop
    if v_adres ~ ('(^|[/,])' || v_fid || '([,/]|$)') then
      raise exception
        'Hizmet/abonelik feed''i % adreste: SABIT UCRET oduyor (%%4''luk oranla '
        'temsil edilemez) ve urun degil -- fiyat karsilastirmasina giremez.',
        v_fid;
    end if;
  end loop;

  -- Yuklenmesi gereken feed YERINDE olmali: (2) yalnizca fazlasini yakalar,
  -- adres bos birakilsaydi da gecerdi.
  if v_adres !~ '(^|[/,])58891([,/]|$)' then
    raise exception 'MAIN SITE feed''i (58891) adreste yok';
  end if;

  raise notice 'yalnizca MAIN SITE yukleniyor, hizmet feedleri disarida.';
end $$;

-- --------------------------------------------------------------------------
-- 3) MAĞAZA active VE DEEPLINK DOĞRU ADVERTISER
-- --------------------------------------------------------------------------
do $$
declare
  v_durum  text;
  v_sablon text;
  v_terms  timestamptz;
  v_pazar  text;
  v_para   text;
begin
  select m.status::text, m.deeplink_template, m.terms_verified_at
    into v_durum, v_sablon, v_terms
    from public.merchants m where m.slug = 'grade-mobile';

  if v_durum <> 'active' then
    raise exception
      'Magaza % (active olmaliydi): affiliate urunleri yalnizca magaza active '
      'iken gorunur -- alim calisir, vitrin BOS kalirdi.', v_durum;
  end if;

  if v_sablon !~ 'awinmid=22069' then
    raise exception 'Deeplink sablonu yanlis advertiser tasiyor: %', v_sablon;
  end if;
  if v_terms is null then
    raise exception 'terms_verified_at bos';
  end if;

  select market_code, currency into v_pazar, v_para
    from public.sources where slug = 'grade-mobile-main';

  -- Pazar ve para birimi tutarsizsa fiyatlar yanlis simgeyle basilir.
  if v_pazar <> 'UK' or v_para <> 'GBP' then
    raise exception 'Kaynak pazari/para birimi yanlis: % / %', v_pazar, v_para;
  end if;

  raise notice 'magaza active, deeplink 22069, pazar UK/GBP.';
end $$;

-- --------------------------------------------------------------------------
-- 4) ANAHTAR SÜTUNDA OLMAMALI
-- --------------------------------------------------------------------------
-- Kural bir satira ozel degil: BUTUN kaynaklar olculuyor.
do $$
declare
  v_slug text;
begin
  select slug into v_slug
    from public.sources
   where endpoint_url ~ 'apikey/[0-9a-f]{16,}'
      or endpoint_url ~ '(token|key|secret)=[A-Za-z0-9]{16,}'
   limit 1;

  if v_slug is not null then
    raise exception
      'Kaynak "%" adresinde DUZ METIN kimlik bilgisi var.', v_slug;
  end if;

  raise notice 'hicbir kaynak adresinde duz metin anahtar yok.';
end $$;

rollback;
