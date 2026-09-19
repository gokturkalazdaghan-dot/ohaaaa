-- ============================================================================
-- SATICI KARARI DENETİM İZİ — hem YAZDIĞINI hem KORUDUĞUNU kanıtla
-- ----------------------------------------------------------------------------
-- Güvenlik denetiminden (2026-09-19) çıkan bulgu: `vendors` kararın NE ZAMAN
-- verildiğini tutuyordu ama KİM verdiğini tutmuyordu.
--
-- Bir denetim izi iki şekilde işe yaramaz hâle gelir ve ikisi de sessizdir:
--   • hiç yazılmaz          -> kimse fark etmez, sorulduğunda cevap yoktur
--   • yanlışlıkla silinir   -> sıradan bir profil güncellemesi geçmişi siler
--
-- Bu yüzden üç iddia:
--   1) durum değişince iz YAZILMALI
--   2) durum değişmeyen bir güncellemede iz DOKUNULMAMALI
--   3) çağıranın gönderdiği damga YOK SAYILMALI (iz uydurulamaz)
--
-- (2) olmasaydı "her güncellemede damga bas" da testi geçerdi ve ilk kararın
-- kimliği ilk profil düzenlemesinde kaybolurdu.
--
-- (3) ilk hâlinde "ikinci karar zamanı ilerletmeli" idi ve DÜŞTÜ -- ama
-- tetikleyici yüzünden değil: `now()` işlem başlangıç zamanını döndürür ve
-- tek bir işlem içinde ilerlemez. Yani o iddia tetikleyiciyi değil `now()`u
-- sınıyordu. Yerine konan iddia daha güçlü: çağıran `decided_at` göndererek
-- izi UYDURAMAMALI. Bir denetim izinin asıl değeri, yazılabilir olmasında
-- değil, yazanın seçemediği bir değer olmasındadır.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

do $$
declare
  v_owner   uuid;
  v_vendor  uuid;
  v_by      uuid;
  v_at      timestamptz;
  v_at_2    timestamptz;
begin
  -- Test verisi. Seed'den bağımsız.
  --
  -- `public.users.id` -> `auth.users(id)` yabancı anahtarı var, yani kimlik
  -- ÖNCE kimlik doğrulama şemasında açılmalı. Bu kısıt doğru: uygulama
  -- tablosunda, oturum açamayacak bir kullanıcı satırı olmamalı.
  v_owner := gen_random_uuid();

  -- `public.users` satirini ACMIYORUZ: `auth.users`'a ekleme onu tetikleyici
  -- ile kendiliginden aciyor (Supabase'in standart kalibi). Elle ikinci kez
  -- eklemek mukerrer anahtar hatasi verir.
  insert into auth.users (id, email)
  values (v_owner, 'karar-izi-testi@example.invalid');

  insert into public.vendors (owner_id, slug, display_name, status)
  values (v_owner, 'karar-izi-testi', 'Karar Izi Testi', 'pending')
  returning id into v_vendor;

  -- --------------------------------------------------------------------
  -- 1) DURUM DEĞİŞİNCE İZ YAZILMALI
  -- --------------------------------------------------------------------
  -- `auth.uid()` bu bağlamda null (oturum yok) -- yani servis rolüyle
  -- yapılan değişiklik. `decided_at` yine de dolmalı: "bir süreç değiştirdi,
  -- atfedilebilecek insan yok" doğru bir kayıttır.
  update public.vendors set status = 'approved' where id = v_vendor;

  select decided_by, decided_at into v_by, v_at
    from public.vendors where id = v_vendor;

  if v_at is null then
    raise exception
      'IZ YAZILMADI: durum pending -> approved oldu ama decided_at bos. '
      'Tetikleyici calismiyor -- karar sorulamaz hale gelir.';
  end if;

  -- --------------------------------------------------------------------
  -- 2) DURUM DEĞİŞMEYEN GÜNCELLEMEDE İZ DOKUNULMAMALI
  -- --------------------------------------------------------------------
  -- Bu iddia olmasaydi "her guncellemede damga bas" da gecerdi ve ilk
  -- kararin zamani, ilk profil duzenlemesinde silinirdi.
  -- Cagiran ayni anda sahte bir damga da gonderiyor: durum degismedigi icin
  -- ESKI deger korunmali, gonderilen deger YOK SAYILMALI.
  update public.vendors
     set display_name = 'Karar Izi Testi (duzenlendi)',
         decided_at   = timestamptz '2000-01-01 00:00:00+00'
   where id = v_vendor;

  select decided_at into v_at_2 from public.vendors where id = v_vendor;

  if v_at_2 is distinct from v_at then
    raise exception
      'IZ SIRADAN GUNCELLEMEDE DEGISTI: profil duzenlemesi karar damgasini '
      'ezdi. Gecmisteki kararin kimligi kaybolur.';
  end if;

  -- --------------------------------------------------------------------
  -- 3) ÇAĞIRANIN GÖNDERDİĞİ DAMGA YOK SAYILMALI
  -- --------------------------------------------------------------------
  -- Bir denetim izinin degeri, yazanin SECEMEDIGI bir deger olmasindadir.
  -- Cagiran `decided_at`'i kendi belirleyebilseydi, iz istedigi tarihi
  -- gosterirdi ve hicbir sey kanitlamazdi.
  update public.vendors
     set status = 'suspended',
         decided_at = timestamptz '2000-01-01 00:00:00+00'
   where id = v_vendor;

  select decided_at into v_at_2 from public.vendors where id = v_vendor;

  if v_at_2 = timestamptz '2000-01-01 00:00:00+00' then
    raise exception
      'IZ UYDURULABILIYOR: cagiranin gonderdigi decided_at kaydedildi. '
      'Tetikleyici degeri ezmeliydi -- aksi halde denetim izi, izi yazanin '
      'istedigi seyi gosteren bir alan olur.';
  end if;

  if v_at_2 is null then
    raise exception 'IKINCI KARARDA IZ SILINDI: decided_at bos kaldi.';
  end if;

  raise notice 'Satici karari denetim izi: 3/3 iddia gecti.';
end $$;

rollback;
