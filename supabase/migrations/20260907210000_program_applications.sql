-- ===========================================================================
-- BAŞVURU MOTORU — denetim izi, idempotency ve durum geçiş kapısı
-- ===========================================================================
--
-- ÜÇ AYRI TEHLİKE, ÜÇ AYRI SAVUNMA:
--
--   1. AYNI PROGRAMA İKİ BAŞVURU. İki eşzamanlı tur ya da bir yeniden
--      deneme aynı programa iki kez başvurur. Ağ tarafında bu, kötüye
--      kullanım sayılır ve hesabın askıya alınmasına kadar gider.
--      SAVUNMA: `idempotency_key` üzerinde TEKİL kısıt. Kod tarafında
--      "önce SELECT, yoksa INSERT" yapılabilirdi ama o kalıp tam olarak
--      bu yarışı ÜRETİR: ikisi de "yok" görür, ikisi de yazar.
--
--   2. ONAYIN GERİ ALINMASI. Bir puanlama/keşif/başvuru turu onaylı bir
--      programı DISCOVERED'a geri çekerse, o programa yeniden başvurulur
--      ve gerçek gelir bağı kopar. SAVUNMA: geçiş kapısı trigger'ı.
--      İZİN LİSTESİ, yasak listesi değil -- yeni bir durum eklendiğinde
--      varsayılan REDDET olsun diye.
--
--   3. DENETİM İZİNİN KAYBOLMASI. Başvuru bir dış tarafa yapılan,
--      geri alınamaz bir eylemdir. "Ne zaman, hangi anahtarla, ne sonuç
--      aldık" sorusunun cevabı, programın kendisi silinse bile durmalı.
--      SAVUNMA: `program_id` NULL'lanabilir (`on delete set null`) ve ağ
--      kimliği satırda KOPYA olarak duruyor.
--
-- ---------------------------------------------------------------------------
-- SIR SAKLANMAZ
-- ---------------------------------------------------------------------------
-- Bu tablo bir başvurunun sonucunu tutar; kimlik bilgisini DEĞİL. API
-- anahtarı, token ve `Authorization` başlığı buraya hiç gelmemeli. Sadece
-- "gelmemeli" demek yetmez -- aşağıda bunu REDDEDEN bir kısıt var. Kısıt
-- kalıp tabanlı ve dolayısıyla eksiksiz değil; asıl savunma kodun sırrı
-- hiç taşımaması (`ProviderContext.secret` ortam değişkeni ADI ile çalışır).
-- Bu, o savunma delinirse diye konmuş SON kapı.
-- ===========================================================================

-- --- bir denemenin sonucu ---------------------------------------------------
--
-- `FAILED` ile `UNAVAILABLE` ayrı: birincisi denedik ve olmadı, ikincisi
-- deneyemedik. Aynı değere indirmek, hiç yapılmamış bir isteği başarısız
-- bir istek gibi göstermek olurdu.
create type public.application_attempt_result as enum (
  'SUBMITTED',        -- ağa gönderildi, sonuç bekleniyor
  'APPROVED',         -- ağ onayladı
  'REJECTED',         -- ağ reddetti
  'PENDING',          -- ağ "değerlendiriliyor" dedi
  'MANUAL_REQUIRED',  -- otomatik yapılamaz; operatöre iş düşer
  'UNAVAILABLE',      -- ağın sözleşmesi doğrulanmadı; İSTEK GÖNDERİLMEDİ
  'NOT_IMPLEMENTED',  -- beyan var, kod yok; İSTEK GÖNDERİLMEDİ
  'DUPLICATE',        -- aynı anahtarla zaten bir deneme var; GÖNDERİLMEDİ
  'FAILED'            -- denendi, hata alındı
);

comment on type public.application_attempt_result is
  'Bir basvuru denemesinin sonucu. UNAVAILABLE/NOT_IMPLEMENTED/DUPLICATE '
  'ISTEK GONDERILMEDIGINI soyler; FAILED gonderildi ve olmadi demektir.';

