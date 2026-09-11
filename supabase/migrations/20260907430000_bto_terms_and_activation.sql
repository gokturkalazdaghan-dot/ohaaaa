-- ===========================================================================
-- Back to the Office: KOMISYON DOGRULANDI, MAGAZA YAYINA ALINIYOR
-- ===========================================================================
--
-- Hesap sahibi Awin panosundan BTO'nun komisyon oranini bildirdi: %10.
--
-- Bu, depodaki diger advertiser kayitlariyla AYNI kanit sinifi: Alison'in
-- %20'si (20260907340000) ve WANAYOU'nun %10'u (20260907390000) da hesap
-- sahibi bildirimiyle yazildi. Awin advertiser dizini CSV'si komisyonu 0-0
-- gosteriyordu; o "sifir komisyon" degil "YAYINLANMAMIS" demekti -- dizin
-- programa katilmamis yayincilara orani gostermez. Katilmis bir yayincinin
-- panosu gosterir, ve hesap sahibi 61655'e katilmis durumda (feed listesinde
-- "active").
--
-- ---------------------------------------------------------------------------
-- BU GOC MAGAZAYI YAYINA ALIYOR -- IKI KAPI DA ARTIK ACIK
-- ---------------------------------------------------------------------------
--
-- `merchants_active_needs_template`        -> 20260907420000'de saglandi
-- `merchants_active_needs_verified_terms`  -> bu goc sagliyor
--
-- Yayina alinmasi demek, `loadSources`in bu magazanin kaynagini alim hattina
-- SOKMASI demek: `bto-instock` artik gercekten calisabilir.
--
-- cerez penceresi: 30 gun. Bu ORAN GIBI bildirilmedi, Awin advertiser dizini
-- CSV'sinden geldi (cookieLength 30) ve 20260907390000'de zaten yazilmisti.
-- `terms_verified_at` tanimi ikisini birden ister: komisyon VE cerez. Ikisi
-- de artik biliniyor, bu yuzden isaret konuluyor.
-- ===========================================================================

update public.merchants
   set default_commission_rate = 0.1000,
       terms_verified_at       = now(),
       status                  = 'active',
       application_status      = 'approved',
       approved_at             = coalesce(approved_at, now()),
       notes = coalesce(notes || ' | ', '') ||
         'KOMISYON DOGRULANDI (hesap sahibi bildirimi, Awin panosu): %10. '
         'Dizin CSV''sindeki 0-0 "sifir komisyon" degil "yayinlanmamis" '
         'demekti -- dizin katilmamis yayinciya orani gostermez, pano '
         'gosterir. Cerez 30 gun (dizin: cookieLength 30). Iki sart da '
         'bilindigi icin terms_verified_at kondu ve magaza YAYINA ALINDI: '
         'bto-instock kaynagi artik alim hattina giriyor.'
 where slug = 'back-to-the-office';

-- Ag bagi da ayni orani tasisin: tiklama bir orana, mutabakat baskasina
-- bakarsa gelir raporu sessizce ayrisir.
update public.merchant_network_links l
   set commission_rate = 0.1000
  from public.merchants m
 where m.id = l.merchant_id and m.slug = 'back-to-the-office';

update public.programs
   set commission_rate  = 0.1000,
       cookie_window_days = 30,
       last_verified_at = now(),
       terms = coalesce(terms || ' | ', '') ||
         'KOMISYON DOGRULANDI (hesap sahibi bildirimi): %10. Dizindeki 0-0 '
         'yayinlanmamis demekti.'
 where network = 'awin' and network_program_id = '61655';

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  m record;
  s record;
  v_sayi integer;
begin
  select * into m from public.merchants where slug = 'back-to-the-office';
  if m is null then
    raise exception 'DOGRULAMA 1: BTO magazasi yok.';
  end if;

  -- 2) SARTLAR: %10 ve 30 gun. Cerez varsayilanda kalsaydi tiklamadan 24
  --    saat sonraki her donusum sessizce reddedilirdi.
  if m.default_commission_rate <> 0.1000 then
    raise exception 'DOGRULAMA 2: komisyon 0.1000 olmali, bulunan %.',
      m.default_commission_rate;
  end if;
  if m.cookie_window_days <> 30 then
    raise exception 'DOGRULAMA 2b: cerez 30 gun olmali, bulunan %.',
      m.cookie_window_days;
  end if;

  -- 3) YAYINA ALINDI ve yayin kapilarinin IKISI de gercekten saglandi.
  if m.status <> 'active' then
    raise exception 'DOGRULAMA 3: magaza yayina alinmadi (%).', m.status;
  end if;
  if m.terms_verified_at is null or m.deeplink_template is null
     or m.homepage_url is null or m.country_code is null then
    raise exception 'DOGRULAMA 3b: yayin kapilarindan biri bos.';
  end if;

  -- 4) ORAN UC KAYITTA DA AYNI. Ayrisirlarsa tiklama bir orana, mutabakat
  --    baskasina bakar ve gelir raporu sessizce yanlis olur.
  select count(*) into v_sayi
    from public.merchant_network_links l
   where l.merchant_id = m.id and l.commission_rate is distinct from 0.1000;
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 4: ag baginda oran ayristi.';
  end if;
  if (select commission_rate from public.programs
       where network='awin' and network_program_id='61655') is distinct from 0.1000 then
    raise exception 'DOGRULAMA 4b: program orani ayristi.';
  end if;

  -- 5) KAYNAK ARTIK ALIM HATTINA GIREBILIYOR. `loadSources` iki kosula
  --    bakar: kaynak etkin VE magaza yayinda. Bu iddia, gocun ASIL
  --    sonucunu sinar -- oran yazmak tek basina bir sey degistirmezdi.
  select * into s from public.sources where slug = 'bto-instock';
  if s is null or not s.is_enabled then
    raise exception 'DOGRULAMA 5: bto-instock kaynagi yok ya da kapali.';
  end if;

  -- 6) HENUZ URUN GIRMEDI: bu goc yayin kapisini acar, alimi CALISTIRMAZ.
  select count(*) into v_sayi from public.products where source_id = s.id;
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 6: goc % urun yazmis.', v_sayi;
  end if;

  -- 7) BASKA HICBIR AWIN MAGAZASI YAYINA ALINMADI.
  --
  --    Kapsam AWIN ile sinirli, "butun magazalar" ile degil: tohum verisinde
  --    zaten yayinda olan `direct` magazalar var (ornek-magaza-a/b) ve onlari
  --    saymak, bu gocun yapmadigi bir seyi ona yuklerdi. Yakalamak istedigimiz
  --    kaza su: tek magaza yerine butun ortaklik agini yayina almak. Alison
  --    (feed'de fiyat yok), Mooncool (5 urun) ve WANAYOU (feed'i yok) HÂLÂ
  --    yayinda olmamali.
  select count(*) into v_sayi
    from public.merchants
   where network = 'awin' and status = 'active' and slug <> 'back-to-the-office';
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 7: bu goc % baska Awin magazasini da yayina almis.',
      v_sayi;
  end if;

  raise notice
    'BTO yayinda: komisyon %%10, cerez 30 gun, sablon + ana sayfa + ulke '
    'tam. bto-instock kaynagi artik alim hattina giriyor. Urun YAZILMADI.';
end $$;
