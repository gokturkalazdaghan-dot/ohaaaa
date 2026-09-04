-- ============================================================================
-- FONKSIYON EXECUTE YETKILERI — PUBLIC SIZINTISININ KAPATILMASI
-- ----------------------------------------------------------------------------
-- KOK NEDEN
-- PostgreSQL yeni bir fonksiyon olusturuldugunda EXECUTE yetkisini `PUBLIC`
-- sozde-rolune VARSAYILAN olarak verir. `PUBLIC`, `anon` dahil her rolu
-- kapsar. Yani bir fonksiyona "yalnizca authenticated cagirsin" demek icin
-- `grant execute ... to authenticated` yazmak YETMEZ: o ifade EKLEMELIDIR,
-- varsayilani kaldirmaz.
--
-- 20260831120000_function_execute_baseline.sql bu yetkiyi ADA GORE yazilmis
-- bir listeden cekti (record_click, record_conversion, log_api_request ...).
-- Liste bilincliydi ve dogruydu -- ama `create_order` o listede YOKTU. Ona
-- yalnizca `grant execute ... to authenticated` verildi (satir 157) ve
-- varsayilan PUBLIC grant'i yerinde kaldi.
--
-- SONUC: kimliksiz bir kullanici, herkese acik anon anahtariyla
-- `/rest/v1/rpc/create_order` uzerinden dogrudan siparis satiri yaratabilir
-- ve `apps/web/src/app/api/checkout/route.ts` icindeki "odeme saglayicisi
-- bagli degil -> 503" korumasini TAMAMEN atlar. Bugun katalog bos oldugu
-- icin somurulemez; ilk satici ilk urununu yayinladigi anda canlanir.
--
-- BU BIR DAVRANIS DEGISIKLIGI DEGIL, SAPMA DUZELTMESIDIR.
-- `create_order` iki ayri migration'da acikca `authenticated`e verilmisti:
--   20260829090200_rls_policies.sql:297
--   20260831120000_function_execute_baseline.sql:157
-- Misafir (anon) siparisi hicbir zaman kasitli olarak acilmadi. Fonksiyonun
-- kendisi de `insert into orders (user_id, ...) values (auth.uid(), ...)`
-- yaziyor; anon icin bu deger zaten null.
--
-- ----------------------------------------------------------------------------
-- NEDEN TOPLU (SEMA GENELI) BIR SWEEP DEGIL?
-- `public` semasinda 155 fonksiyon var ve 102'si anon'a acik. Ama bunlarin
-- ~60'i EKLENTI fonksiyonudur: citext_*, gtrgm_*, gin_trgm_*, similarity_*,
-- word_similarity_*, textic*, regexp_* ...  `citext` ve `pg_trgm` public
-- semasina kurulu oldugu icin bunlar burada gorunuyor.
--
-- `search_products` ve RLS politikalari CAGIRANIN yetkisiyle degerlendirilir;
-- bu eklenti fonksiyonlarindan PUBLIC'i cekmek aramayi ve politikalari
-- TOPTAN kirar. Baseline migration'in kendi yorumu da tam olarak bunu
-- soyluyordu. Bu yuzden burada da ad ad, gerekce gerekce ilerliyoruz.
-- Eklenti fonksiyonlarinin anon'a acik kalmasi KABUL EDILMIS bir maruziyettir:
-- hepsi saf hesaplama yapar, veri okumaz, yan etkisi yoktur.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) PUBLIC'ten cekilecek fonksiyonlar
-- ---------------------------------------------------------------------------
-- ADA gore eslestirilir, imzaya gore DEGIL. Elle yazilan bir imza yanlissa
-- "fonksiyon yok" sayilip sessizce atlanir ve delik acik kalir -- baseline
-- migration'da tam olarak bu olmustu. Beklenen adlarin GERCEKTEN bulundugu
-- ayrica dogrulanir: sessizce hicbir sey yapmayan bir guvenlik gocu, hic
-- olmayan goctan kotudur.
do $$
declare
  beklenen text[] := array[
    -- Para yolu: siparis yaratma. Niyet iki migration'da `authenticated`.
    'create_order',
    -- Satici panosu istatistigi. rls_policies.sql:300'de yalnizca
    -- `authenticated`e verilmisti. Fonksiyonun kendi icinde
    -- `owns_vendor() or is_admin()` kontrolu var (savunma katmani korunur),
    -- ama anon'un bu fonksiyonu cagirmak icin hicbir gerekcesi yok.
    'vendor_dashboard_stats',
    -- Cagiranin KENDI rolunu dondurur (`where id = auth.uid()`). anon icin
    -- daima null doner, yani sizinti degil; ama hicbir RLS politikasi ve
    -- hicbir uygulama kodu bunu anon olarak cagirmiyor (dogrulandi:
    -- pg_policies'te referans yok, repoda cagrisi yok). Yuzeyi daraltiyoruz.
    'current_role'
  ];
  ad         text;
  r          record;
  bulunan    int;
begin
  foreach ad in array beklenen loop
    select count(*) into bulunan
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = ad;

    if bulunan = 0 then
      raise exception
        'Beklenen fonksiyon bulunamadi: public.%. Goc sessizce gecmemeli.', ad;
    end if;

    for r in
      select p.oid::regprocedure as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = ad
    loop
      execute format('revoke execute on function %s from public, anon', r.sig);
    end loop;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2) Tetikleyici fonksiyonlari — sweep TEKRAR calistirilir
