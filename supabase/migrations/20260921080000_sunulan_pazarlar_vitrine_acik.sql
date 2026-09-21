-- ===========================================================================
-- SUNULAN PAZARLAR VİTRİNE GÖRÜNMÜYORDU — RLS
-- ===========================================================================
--
-- ÖLÇÜLEN ARIZA (üretimde, canlıda)
-- `hreflang` 8 girdiden 39'a ÇIKTI. Beklenen 3 idi.
--
-- Vitrin "hangi pazarları sunuyoruz" sorusunu `sources` tablosundan
-- okumaya çalışıyordu. `anon` o tabloyu okuyamaz:
--
--   set local role anon;
--   select count(*) from sources;  ->  42501 permission denied
--
-- `sources` üzerinde tek politika var: `sources_admin_all using (is_admin())`.
-- Ve haklı olarak -- tabloda `endpoint_url`, `auth_secret_ref`, zamanlama ve
-- sağlık alanları duruyor; hiçbiri vitrinin işi değil.
--
-- Sonuç: küme her zaman BOŞ döndü, "ürünü olmayan pazarı eleme" kuralı hiç
-- çalışmadı, ve onunla birlikte gelen "çevirisi olmayan pazarı İngilizce
-- sun" yedeği 41 pazarın HEPSİNE uygulandı. İki doğru kural, biri sessizce
-- devre dışı kalınca birlikte yanlış sonuç üretti.
--
-- ---------------------------------------------------------------------------
-- NEDEN TABLOYU AÇMIYORUZ
-- ---------------------------------------------------------------------------
-- Politikayı gevşetmek `endpoint_url` ve `auth_secret_ref`i de açardı.
-- Vitrinin ihtiyacı olan bilgi bunun çok altında: yalnızca PAZAR KODLARI.
-- Kapsamı tek bir fonksiyonla açmak, tablonun tamamını açmaktan dar bir
-- karardır (aynı gerekçe `kategori_yonlendirme` için de yazılmıştı).
--
-- Dönen bilgi zaten DIŞARIYA AÇIK olması GEREKEN bilgi: hangi pazarların
-- sayfası var. `hreflang` çıktısının kendisi bunu ilan ediyor.
-- ===========================================================================

create or replace function public.sunulan_pazarlar()
returns table (market_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct s.market_code
    from public.sources s
   where s.is_enabled
     and s.market_code is not null
   order by 1;
$$;

comment on function public.sunulan_pazarlar is
  'Urun tasidigimiz pazarlarin kodlari. SECURITY DEFINER: sources '
  'tablosunda endpoint_url ve auth_secret_ref duruyor ve anon onu hic '
  'okuyamaz; vitrinin ihtiyaci olan yalnizca pazar kodlari. Tablonun '
  'tamamini acmak yerine kapsam tek fonksiyonla acildi.';

revoke all on function public.sunulan_pazarlar() from public;
grant execute on function public.sunulan_pazarlar() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR — VİTRİNİN ROLÜYLE
-- ---------------------------------------------------------------------------
-- Süper kullanıcı olarak sormak bu arızayı GÖREMEZ; asıl soru "anon ne
-- görüyor". Doğrulama bu yüzden rol değiştirerek soruyor.
do $$
declare
  v_super int;
  v_anon  int;
begin
  select count(*) into v_super from public.sunulan_pazarlar();

  set local role anon;
  select count(*) into v_anon from public.sunulan_pazarlar();
  reset role;

  if v_anon is distinct from v_super then
    raise exception
      'DOGRULAMA 1: anon sunulan pazarlari goremiyor (super kullanici %, '
      'anon %). Vitrin elemeyi yapamaz ve butun pazarlari ilan eder.',
      v_super, coalesce(v_anon::text, 'NULL');
  end if;

  /*
   * "HIC KAYNAK YOK" BIR HATA DEGIL.
   *
   * Ilk hali bunu `raise exception` ile reddediyordu ve goc TEMIZ bir
   * veritabaninda DUSTU (CI, 20260921: "DOGRULAMA 2: hic etkin kaynak
   * yok"). Cunku CI uretim verisini tasimaz -- semayi sifirdan oynatir ve
   * o anda `sources` bos olur.
   *
   * Dogrulama CEVRESE BAGLI OLMAMALI. Bu gocun soyledigi sey "anon bu
   * fonksiyonu gorebiliyor mu"; kac satir dondugu cevrenin verisine
   * bagli ve iddia konusu degil. Bos kume dogru cevaptir: hicbir kaynak
   * yoksa hicbir pazar sunulmuyordur.
   *
   * Uretimde deger sifirdan buyuk oldugu ayrica olculdu (PL, UK).
   */
  if v_super = 0 then
    raise notice
      '- bu veritabaninda etkin kaynak yok; fonksiyon bos kume donduruyor '
      '(temiz kurulumda beklenen).';
  else
    raise notice 'Sunulan pazarlar anon dan da gorunuyor: % pazar', v_anon;
  end if;
end $$;
