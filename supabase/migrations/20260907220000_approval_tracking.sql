-- ===========================================================================
-- ONAY TAKİBİ — ağdaki başvuru kimliği ve son yoklama anı
-- ===========================================================================
--
-- NE EKLENİYOR VE NEDEN
--
--   network_application_id  Ağın başvuruya verdiği kimlik. Bazı ağlar
--                           durumu program kimliğiyle değil BAŞVURU
--                           kimliğiyle sorar; o kimlik saklanmazsa
--                           yoklama yapılamaz ve başvuru gönderilmiş ama
--                           sonucu hiç öğrenilemeyen bir kayıt kalır.
--
--   approval_checked_at     Son yoklama anı. Yoklama sırasını buna göre
--                           kuruyoruz: en uzun süredir bakılmayan önce.
--                           Olmasaydı ya hepsi her turda yoklanır (ağ
--                           gereksiz yorulur, hız sınırına takılır) ya da
--                           bazıları hiç yoklanmazdı.
--
-- ---------------------------------------------------------------------------
-- ONAY ANI AYRI BİR ALAN DEĞİL
-- ---------------------------------------------------------------------------
-- "Ne zaman onaylandık" sorusunun cevabı `program_application_attempts`
-- içinde zaten var ve orası SİLİNEMEZ bir denetim izi. Aynı bilgiyi
-- `programs` üzerinde ikinci kez tutmak, iki kaynağın ayrışabileceği bir
-- yer açardı -- ve ayrıştıklarında hangisinin doğru olduğunu kimse
-- bilemezdi.
--
-- ---------------------------------------------------------------------------
-- BU GÖÇ merchant_id'YE DOKUNMAZ
-- ---------------------------------------------------------------------------
-- Onay takibi onboarding DEĞİLDİR. Ağın "onaylandı" demesi bir mağaza
-- kaydı açmak için yeterli değil: ana sayfa, ülke, komisyon, çerez
-- penceresi ve doğrulanmış şartlar da gerekiyor. O ölçümü
-- `evaluateOnboardingHandoff` yapıyor ve `merchant_id`yi yalnızca
-- `programs_merchant_only_after_approval` kısıtının izin verdiği yerde,
-- kanıt tamamlandığında bağlıyoruz.
-- ===========================================================================

alter table public.programs
  add column network_application_id text,
  add column approval_checked_at    timestamptz;

alter table public.programs
  -- Boş metin bir kimlik değildir ama bir DEĞER gibi davranır: yoklama
  -- onu ağa gönderir ve ağ anlamsız bir hata döndürür. NULL sızmaz.
  add constraint programs_network_application_id_not_blank
    check (network_application_id is null or length(btrim(network_application_id)) > 0);

comment on column public.programs.network_application_id is
  'Agin basvuruya verdigi kimlik. NULL = ag kimlik vermedi ya da henuz '
  'basvurulmadi. Bazi aglar durumu bu kimlikle sorar.';

comment on column public.programs.approval_checked_at is
  'Son yoklama ani. Yoklama sirasi buna gore kurulur: en uzun suredir '
  'bakilmayan once. NULL = hic yoklanmadi.';

-- Denetim izinde de saklanıyor: program satırı silinse bile "ağ bu
-- başvuruya hangi kimliği vermişti" cevaplanabilsin.
alter table public.program_application_attempts
  add column network_application_id text;

comment on column public.program_application_attempts.network_application_id is
  'Agin o denemede dondurdugu basvuru kimligi. Program silinse de kalir.';

-- ---------------------------------------------------------------------------
-- YOKLAMA SIRASI
-- ---------------------------------------------------------------------------
-- Kısmi indeks: yalnızca yoklanmaya değer durumlar. REJECTED ve DISCOVERED
-- programlarda ağda sorulacak bir başvuru yok ve onları indekse almak,
-- tabloların büyük kısmını gereksiz yere taşımak olurdu.
--
-- APPROVED de listede: ağ onayı GERİ ALABİLİR ve bunu öğrenmenin tek yolu
-- sormaktır. Geri alınmış bir onayla trafik göndermeye devam etmek,
-- komisyonu hiç alınmayacak tıklamalar üretir.
create index programs_approval_poll_idx
  on public.programs (approval_checked_at nulls first)
  where application_state in (
    'APPLIED'::public.program_application_state,
    'PENDING'::public.program_application_state,
    'APPROVED'::public.program_application_state,
    'MANUAL_REQUIRED'::public.program_application_state
  );

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  -- 1) İki sütun da eklendi ve ikisi de nullable.
  if (select count(*) from information_schema.columns
       where table_schema='public' and table_name='programs'
         and column_name in ('network_application_id','approval_checked_at')
         and is_nullable='YES') <> 2 then
    raise exception
      'DOGRULAMA 1: onay takip sutunlari nullable olarak eklenmedi -- hic '
      'yoklanmamis program bir deger uydurmak zorunda kalirdi.';
  end if;

  insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
       values ('awin', 'GOC-ONAY', 'Goc Onay', now())
    returning id into v_id;

  -- 2) Boş kimlik reddediliyor.
  begin
    update public.programs set network_application_id = '   ' where id = v_id;
    raise exception 'DOGRULAMA 2: bos basvuru kimligi kabul edildi -- aga anlamsiz istek giderdi.';
  exception when check_violation then null;
  end;

  -- 3) Gerçek kimlik ve yoklama anı yazılabiliyor.
  update public.programs
     set network_application_id = 'AG-BASVURU-1', approval_checked_at = now()
   where id = v_id;

  -- 4) YOKLAMA DURUMU DEĞİŞTİRMEZ: yalnız bu iki sütuna yazmak geçiş
  --    kapısını hiç çalıştırmamalı.
  if (select application_state from public.programs where id = v_id) <> 'DISCOVERED' then
    raise exception 'DOGRULAMA 4: yoklama sutunlarina yazmak basvuru durumunu degistirdi.';
  end if;

  -- 5) Onay takibi merchant bagi KURMAZ: kisit hala yerinde.
  if (select merchant_id is not null from public.programs where id = v_id) then
    raise exception 'DOGRULAMA 5: onay takibi merchant bagi kurdu.';
  end if;

  delete from public.programs where id = v_id;

  raise notice
    'Onay takip sutunlari eklendi: yoklama sirasi kismi indeksle kuruldu, '
    'bos basvuru kimligi reddediliyor, yoklama durumu degistirmiyor.';
end $$;