-- ---------------------------------------------------------------------------
-- Baseline migration `tg\_%` kalibindaki her fonksiyondan PUBLIC'i cekmisti.
-- Ama o goc BIR KEZ calisti; ondan SONRA olusturulan tetikleyici
-- fonksiyonlari varsayilan PUBLIC grant'iyla dogdu ve acikta kaldi:
--   tg_payouts_touch              (20260903150000_cash_received.sql)
--   tg_products_touch_freshness   (20260903220000_freshness.sql)
--
-- Bu, tekil bir hata degil SISTEMIK bir bosluktu; asagidaki 3. bolum ayni
-- bosluktan yeni fonksiyon dogmasini engelliyor.
--
-- Tetikleyici fonksiyonuna EXECUTE yetkisi YALNIZCA `create trigger` aninda
-- aranir, tetikleme aninda degil. PUBLIC'ten cekmek hicbir tetikleyiciyi
-- bozmaz; yalnizca dogrudan RPC ile cagrilmalarini engeller.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'tg\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3) GELECEKTEKI fonksiyonlar — asil (sistemik) duzeltme
-- ---------------------------------------------------------------------------
-- ONCE DENENEN VE CALISMAYAN YOL — kayda geciyorum ki bir daha denenmesin:
--
--   alter default privileges in schema public
--     revoke execute on functions from public;
--
-- Bu ifade PostgreSQL 16'da bu senaryoda ETKISIZDIR. Uc ayri deneyle
-- olculdu:
--   1) Hicbir acik varsayilan ACL yokken calistirildiginda `pg_default_acl`
--      icine HIC SATIR yazmaz; yeni fonksiyon yine `=X/postgres` (PUBLIC)
--      tasiyarak dogar.
--   2) Once `grant execute on functions to service_role` ile bir ACL satiri
--      maddilestirilip sonra revoke edildiginde satir `{service_role=X}`
--      olur -- yani PUBLIC'i icermez -- ama olusan fonksiyonun `proacl`
--      degeri YINE `{=X/postgres,postgres=X/postgres,service_role=X/postgres}`
--      olur. Yerlesik PUBLIC varsayilani birlestirilmeye devam eder.
--   3) Revoke, satir zaten varken tekrar calistirildiginda da sonuc degismez.
--
-- Baseline migration'daki
--   `alter default privileges ... revoke all on functions from anon, authenticated`
-- satiri da ayni sebeple sessiz bir no-op'tu: `PUBLIC` sozde-rolu `anon` ve
-- `authenticated`ten AYRI bir varliktir ve delik oradan siziyordu.
--
-- CALISAN YOL: olay tetikleyicisi (event trigger).
-- `CREATE FUNCTION` tamamlandigi anda PUBLIC yetkisi cekilir. Boylece her
-- yeni fonksiyon KAPALI dogar ve erisim acikca verilmek zorunda kalir.
--
-- IKI GUVENLIK OZELLIGI OLCULDU (yoksa bu tetikleyici vitrini kirardi):
--   • PUBLIC'ten cekmek ACIK `anon`/`authenticated` grant'ina DOKUNMAZ.
--     `{postgres=X, anon=X, authenticated=X}` ACL'i revoke sonrasi aynen
--     kalir. Yani baseline'in kasitli vitrin grant'lari korunur.
--   • `CREATE OR REPLACE` mevcut ACL'i KORUR. Tetikleyici yine ateslenir
--     ama zaten olmayan PUBLIC'i cekmeye calisir; etkisizdir. Gelecekteki
--     migration'lar bir fonksiyonu guncelledi diye yetkisini kaybetmez.
create or replace function public.tg_revoke_public_execute()
returns event_trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select objid
      from pg_event_trigger_ddl_commands()
     where command_tag = 'CREATE FUNCTION'
       and schema_name = 'public'
  loop
    execute format('revoke execute on function %s from public', r.objid::regprocedure);
  end loop;
end
$$;

