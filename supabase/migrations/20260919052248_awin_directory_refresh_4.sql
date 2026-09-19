-- Awin reklamveren dizini (4. dosya) — 48 satir okundu, 1'i YENI.
--
-- 47 satir ZATEN KAYITLI ve bu goce HIC ALINMADI. Dizin dokumleri buyuk
-- olcude ortusuyor; ayni olculmus degerleri her dosyada yeniden yazmak,
-- degismeyen veriyi dorduncu kez uretime tasimak olurdu.
--
-- Dizinde OLMAYAN ama uretimde duran 2 program (129105 HealthRX,
-- 50899 Xuchang Aixiu) SILINMEDI. Bir satirin bu dosyada gorunmemesi
-- "program kapandi" demek degil; dokum filtreli cekilmis olabilir.
-- Yoklugu kanit saymak, calisan bir programi sessizce kaybetmek olurdu.
--
-- ---------------------------------------------------------------------
-- 111786 ENJOX TOYS — YETISKIN URUNU, KANONIK KATEGORISI ZATEN VAR
-- ---------------------------------------------------------------------
-- Awin sektoru "Erotic". Bu, taksonomideki 18. Seviye-1'in
-- (Seks Oyuncaklari & Yetiskin Urunleri) tam olarak var olma sebebi.
-- Esleme de hazir: `awin:erotic` -> `yetiskin-urunleri`, ve o dal
-- `access_restriction = 'adult'` tasiyor. Yani feed alindiginda urunler
-- yas kisitli dala duser -- ayrica bir kural yazmak gerekmiyor.
--
-- CBD Armour ile KARISTIRILMAMALI: orada urun Turkiye mevzuatinda
-- kontrollu bir maddeydi ve yayin karari hukukiydi. Burada oyle bir kisit
-- yok; tasarlanmis kategoriye giren siradan bir yetiskin urunu saticisi.
-- Bu yuzden `yasal_kisit` isareti KONMUYOR -- konsaydi, gercek bir hukuki
-- engeli olan kayitlarla ayni rafa girer ve o isaretin anlami asinirdi.
--
-- EPC: conversionRate dolu (5.03), yani 0.20 GERCEK bir olcum.
-- KOMISYON: commissionMax 0 = yayinlanmamis -> NULL.
-- awinIndex 0 geldi; approvalRate 92.31 olculmus olmasina ragmen endeks
-- yayinlanmamis. Oldugu gibi yaziliyor, yorumlanmiyor.
--
-- DISCOVERED: teknik entegrasyon ve sozlesme dogrulamasi olmadan hicbir
-- program yayina alinamaz.
with v(np_id, ad, url, ulke, komisyon, cerez, feed, epc, ham) as (values
  ('111786','Enjox Toys','https://www.enjox.com/','US',
   null, 30, true, 20,
   '{"primarySector": "Erotic", "approvalRate": 92.31, "awinIndex": 0.0, "kaynak": "awin-advertiser-directory-4", "yetiskin": true}')
)
insert into public.programs
  (network, network_program_id, merchant_name, homepage_url, country_code,
   commission_rate, cookie_window_days, feed_available, epc_cents,
   application_state, last_verified_at, raw)
select 'awin', v.np_id, v.ad, v.url, v.ulke::char(2),
       v.komisyon::numeric, v.cerez::int, v.feed::boolean, v.epc::bigint,
       'DISCOVERED'::public.program_application_state, now(), v.ham::jsonb
  from v
on conflict (network, network_program_id) do update
  set merchant_name      = excluded.merchant_name,
      homepage_url       = coalesce(excluded.homepage_url, public.programs.homepage_url),
      country_code       = coalesce(excluded.country_code, public.programs.country_code),
      commission_rate    = coalesce(excluded.commission_rate, public.programs.commission_rate),
      cookie_window_days = coalesce(excluded.cookie_window_days, public.programs.cookie_window_days),
      feed_available     = excluded.feed_available,
      epc_cents          = coalesce(excluded.epc_cents, public.programs.epc_cents),
      last_verified_at   = now(),
      raw                = coalesce(public.programs.raw, '{}'::jsonb) || excluded.raw;

do $$
declare
  v_toplam int; v_yeni int; v_aktif int; v_korunan int; v_hedef text;
begin
  select count(*) into v_toplam from public.programs where network = 'awin';
  select count(*) into v_yeni from public.programs
   where network = 'awin' and raw->>'kaynak' = 'awin-advertiser-directory-4';
  select count(*) into v_aktif from public.programs
   where network = 'awin' and application_state not in (
     'DISCOVERED'::public.program_application_state,
     'UNAVAILABLE'::public.program_application_state);
  select count(*) into v_korunan from public.programs
   where network = 'awin' and network_program_id in ('129105','50899');

  if v_yeni <> 1 then
    raise exception 'BASARISIZ: 1 yeni program bekleniyordu, % bulundu', v_yeni;
  end if;
  if v_aktif > 0 then
    raise exception 'BASARISIZ: % program yayin yolunda -- dizin gocu hicbirini yayina alamaz', v_aktif;
  end if;
  if v_korunan <> 2 then
    raise exception 'BASARISIZ: dizinde olmayan 2 program korunmaliydi, % bulundu', v_korunan;
  end if;

  -- Yetiskin urunlerinin gidecegi kanonik kategori GERCEKTEN yas kisitli mi?
  -- Degilse, bu saticinin urunleri kapisiz bir dala duserdi.
  select c.access_restriction into v_hedef
    from public.category_source_map m
    join public.categories c on c.id = m.category_id
   where m.source = 'awin' and m.source_key = 'erotic';
  if v_hedef is distinct from 'adult' then
    raise exception 'BASARISIZ: erotic eslemesinin hedefi yas kisitli degil (%)', v_hedef;
  end if;

  raise notice 'awin dizini: toplam %, bu gocte yeni %, yayin yolunda %, korunan %; erotic -> yas kisitli dal',
    v_toplam, v_yeni, v_aktif, v_korunan;
end $$;