create table public.program_application_attempts (
  id                  uuid primary key default gen_random_uuid(),

  /*
   * Program silinse bile denetim izi kalır. `on delete cascade` olsaydı,
   * bir programı temizlemek ona yapılmış gerçek başvuruların kaydını da
   * silerdi -- denetlenemeyen bir dış eylem geriye kalırdı.
   */
  program_id          uuid references public.programs (id) on delete set null,

  -- Ağ kimliği KOPYA olarak duruyor: program satırı gittiğinde bile
  -- "kime başvurmuştuk" sorusu cevaplanabilsin.
  network             text not null,
  network_program_id  text not null,

  /*
   * İDEMPOTENCY ANAHTARI — bu tablonun kalbi.
   *
   * Tekil kısıt, iki eşzamanlı turun ya da bir yeniden denemenin ikinci
   * bir başvuru ÜRETMESİNİ veritabanı seviyesinde imkânsız kılıyor.
   * Yarışı kaybeden taraf 23505 alır ve bunu "zaten yapılmış" olarak
   * yorumlar; ağa ikinci bir istek GİTMEZ.
   */
  idempotency_key     text not null,

  /** Turu izlemek için; idempotency anahtarı DEĞİL. */
  correlation_id      text,

  result              public.application_attempt_result not null,

  /** Denemeden sonra programın aldığı durum. Durum değişmediyse NULL. */
  outcome_state       public.program_application_state,

  /**
   * Hata SINIFI, hata METNİ değil. Sınıf sayılabilir ve üzerine alarm
   * kurulabilir; serbest metin kurulamaz.
   */
  error_category      text,
  /** İnsanın okuyacağı açıklama. Sır taşıyamaz -- aşağıdaki kısıta bakınız. */
  message             text,

  attempted_at        timestamptz not null default now(),
  completed_at        timestamptz,

  constraint program_application_attempts_key_unique unique (idempotency_key),

  constraint program_application_attempts_network_known
    check (network = any (array['direct'::text, 'awin'::text])),

  constraint program_application_attempts_key_not_blank
    check (length(btrim(idempotency_key)) > 0),

  constraint program_application_attempts_program_id_not_blank
    check (length(btrim(network_program_id)) > 0),

  -- Hata sınıfı serbest metin değil: alarm kurulabilir bir küme.
  constraint program_application_attempts_error_category_known
    check (
      error_category is null
      or error_category = any (array[
        'MANUAL_REQUIRED', 'CAPABILITY_UNAVAILABLE', 'CAPABILITY_NOT_IMPLEMENTED',
        'UNKNOWN_NETWORK', 'TIMEOUT', 'RATE_LIMITED', 'NETWORK_ERROR',
        'HTTP_ERROR', 'MALFORMED_RESPONSE', 'DUPLICATE', 'DATABASE_ERROR',
        'SECURITY_ERROR', 'UNKNOWN_ERROR'
      ])
    ),

  /*
   * SON KAPI: kimlik bilgisi görünümlü metin reddedilir.
   *
   * Asıl savunma kodun sırrı hiç taşımaması. Bu kısıt, o savunma bir gün
   * delinirse diye var ve kalıp tabanlı olduğu için EKSİKSİZ DEĞİL --
   * eksiksiz olduğu sanılmamalı. Yakaladığı şey, gerçekte olan kaza:
   * bir hata mesajının içine tüm istek başlıklarının ya da imzalı bir
   * adresin kopyalanması.
   */
  constraint program_application_attempts_message_no_secret
    check (
      message is null
      or (
        message !~* '(authorization|x-api-key)[[:space:]]*[:=]'
        and message !~* 'bearer[[:space:]]+[a-z0-9._-]{8,}'
        and message !~* '(api[_-]?key|access[_-]?token|secret|password)[[:space:]]*=[[:space:]]*[^[:space:]]{4,}'
      )
    ),

  constraint program_application_attempts_completed_after_attempt
    check (completed_at is null or completed_at >= attempted_at)
);

