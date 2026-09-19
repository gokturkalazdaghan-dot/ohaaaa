-- ============================================================================
-- YASAL KISIT KİLİDİ — hem KORUDUĞUNU hem ENGELLEMEDİĞİNİ kanıtla
-- ----------------------------------------------------------------------------
-- BU DOSYA BİR HATADAN DOĞDU.
--
-- Kilit ilk yazıldığında koşul şöyleydi:
--     new.application_state in ('ELIGIBLE',...)::program_application_state[]
-- Cast `in` listesine değil İFADENİN TAMAMINA bağlanıyor; Postgres bunu
-- "boolean'ı diziye çevir" diye okuyup ifadeyi değerlendiremiyordu. Sonuç:
-- tetikleyici kısıtlı satırları değil, `programs` üzerindeki HER yazmayı
-- düşürüyordu. Keşif, dizin tazeleme ve puanlama -- hepsi kırıktı.
--
-- Göçün kendi negatif testi bunu KAÇIRDI: "APPROVED yapmayı dene, hata
-- bekle" diyordu, hata geldi ve test geçti -- ama beklenen sebepten değil,
-- cast hatasından. `exception when others` her hatayı aynı saydı.
--
-- Buradaki üç iddia o boşluğu kapatıyor:
--   1) kısıtsız program yazılabilmeli   <- kaçan buydu
--   2) kısıtlı program yayına alınamamalı VE sebep DOĞRU olmalı
--   3) kısıtlı program yayın dışı bir duruma geçebilmeli (kilit dondurmaz)
--
-- Bir koruma, neyi engellediği kadar neyi ENGELLEMEDİĞİ ile de tanımlıdır.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

do $$
declare
  v_mesaj  text;
  v_kisitli text;
  v_serbest text;
  v_gecti  boolean;
begin
  -- Test verisi: kısıtlı ve kısıtsız birer program. Canlı satırlara
  -- dayanmıyor; bu dosya seed'den bağımsız çalışmalı.
  insert into public.programs (network, network_program_id, merchant_name, application_state,
                               last_verified_at, raw)
  values ('awin', 'kilit-testi-kisitli', 'Kisitli Test', 'DISCOVERED', now(),
          '{"yasal_kisit": "test amacli kisit"}'::jsonb)
  returning id into v_kisitli;

  insert into public.programs (network, network_program_id, merchant_name, application_state,
                               last_verified_at, raw)
  values ('awin', 'kilit-testi-serbest', 'Serbest Test', 'DISCOVERED', now(), '{}'::jsonb)
  returning id into v_serbest;

  -- 1) KISITSIZ PROGRAM ENGELLENMEMELİ.
  begin
    update public.programs
       set application_state = 'APPROVED'::public.program_application_state
     where id = v_serbest::uuid;
  exception when others then
    get stacked diagnostics v_mesaj = message_text;
    raise exception 'BAŞARISIZ: kisitsiz program engellendi -> %', v_mesaj;
  end;

  -- 2) KISITLI PROGRAM YAYIN YOLUNA ALINAMAMALI, SEBEP DOĞRU OLMALI.
  v_gecti := false;
  begin
    update public.programs
       set application_state = 'APPROVED'::public.program_application_state
     where id = v_kisitli::uuid;
  exception when others then
    get stacked diagnostics v_mesaj = message_text;
    if v_mesaj like '%Yasal kisitli program yayin yoluna alinamaz%' then
      v_gecti := true;
    else
      -- Hatanin GELMESI yetmez; DOGRU hata olmali.
      raise exception 'BAŞARISIZ: kilit dustu ama yanlis sebepten -> %', v_mesaj;
    end if;
  end;
  if not v_gecti then
    raise exception 'BAŞARISIZ: yasal kisitli program APPROVED yapilabildi';
  end if;

  -- 3) KİLİT KAYDI DONDURMAZ: yayın dışı durumlar serbest.
  begin
    update public.programs
       set application_state = 'UNAVAILABLE'::public.program_application_state
     where id = v_kisitli::uuid;
  exception when others then
    get stacked diagnostics v_mesaj = message_text;
    raise exception 'BAŞARISIZ: kisitli program UNAVAILABLE yapilamadi -> %', v_mesaj;
  end;

  raise notice '✓ yasal kisit kilidi: kisitsiz serbest, kisitli yayina alinamiyor (dogru sebeple), kayit donmuyor';
end $$;

-- ---------------------------------------------------------------------------
-- CANLIDAKİ KARAR YERİNDE Mİ
-- ---------------------------------------------------------------------------
-- CBD Armour bilerek yayına alınmadı. Bir göç ya da toplu güncelleme bunu
-- sessizce geri alırsa burada görülür.
do $$
declare v_durum text; v_kisit boolean;
begin
  select application_state::text, (raw ? 'yasal_kisit')
    into v_durum, v_kisit
    from public.programs where network = 'awin' and network_program_id = '17948';

  if v_durum is null then
    raise notice '• CBD Armour kaydi yok (seed disi ortam) — atlandi';
    return;
  end if;
  if not coalesce(v_kisit, false) then
    raise exception 'BAŞARISIZ: CBD Armour uzerindeki yasal kisit isareti kaybolmus';
  end if;
  if v_durum in ('ELIGIBLE','APPLICATION_READY','APPLIED','PENDING','APPROVED') then
    raise exception 'BAŞARISIZ: CBD Armour yayin yoluna alinmis (%)', v_durum;
  end if;
  raise notice '✓ CBD Armour yayin disi (%) ve kisit isareti duruyor', v_durum;
end $$;

rollback;
