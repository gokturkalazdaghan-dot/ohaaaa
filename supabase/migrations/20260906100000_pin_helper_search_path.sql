-- ============================================================================
-- YARDIMCI FONKSİYONLARDA search_path SABİTLENİYOR
-- ----------------------------------------------------------------------------
-- BULUNAN FARK
-- Üretim veritabanı ile bu deponun ürettiği şema BİREBİR AYNI DEĞİLDİ.
--
-- Üretime, deposunda karşılığı olmayan `pin_function_search_path` adlı bir
-- göç uygulanmış (üretim göç defterinde `20260830190427`) ve yedi fonksiyonun
-- `search_path`'ini sabitlemiş. O yediden biri (`search_products`) sonradan
-- `search_filters` göçüyle DÜŞÜRÜLÜP yeniden yaratıldı; yeni tanımı pini
-- kendi içinde taşıyor, dolayısıyla iki taraf da aynı. Bir diğeri
-- (`product_signature`) `function_execute_baseline` içindeki açık
-- `alter function` ile depoya zaten alınmıştı.
--
-- Geriye kalan ALTI fonksiyon depoda pinsiz kaldı. Ölçüldü:
--
--   Üretim  : altısı da `search_path=public`
--   Depodan sıfırdan kurulan temiz şema : altısı da pinsiz
--
-- Yani temiz bir kurulum üretimi yeniden üretmiyordu. Bu göç o farkı kapatır.
-- Üretimde ÇALIŞTIRILDIĞINDA HİÇBİR ŞEY DEĞİŞTİRMEZ (no-op): oradaki değer
-- zaten `search_path=public`.
--
-- NEDEN ÖNEMLİ
-- `search_path`'i sabit olmayan bir fonksiyon, kendisini ÇAĞIRAN rolün
-- search_path'ini kullanır. Şema niteleyicisi yazılmamış her ad (`now`,
-- `translate`, bir operatör) çağıranın öne aldığı bir şemadan çözülebilir.
--
-- DÜRÜST ŞİDDET DEĞERLENDİRMESİ: bu altı fonksiyonun HİÇBİRİ
-- `security definer` DEĞİL (ölçüldü, `prosecdef = false`). Yani buradaki
-- klasik yetki yükseltme yolu -- sahibinin hakkıyla saldırganın kodunu
-- çalıştırmak -- bu altısında AÇIK DEĞİL. Bu bir açık kapatma göçü değil,
-- bir DRIFT KAPATMA göçüdür: değerli olan, üretimin ve temiz kurulumun
-- aynı şeyi üretmesidir. İkisi ayrıştığında yerelde geçen bir testin
-- üretimde geçtiğini kimse garanti edemez.
--
-- NEDEN `to 'public'` ve `to ''` DEĞİL
-- Bu altısı gövdelerinde niteliksiz adlar kullanıyor (`translate`,
-- `regexp_replace`, `now`, tetikleyici içinde `public.users` gibi). Boş
-- search_path onları kırardı. `public`, üretimde hâlihazırda duran değerin
-- AYNISIDIR; bu göç iki tarafı eşitler, üçüncü bir davranış icat etmez.
-- (Depoda `''` kullanan fonksiyonlar var -- `tg_payouts_touch`, `net_after_tax`
-- gibi; onlar tam nitelikli yazıldıkları için öyle kalabiliyor. Onlara
-- dokunulmuyor.)
--
-- KAPSAM DIŞI: gövde değişmiyor, imza değişmiyor, yetki değişmiyor. Yalnızca
-- fonksiyon yapılandırması. `alter function ... set search_path` gövdeyi
-- yeniden derlemez ve bağımlı tetikleyicileri düşürmez.
-- ============================================================================

alter function public.normalize_search(text)                set search_path to 'public';
alter function public.slugify(text)                         set search_path to 'public';
alter function public.tg_set_updated_at()                   set search_path to 'public';
alter function public.tg_orders_set_order_number()          set search_path to 'public';
alter function public.tg_conversions_stamp_status()         set search_path to 'public';
alter function public.assert_orderable(public.products)     set search_path to 'public';


-- ---------------------------------------------------------------------------
-- KENDİ KENDİNİ DOĞRULAYAN KONTROL
-- ---------------------------------------------------------------------------
-- Yorum yalan söyleyebilir; iddia söyleyemez.
do $$
declare
  v_imzalar text[] := array[
    'public.normalize_search(text)',
    'public.slugify(text)',
    'public.tg_set_updated_at()',
    'public.tg_orders_set_order_number()',
    'public.tg_conversions_stamp_status()',
    'public.assert_orderable(public.products)'
  ];
  v_imza  text;
  v_deger text;
  v_kalan text;
begin
  -- 1) Altısının da değeri TAM OLARAK `search_path=public` olmalı.
  --    `regprocedure` cast'i bilerek kullanılıyor: imza yanlış yazılmışsa
  --    iddia sessizce geçmez, göç burada düşer.
  foreach v_imza in array v_imzalar loop
    select coalesce(array_to_string(p.proconfig, ','), '(pin YOK)')
      into v_deger
      from pg_proc p
     where p.oid = v_imza::regprocedure;

    if v_deger <> 'search_path=public' then
      raise exception
        'BASARISIZ: % fonksiyonunun search_path degeri "search_path=public" degil: %',
        v_imza, v_deger;
    end if;
  end loop;

  /*
   * 2) YAKALAYICI İDDİA — geriye pinsiz TEK BİR fonksiyon kalmamalı.
   *
   * Yukarıdaki altı satır elle yazıldı; elle yazılmış her liste eksik
   * kalabilir. Bu kontrol listeye değil KATALOĞA sorar: `public` şemasındaki,
   * bir uzantıya ait OLMAYAN her fonksiyon ve yordam pin taşımalı.
   *
   * Uzantı süzgeci şart: yerel doğrulama ortamında pgTAP `public` içine
   * kurulur ve yüzlerce pinsiz fonksiyon getirir; onlar bizim değil.
   *
   * Üretimde ölçüldü: bu sorgu bugün boş dönüyor. Yani bu iddia üretimde de
   * geçer ve göç orada gerçek bir no-op'tur.
   */
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into v_kalan
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind in ('f', 'p')
     and p.proconfig is null
     and not exists (
       select 1 from pg_depend d
        where d.objid = p.oid
          and d.classid = 'pg_proc'::regclass
          and d.deptype = 'e');

  if v_kalan is not null then
    raise exception
      'BASARISIZ: su fonksiyonlar hala search_path pini tasimiyor: %', v_kalan;
  end if;

  raise notice
    '✓ 6 yardimci fonksiyonun search_path degeri public olarak sabitlendi; '
    'public semasinda pinsiz fonksiyon kalmadi.';
end $$;