comment on table public.program_application_attempts is
  'Her basvuru denemesinin denetim izi. idempotency_key TEKIL: iki es '
  'zamanli tur ya da bir yeniden deneme ikinci bir basvuru URETEMEZ.';

comment on column public.program_application_attempts.idempotency_key is
  'Basvuru NIYETININ kimligi. Ayni niyet ayni anahtari uretir; tekil kisit '
  'ikinci istegi veritabani seviyesinde engeller.';

comment on column public.program_application_attempts.program_id is
  'Program silinirse NULL olur; denetim izi kalir. Silinmesi, yapilmis bir '
  'dis eylemin kaydini yok etmek olurdu.';

create index program_application_attempts_program_idx
  on public.program_application_attempts (program_id, attempted_at desc)
  where program_id is not null;

create index program_application_attempts_network_idx
  on public.program_application_attempts (network, result, attempted_at desc);

-- ---------------------------------------------------------------------------
-- merchant_id ONBOARDING'DEN ÖNCE DOLDURULAMAZ
-- ---------------------------------------------------------------------------
-- `merchants` bizim operasyonel kaydımız ve her satırının bir KANITI var.
-- Keşfedilmiş ya da başvurusu beklemedeki bir programa merchant açmak, o
-- kanıt kuralını sessizce delerdi: tablo, hiç onaylanmamış yüzlerce
-- programın mağaza kaydıyla dolardı ve `merchants_active_needs_verified_terms`
-- gibi kapıların anlamı kalmazdı.
--
-- REJECTED'a izin veriliyor çünkü ağ ONAYI GERİ ALDIĞINDA geçmiş bağın
-- silinmesi gerekmiyor -- olan biten kayıtta kalmalı.
alter table public.programs
  add constraint programs_merchant_only_after_approval
    check (
      merchant_id is null
      or application_state in ('APPROVED'::public.program_application_state,
                               'REJECTED'::public.program_application_state)
    );

comment on constraint programs_merchant_only_after_approval on public.programs is
  'merchant_id yalnizca ONAY sonrasi dolar. Oncesinde dolsaydi kanitsiz '
  'magaza kaydi uretilirdi.';

