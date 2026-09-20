-- ===========================================================================
-- YÖNLENDİRME BÜYÜK/KÜÇÜK HARFE DUYARLIYDI — `search_path = ''` TUZAĞI
-- ===========================================================================
--
-- ÖLÇÜLEN ARIZA
--   kategori_yonlendirme('ios-telefonlar')  -> android-telefonlar  ✓
--   kategori_yonlendirme('IOS-Telefonlar')  -> (bos)               ✗
--
-- Oysa AYNI karşılaştırma fonksiyonun dışında büyük/küçük harften bağımsız
-- çalışıyor:
--   select count(*) from categories where slug = 'IOS-TELEFONLAR'::citext  -> 1
--
-- SEBEP
-- Fonksiyon `set search_path = ''` ile yazılmış (SECURITY DEFINER için
-- doğru karar). Ama `citext` eklentisi `public` şemasında kurulu, dolayısıyla
-- citext'in `=` operatörü arama yolunda DEĞİL. PostgreSQL hata vermek yerine
-- citext'in text'e ÖRTÜK CAST'ini kullanıp `pg_catalog.=` (text) operatörüne
-- düşüyor -- ve o operatör büyük/küçük harfe DUYARLI.
--
-- Yani `citext` sütunu, citext gibi davranmayı bırakıyor. Hata vermiyor,
-- yanlış cevap veriyor: sessiz bozulmanın ders kitabı örneği.
--
-- ETKİSİ
-- `/kategori/IOS-Telefonlar` gibi harf farkı taşıyan bir eski adres 301
-- yerine 404 alırdı. Dış bağlantılar, eski site haritaları ve elle yazılmış
-- adresler harf farkı taşır; bunlar tam da yönlendirmenin korumak için var
-- olduğu trafiktir.
--
-- ÇÖZÜM
-- Operatör çözümüne hiç güvenmiyoruz: karşılaştırma açıkça `lower()` ile
-- yapılıyor. Slug'lar ASCII (üretimi `slugify` aksanları zaten ayıklıyor),
-- dolayısıyla Türkçe 'İ' tuzağı burada geçerli değil -- ve `lower()`
-- `pg_catalog` içinde, yani boş arama yolunda da bulunur.
--
-- Aynı tuzak `kategori_kapsami` için geçerli DEĞİL: orada yalnızca uuid
-- karşılaştırması var, citext yok. Kontrol edildi.
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
     -- `c.slug = p_slug::citext` DEGIL: bos arama yolunda citext operatoru
     -- bulunamaz ve karsilastirma sessizce harf DUYARLI text '=' e duser.
     where lower(c.slug::text) = lower(btrim(coalesce(p_slug, '')))
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
  'DEFINER (birlestirilen satir pasiftir ve RLS onu anon dan gizler) ve '
  'karsilastirma ACIKCA lower() ile: bos arama yolunda citext operatoru '
  'bulunamaz, karsilastirma harf DUYARLI text = ye duser ve harf farki '
  'tasiyan eski adresler 301 yerine 404 alirdi.';

revoke all on function public.kategori_yonlendirme(text) from public;
grant execute on function public.kategori_yonlendirme(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_kaynak text;
  v_kucuk  text;
  v_buyuk  text;
  v_karisik text;
  v_anon   text;
begin
  select c.slug::text into v_kaynak
    from public.categories c where c.merged_into_id is not null limit 1;

  if v_kaynak is null then
    raise notice '- dogrulama atlandi: birlestirilmis kategori yok';
    return;
  end if;

  select y.hedef_slug into v_kucuk  from public.kategori_yonlendirme(lower(v_kaynak)) y;
  select y.hedef_slug into v_buyuk  from public.kategori_yonlendirme(upper(v_kaynak)) y;
  select y.hedef_slug into v_karisik from public.kategori_yonlendirme(initcap(v_kaynak)) y;

  if v_kucuk is null then
    raise exception 'DOGRULAMA 1: kucuk harfli slug cozulmuyor (%).', v_kaynak;
  end if;
  if v_buyuk is distinct from v_kucuk or v_karisik is distinct from v_kucuk then
    raise exception
      'DOGRULAMA 2: yonlendirme harf duyarli (kucuk "%", buyuk "%", karisik "%"). '
      'Harf farki tasiyan eski adresler 301 yerine 404 alirdi.',
      v_kucuk, coalesce(v_buyuk, 'NULL'), coalesce(v_karisik, 'NULL');
  end if;

  -- Bosluklu girdi de cozulmeli: elle yazilmis adresler bosluk tasiyabilir.
  select y.hedef_slug into v_anon from public.kategori_yonlendirme('  ' || v_kaynak || ' ') y;
  if v_anon is distinct from v_kucuk then
    raise exception 'DOGRULAMA 3: bosluklu girdi cozulmedi.';
  end if;

  -- Ve hala VITRININ rolunden gorunuyor.
  set local role anon;
  select y.hedef_slug into v_anon from public.kategori_yonlendirme(upper(v_kaynak)) y;
  reset role;

  if v_anon is distinct from v_kucuk then
    raise exception
      'DOGRULAMA 4: anon harf farkli slug u cozemiyor ("%").', coalesce(v_anon, 'NULL');
  end if;

  raise notice
    'Yonlendirme harf duyarsiz ve anon dan gorunuyor: % (kucuk/buyuk/karisik) -> %',
    v_kaynak, v_kucuk;
end $$;
