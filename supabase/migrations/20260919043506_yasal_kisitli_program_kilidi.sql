-- ============================================================================
-- YASAL KISITLI PROGRAM: CBD ARMOUR YAYINA ALINMIYOR
-- ============================================================================
-- Karar verildi: 17948 CBD Armour yayina ALINMAYACAK. Kenevir turevi satiyor
-- ve Turkiye mevzuatinda bu kontrollu bir madde.
--
-- NEDEN "UNAVAILABLE", "REJECTED" DEGIL
-- REJECTED, "basvurduk ve Awin bizi reddetti" demektir. Oyle bir sey olmadi.
-- Yanlis durum yazmak, ileride birinin "neden reddedildik, tekrar basvuralim"
-- diye dusunmesine yol acardi. UNAVAILABLE dogruyu soyluyor: program var,
-- biz kullanmiyoruz.
--
-- NEDEN SATIR SILINMIYOR
-- Silinseydi bir sonraki Awin dizin cekiminde hicbir uyari olmadan yeniden
-- kesfedilir, gecmisi bilinmeden degerlendirilir ve ayni tartisma sifirdan
-- baslardi. Kayit, "bu programi GORDUK ve BILEREK almadik" bilgisini tasiyan
-- tek yer.
--
-- ----------------------------------------------------------------------------
-- KARAR HAFIZAYA DEGIL, VERITABANINA BAGLANIYOR
-- ----------------------------------------------------------------------------
-- Durumu elle degistirmek yetmez: alti ay sonra baska biri (ya da bir toplu
-- guncelleme) bu satiri APPROVED yapabilir ve kimse fark etmez. Tetikleyici
-- bunu IMKANSIZ kiliyor -- `raw.yasal_kisit` dolu oldugu surece program
-- yayin yolundaki hicbir duruma gecemez.
--
-- Kapi tamamen kilitli degil: kisit alanini KASITLI olarak silmek gerekir.
-- Boylece yayina alma her zaman bilincli bir hareket olur, kazara degil.
-- ============================================================================

update public.programs
   set application_state = 'UNAVAILABLE'::public.program_application_state,
       raw = raw || jsonb_build_object(
         'yayin_karari', 'ALINMADI',
         'karar_tarihi', to_char(now(), 'YYYY-MM-DD'),
         'karar_gerekcesi', 'Kenevir turevi (CBD). Turkiye mevzuatinda kontrollu madde.'
       )
 where network = 'awin' and network_program_id = '17948';

create or replace function public.tg_yasal_kisit_yayini_engelle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.raw ? 'yasal_kisit'
     and new.application_state in (
       'ELIGIBLE','APPLICATION_READY','APPLIED','PENDING','APPROVED'
     )::public.program_application_state[]
  then
    raise exception
      'Yasal kisitli program yayin yoluna alinamaz (%). Kisit: %. Once raw.yasal_kisit alani bilerek kaldirilmalidir.',
      new.network_program_id, new.raw->>'yasal_kisit';
  end if;
  return new;
end $$;

comment on function public.tg_yasal_kisit_yayini_engelle is
  'raw.yasal_kisit tasiyan bir programin yayin yolundaki durumlara gecmesini '
  'engeller. Kararin hafizada degil veritabaninda durmasi icin var.';

drop trigger if exists programs_yasal_kisit_kilidi on public.programs;
create trigger programs_yasal_kisit_kilidi
  before insert or update of application_state, raw on public.programs
  for each row execute function public.tg_yasal_kisit_yayini_engelle();

do $$
declare
  v_durum text;
  v_hata  boolean := false;
begin
  select application_state::text into v_durum
    from public.programs where network='awin' and network_program_id='17948';
  if v_durum <> 'UNAVAILABLE' then
    raise exception 'BASARISIZ: CBD Armour durumu % (UNAVAILABLE olmaliydi)', v_durum;
  end if;

  -- Kilidin GERCEKTEN calistigini kanitla: APPROVED denemesi dusmeli.
  begin
    update public.programs set application_state='APPROVED'::public.program_application_state
     where network='awin' and network_program_id='17948';
    v_hata := true;  -- buraya gelinmemeliydi
  exception when others then
    null;  -- beklenen
  end;

  if v_hata then
    raise exception 'BASARISIZ: yasal kisitli program APPROVED yapilabildi -- kilit calismiyor';
  end if;

  raise notice 'CBD Armour UNAVAILABLE ve kilit dogrulandi (APPROVED denemesi reddedildi)';
end $$;