-- ---------------------------------------------------------------------------
-- DURUM GEÇİŞ KAPISI
-- ---------------------------------------------------------------------------
-- İZİN LİSTESİ, yasak listesi DEĞİL. Yasak listesi olsaydı, enum'a
-- eklenecek her yeni durum varsayılan olarak SERBEST olurdu ve kapı
-- sessizce genişlerdi. Burada varsayılan REDDET.
--
-- EN ÖNEMLİ SATIR: APPROVED yalnızca REJECTED'a gidebilir.
--
-- Onay, dışarıda gerçekleşmiş bir olaydır: ağ bizi kabul etti, bir
-- merchant bağı kuruldu, deeplink ve dönüşüm hattı ona bakıyor. Otomatik
-- bir tur onu DISCOVERED'a ya da PENDING'e geri çekebilseydi, o programa
-- yeniden başvurulur ve çalışan gelir hattı sessizce kopardı. Onayı geri
-- alabilecek tek şey, ağın kendisinin geri almasıdır: REJECTED.
create or replace function public.tg_programs_guard_application_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_izinli public.program_application_state[];
begin
  -- Durum değişmiyorsa kapı hiç çalışmaz: puanlama, keşif ve onboarding
  -- güncellemeleri bu satırdan geçmemeli.
  if old.application_state is not distinct from new.application_state then
    return new;
  end if;

  v_izinli := case old.application_state
    when 'DISCOVERED' then array[
      'ELIGIBLE','APPLICATION_READY','APPLIED','PENDING','APPROVED','REJECTED',
      'MANUAL_REQUIRED','UNAVAILABLE','NOT_IMPLEMENTED']
    when 'ELIGIBLE' then array[
      'APPLICATION_READY','APPLIED','PENDING','APPROVED','REJECTED',
      'MANUAL_REQUIRED','UNAVAILABLE','NOT_IMPLEMENTED']
    when 'APPLICATION_READY' then array[
      'APPLIED','PENDING','APPROVED','REJECTED',
      'MANUAL_REQUIRED','UNAVAILABLE','NOT_IMPLEMENTED']
    -- Başvuru gönderildi: geriye "hiç görülmemiş"e dönüş YOK.
    when 'APPLIED' then array['PENDING','APPROVED','REJECTED','MANUAL_REQUIRED']
    when 'PENDING' then array['APPROVED','REJECTED','MANUAL_REQUIRED']
    -- ONAY TEK YÖNLÜ. Gerekçesi yukarıda.
    when 'APPROVED' then array['REJECTED']
    -- Ret kalıcı değil: şartlar değişince yeniden başvurulabilir.
    when 'REJECTED' then array[
      'ELIGIBLE','APPLICATION_READY','APPLIED','PENDING',
      'MANUAL_REQUIRED','UNAVAILABLE','NOT_IMPLEMENTED']
    -- Operatör elle başvurdu ve sonucu girdi.
    when 'MANUAL_REQUIRED' then array[
      'ELIGIBLE','APPLICATION_READY','APPLIED','PENDING','APPROVED','REJECTED',
      'UNAVAILABLE','NOT_IMPLEMENTED']
    -- Sözleşme sonradan doğrulanabilir: bu iki durum ÇIKMAZ SOKAK DEĞİL.
    when 'UNAVAILABLE' then array[
      'DISCOVERED','ELIGIBLE','APPLICATION_READY','APPLIED','PENDING',
      'APPROVED','REJECTED','MANUAL_REQUIRED','NOT_IMPLEMENTED']
    when 'NOT_IMPLEMENTED' then array[
      'DISCOVERED','ELIGIBLE','APPLICATION_READY','APPLIED','PENDING',
      'APPROVED','REJECTED','MANUAL_REQUIRED','UNAVAILABLE']
    else array[]::text[]
  end::public.program_application_state[];

  if not (new.application_state = any (v_izinli)) then
    raise exception
      'Gecersiz basvuru durumu gecisi: % -> %. Izin verilenler: %.',
      old.application_state, new.application_state,
      coalesce(array_to_string(v_izinli, ', '), 'yok')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.tg_programs_guard_application_state is
  'Basvuru durum gecis kapisi. IZIN LISTESI: yeni bir durum eklendiginde '
  'varsayilan REDDET. APPROVED yalnizca REJECTED a gidebilir.';

create trigger programs_guard_application_state
  before update of application_state on public.programs
  for each row execute function public.tg_programs_guard_application_state();

-- --- Erişim ----------------------------------------------------------------
-- Denetim izi iş istihbaratıdır: hangi ağa ne zaman başvurduğumuz, hangi
-- hatayı aldığımız. `programs` gibi tamamen sunucu tarafı.
alter table public.program_application_attempts enable row level security;
revoke all on public.program_application_attempts from anon, authenticated;
grant select, insert, update on public.program_application_attempts to service_role;

-- Denetim izi SİLİNEMEZ: delete yetkisi hiçbir role verilmiyor. Silinebilen
-- bir denetim izi denetim izi değildir.
revoke delete on public.program_application_attempts from service_role;

