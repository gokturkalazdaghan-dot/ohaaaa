-- ===========================================================================
-- YÖNLENDİRME ÇÖZÜCÜSÜ VİTRİN İÇİN GÖRÜNMEZDİ — RLS
-- ===========================================================================
--
-- ÖLÇÜLEN ARIZA (üretimde, canlıda)
-- Birleştirilen kategorilerin eski adresleri 301 yerine 404 döndü:
--
--   /kategori/ios-telefonlar             404
--   /kategori/projektor                  404
--   /kategori/elektrikli-mutfak-aletleri 404
--   ... (altı adres)
--
-- Veritabanı doğruydu: `postgres` olarak `kategori_yonlendirme('ios-telefonlar')`
-- düzgünce `android-telefonlar` döndürüyordu. PostgREST de fonksiyonu
-- tanıyordu (HTTP 200). Ama `anon` çağırdığında BOŞ dönüyordu.
--
-- SEBEP
-- `categories` üzerindeki RLS politikası:
--
--   categories_public_read   using (is_active)
--
-- Birleştirilen kategori TANIMI GEREĞİ pasiftir (`merged_into_id` dolu olan
-- satır `is_active = false` olmak ZORUNDA -- kısıt bunu istiyor). Fonksiyon
-- `SECURITY INVOKER` olduğu için `anon` haklarıyla koşuyor, başlangıç satırını
-- hiç göremiyor ve özyineleme boş kümeden başlıyor.
--
-- Yani yönlendirme, tam da yönlendirmesi gereken satırı göremiyordu.
--
-- ---------------------------------------------------------------------------
-- NEDEN TESTLER YAKALAMADI
-- ---------------------------------------------------------------------------
-- `106_kanonik_uc_seviye_test.sql` iddiayı süper kullanıcı olarak kuruyordu ve
-- süper kullanıcı RLS'i ATLAR. Fonksiyon doğru cevabı veriyordu; vitrinin
-- gördüğü cevabı hiç kimse sormamıştı. Bu göçle birlikte test `anon` rolüne
-- geçerek soruyor -- arıza bir daha üretimde değil, derlemede çıkar.
--
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER NEDEN GÜVENLİ
-- ---------------------------------------------------------------------------
-- Fonksiyon yalnızca bir SLUG EŞLEMESİ döndürüyor: "bu eski adres şu kanonik
-- adrese gider". Bu zaten dışarıya açık olması GEREKEN bilgi -- 301 cevabının
-- kendisi. Ürün, fiyat, satıcı ya da kişisel veri taşımıyor.
--
-- `set search_path = ''` korunuyor: SECURITY DEFINER bir fonksiyonda arama
-- yolunu açık bırakmak, çağıranın kendi şemasını araya sokmasına izin verirdi.
-- Bütün referanslar `public.` ile nitelenmiş durumda.
--
-- Alternatif olan "RLS politikasını gevşetmek" DAHA KÖTÜ olurdu: bütün pasif
-- kategoriler (gıda/içecek dahil, bilerek kapsam dışı bırakılanlar) vitrine
-- görünür hâle gelirdi. Kapsamı tek bir fonksiyonla açmak, tablonun tamamını
-- açmaktan dar bir karardır.
-- ===========================================================================

create or replace function public.kategori_yonlendirme(p_slug text)
returns table (hedef_slug text, hedef_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive zincir(id, slug, merged_into_id, derinlik) as (
    select c.id, c.slug::text, c.merged_into_id, 0
      from public.categories c
     where c.slug = p_slug::public.citext
       and c.merged_into_id is not null
    union all
    select c.id, c.slug::text, c.merged_into_id, z.derinlik + 1
      from zincir z
      join public.categories c on c.id = z.merged_into_id
     where z.derinlik < 8
  )
  select z.slug, z.id
    from zincir z
   where z.merged_into_id is null
   order by z.derinlik desc
   limit 1;
$$;

comment on function public.kategori_yonlendirme is
  'Birlestirilmis kategori slug u icin kanonik hedefi verir. SECURITY '
  'DEFINER: birlestirilen kategori TANIMI GEREGI pasiftir ve categories '
  'RLS politikasi (using is_active) onu anon dan gizler -- fonksiyon '
  'SECURITY INVOKER iken tam da yonlendirmesi gereken satiri goremiyordu '
  've vitrin 301 yerine 404 donuyordu. Yalnizca slug eslemesi dondurur.';

revoke all on function public.kategori_yonlendirme(text) from public;
grant execute on function public.kategori_yonlendirme(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR — VİTRİNİN ROLÜYLE
-- ---------------------------------------------------------------------------
-- Süper kullanıcı olarak sormak bu arızayı GÖREMEZ; asıl soru "anon ne
-- görüyor". Doğrulama bu yüzden rol değiştirerek soruyor.
do $$
declare
  v_kaynak text;
  v_hedef  text;
  v_anon   text;
begin
  select c.slug::text into v_kaynak
    from public.categories c
   where c.merged_into_id is not null
   limit 1;

  if v_kaynak is null then
    raise notice '- dogrulama atlandi: birlestirilmis kategori yok';
    return;
  end if;

  select y.hedef_slug into v_hedef from public.kategori_yonlendirme(v_kaynak) y;
  if v_hedef is null then
    raise exception
      'DOGRULAMA 1: yonlendirme super kullanici olarak bile cozulmuyor (%).', v_kaynak;
  end if;

  -- ASIL SORU: vitrinin rolu ne goruyor?
  set local role anon;
  select y.hedef_slug into v_anon from public.kategori_yonlendirme(v_kaynak) y;
  reset role;

  if v_anon is distinct from v_hedef then
    raise exception
      'DOGRULAMA 2: anon yonlendirmeyi goremiyor (super kullanici "%", anon "%"). '
      'Birlestirilen kategori pasif oldugu icin RLS onu gizliyor ve vitrin '
      '301 yerine 404 dondurur.', v_hedef, coalesce(v_anon, 'NULL');
  end if;

  raise notice
    'Yonlendirme artik vitrinin rolunden de gorunuyor: % -> %', v_kaynak, v_anon;
end $$;