comment on function public.tg_revoke_public_execute() is
  'Yeni fonksiyonlarin PUBLIC EXECUTE varsayilanini kaldirir. '
  'ALTER DEFAULT PRIVILEGES bu isi yapmadigi icin gerekli (bkz. 20260904110000).';

-- TETIKLEYICI FONKSIYONUN KENDISI DE KAPATILIR.
-- Bu satir bir ayrinti degil: fonksiyon, tetikleyici HENUZ KURULMADAN once
-- olusturuluyor ve dolayisiyla tam da bu gocun kapatmaya calistigi
-- varsayilan PUBLIC EXECUTE ile doguyor -- ustelik SECURITY DEFINER olarak.
-- Bunu 86_..._test.sql'deki allowlist iddiasi yakaladi; kapinin ise
-- yaradiginin kaniti.
revoke execute on function public.tg_revoke_public_execute()
  from public, anon, authenticated;

-- ORTAM FARKI DURUSTCE ELE ALINIR.
-- Olay tetikleyicisi olusturmak superuser yetkisi ister. Yonetilen bir
-- ortamda bu yetki verilmemis olabilir; o durumda goc DUSMEZ ama SESSIZ de
-- kalmaz: uyari birakilir ve 5. bolumdeki dogrulama tetikleyicinin gercekten
-- kurulup kurulmadigini raporlar. Sistemik koruma kurulamazsa geriye kalan
-- kapi CI'daki pgTAP allowlist testidir
-- (supabase/tests/86_function_execute_public_sweep_test.sql).
do $$
begin
  drop event trigger if exists revoke_public_execute;

  create event trigger revoke_public_execute
    on ddl_command_end
    when tag in ('CREATE FUNCTION')
    execute function public.tg_revoke_public_execute();
exception
  when insufficient_privilege then
    raise warning
      'Olay tetikleyicisi olusturulamadi (yetki yok). Yeni fonksiyonlar '
      'PUBLIC EXECUTE ile dogmaya devam edecek; CI allowlist testi tek kapi.';
end
$$;

-- ---------------------------------------------------------------------------
-- 4) Kasitli erisim GERI verilir
-- ---------------------------------------------------------------------------
-- 1. bolum PUBLIC'i cekerken `authenticated` da dolayli olarak etkilenmis
-- olabilir (PUBLIC uzerinden miras aliyorduysa). Niyet edilen erisim burada
-- ACIKCA yeniden kurulur; boylece yetki artik mirasa degil yaziya dayanir.
grant execute on function public.create_order(jsonb, text, jsonb, text)
  to authenticated;
grant execute on function public.vendor_dashboard_stats(uuid, integer)
  to authenticated;
grant execute on function public.current_role()
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5) GOC KENDI KENDINI DOGRULAR
-- ---------------------------------------------------------------------------
-- Bir guvenlik gocunun "calisti" demesi yetmez; NEYI garanti ettigini
-- kanitlamalidir. Asagidaki blok para yolunu ve yeni kapatilan yuzeyi
-- kataloga sorar. Bir tanesi bile acik kalirsa goc DUSER ve production'a
-- yarim bir durum sizmaz.
do $$
declare
  acik text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname)
    into acik
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       -- Para yolu (baseline'da kapatilmisti; burada bir daha dogrulaniyor)
       'record_conversion', 'record_click', 'confirm_payment',
       -- Bu gocun kapattiklari
       'create_order', 'vendor_dashboard_stats', 'current_role'
     )
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  if acik is not null then
    raise exception
      'Goc amacina ulasmadi -- hala anon EXECUTE tasiyan fonksiyonlar: %', acik;
  end if;
end
$$;

-- Sistemik korumanin gercekten kurulup kurulmadigi ACIKCA raporlanir.
-- "Kuruldugunu varsaymak" bu gocun kapatmaya calistigi hatanin ta kendisidir.
do $$
begin
  if exists (select 1 from pg_event_trigger where evtname = 'revoke_public_execute') then
    raise notice
      'Sistemik koruma AKTIF: yeni fonksiyonlar PUBLIC EXECUTE olmadan dogacak.';
  else
    raise warning
      'Sistemik koruma KURULAMADI. Hedefli revoke''lar uygulandi, ama yeni '
      'fonksiyonlar PUBLIC EXECUTE ile dogmaya devam edecek. Tek kapi: CI allowlist testi.';
  end if;
end
$$;

comment on function public.create_order(jsonb, text, jsonb, text) is
  'Sepeti tasoron bazinda bolerek (split-cart) siparis olusturur. Fiyatlar '
  'sunucuda yeniden hesaplanir. YALNIZCA `authenticated`: `anon` erisimi '
  'PostgreSQL varsayilan PUBLIC grant''indan sizmisti, 20260904110000 ile '
  'kapatildi.';