revoke all on function public.tg_programs_guard_application_state() from public;
revoke all on function public.tg_programs_guard_application_state() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
       values ('awin', 'GOC-BASVURU', 'Goc Basvuru', now())
    returning id into v_id;

  -- 1) ONAY GERİ ALINAMIYOR — bu göçün varlık sebebi.
  update public.programs set application_state = 'APPROVED' where id = v_id;

  begin
    update public.programs set application_state = 'DISCOVERED' where id = v_id;
    raise exception 'DOGRULAMA 1: APPROVED -> DISCOVERED kabul edildi; calisan gelir hatti kopardi.';
  exception when check_violation then null;
  end;

  begin
    update public.programs set application_state = 'PENDING' where id = v_id;
    raise exception 'DOGRULAMA 2: APPROVED -> PENDING kabul edildi; onayli programa yeniden basvurulurdu.';
  exception when check_violation then null;
  end;

  -- 3) Ağın onayı geri alması MÜMKÜN olmalı: kapı fazla kapatmamış.
  update public.programs set application_state = 'REJECTED' where id = v_id;

  -- 4) İDEMPOTENCY: aynı anahtarla ikinci deneme kaydedilemiyor.
  insert into public.program_application_attempts
    (program_id, network, network_program_id, idempotency_key, result)
  values (v_id, 'awin', 'GOC-BASVURU', 'goc:dogrulama:1', 'UNAVAILABLE');

  begin
    insert into public.program_application_attempts
      (program_id, network, network_program_id, idempotency_key, result)
    values (v_id, 'awin', 'GOC-BASVURU', 'goc:dogrulama:1', 'UNAVAILABLE');
    raise exception 'DOGRULAMA 4: ayni idempotency anahtari iki kez kabul edildi; aga iki basvuru giderdi.';
  exception when unique_violation then null;
  end;

  -- 5) SIR GÖRÜNÜMLÜ METİN REDDEDİLİYOR.
  begin
    update public.program_application_attempts
       set message = 'istek basarisiz: Authorization: Bearer abcdef0123456789'
     where idempotency_key = 'goc:dogrulama:1';
    raise exception 'DOGRULAMA 5: kimlik bilgisi gorunumlu metin denetim izine yazildi.';
  exception when check_violation then null;
  end;

  -- 6) Sıradan bir hata mesajı YAZILABİLİYOR: kapatma fazla kapatmamış.
  update public.program_application_attempts
     set message = 'Awin basvuru sozlesmesi dogrulanmadi; istek gonderilmedi.'
   where idempotency_key = 'goc:dogrulama:1';

  -- 7) Geriye "hic gorulmemis"e donus yok.
  begin
    update public.programs
       set application_state = 'DISCOVERED'
     where id = v_id;
    raise exception 'DOGRULAMA 7: REJECTED -> DISCOVERED kabul edildi; gecmis silinirdi.';
  exception when check_violation then null;
  end;

  -- 8) merchant_id ONAY ONCESI doldurulamiyor.
  declare
    v_magaza uuid;
    v_yeni   uuid;
  begin
    select id into v_magaza from public.merchants order by slug limit 1;

    if v_magaza is not null then
      insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
           values ('awin', 'GOC-BASVURU-2', 'Goc Basvuru 2', now())
        returning id into v_yeni;

      begin
        update public.programs set merchant_id = v_magaza where id = v_yeni;
        raise exception
          'DOGRULAMA 8: DISCOVERED programa merchant baglandi; kanitsiz magaza kaydi uretilirdi.';
      exception when check_violation then null;
      end;

      -- Onaydan SONRA baglanabiliyor: kapatma fazla kapatmamis.
      update public.programs set application_state = 'APPROVED' where id = v_yeni;
      update public.programs set merchant_id = v_magaza where id = v_yeni;

      delete from public.programs where id = v_yeni;
    end if;
  end;

  -- Temizlik: denetim izi silinemez, bu yüzden program bağı koparılıp
  -- program siliniyor. İz `program_id is null` ile kalır -- tasarım gereği.
  delete from public.programs where id = v_id;

  if not exists (
    select 1 from public.program_application_attempts
     where idempotency_key = 'goc:dogrulama:1' and program_id is null
  ) then
    raise exception 'DOGRULAMA 9: program silinince denetim izi de kayboldu.';
  end if;

  delete from public.program_application_attempts where idempotency_key = 'goc:dogrulama:1';

  raise notice
    'Basvuru motoru kuruldu: onay geri alinamiyor, idempotency anahtari tekil, '
    'sir gorunumlu metin reddediliyor, denetim izi program silinse de kaliyor.';
end $$;
