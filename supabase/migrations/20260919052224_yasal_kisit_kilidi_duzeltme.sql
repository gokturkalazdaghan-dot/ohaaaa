-- ============================================================================
-- YASAL KISIT KILIDI — BOZUKTU, DUZELTILDI
-- ============================================================================
-- HATA
-- `20260919043506_yasal_kisitli_program_kilidi` icindeki kosul soyle yazilmisti:
--
--   if new.raw ? 'yasal_kisit'
--      and new.application_state in ('ELIGIBLE',...)::public.program_application_state[]
--
-- Cast, `in (...)` listesine degil IFADENIN TAMAMINA baglaniyor. Postgres
-- bunu "boolean'i program_application_state[] tipine cevir" diye okuyor ve
-- ifade DEGERLENDIRILEMIYOR. Sonuc: tetikleyici, kisit tasiyan satirlarda
-- degil, `programs` uzerindeki HER insert/update'te dusuyordu.
--
-- Yani kilit, korumasi gereken seyi korumuyor; onun yerine butun program
-- yazmalarini (kesif, dizin tazeleme, puanlama) engelliyordu.
--
-- ----------------------------------------------------------------------------
-- TEST NEDEN YAKALAMADI
-- ----------------------------------------------------------------------------
-- Orijinal gocun negatif testi "APPROVED yapmayi dene, hata bekle" diyordu.
-- Hata GELDI ve test GECTI -- ama beklenen sebepten degil, cast hatasindan.
-- `exception when others then null` her hatayi ayni sayiyordu.
--
-- Bu yuzden asagidaki test artik hatanin METNINI de kontrol ediyor: yalnizca
-- "bir hata oldu" degil, "DOGRU hata oldu". Ayrica kisitsiz bir programin
-- guncellenebildigi de ayrica kanitlaniyor -- asil kacan buydu.
-- ============================================================================

create or replace function public.tg_yasal_kisit_yayini_engelle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.raw ? 'yasal_kisit'
     and new.application_state = any (
       array['ELIGIBLE','APPLICATION_READY','APPLIED','PENDING','APPROVED']
       ::public.program_application_state[]
     )
  then
    raise exception
      'Yasal kisitli program yayin yoluna alinamaz (%). Kisit: %. Once raw.yasal_kisit alani bilerek kaldirilmalidir.',
      new.network_program_id, new.raw->>'yasal_kisit';
  end if;
  return new;
end $$;

do $$
declare
  v_mesaj text;
  v_gecti boolean;
begin
  -- 1) KISITSIZ program guncellenebilmeli. Kacan hata tam olarak buydu.
  begin
    update public.programs set raw = raw
     where network = 'awin' and network_program_id = '12044';
    raise notice 'kisitsiz program guncellenebiliyor';
  exception when others then
    get stacked diagnostics v_mesaj = message_text;
    raise exception 'BASARISIZ: kisitsiz program guncellenemedi -> %', v_mesaj;
  end;

  -- 2) KISITLI program yayin yoluna alinamamali VE sebep dogru olmali.
  v_gecti := false;
  begin
    update public.programs
       set application_state = 'APPROVED'::public.program_application_state
     where network = 'awin' and network_program_id = '17948';
  exception when others then
    get stacked diagnostics v_mesaj = message_text;
    if v_mesaj like '%Yasal kisitli program yayin yoluna alinamaz%' then
      v_gecti := true;
    else
      raise exception 'BASARISIZ: kilit dusdu ama YANLIS sebepten -> %', v_mesaj;
    end if;
  end;
  if not v_gecti then
    raise exception 'BASARISIZ: yasal kisitli program APPROVED yapilabildi';
  end if;

  -- 3) Kisitli programin kisit DISI bir duruma gecmesi serbest kalmali:
  --    kilit yayini engeller, kaydi dondurmaz.
  begin
    update public.programs
       set application_state = 'UNAVAILABLE'::public.program_application_state
     where network = 'awin' and network_program_id = '17948';
  exception when others then
    get stacked diagnostics v_mesaj = message_text;
    raise exception 'BASARISIZ: kisitli program UNAVAILABLE yapilamadi -> %', v_mesaj;
  end;

  raise notice 'kilit dogru calisiyor: kisitsiz serbest, kisitli yayina alinamiyor, sebep dogru';
end $$;