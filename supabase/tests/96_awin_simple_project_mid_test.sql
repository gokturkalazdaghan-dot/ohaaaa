-- ===========================================================================
-- 96 — Simple Project: MID 158122 ve deeplink sablonu
-- ===========================================================================
--
-- Bu dosyanin sinadigi tehlike SESSIZ olandir: bicimce gecerli ama ag
-- tarafindan ATFEDILEMEYEN bir link. Boyle bir link uretilirse kullanici
-- yonlendirilir, tiklama kaydedilir, hicbir hata gorunmez -- ve komisyon
-- hic olusmaz. Asagidaki iddialarin cogu tam olarak bunu kovaliyor.
begin;
select plan(10);

-- --- 1: MID yazildi -------------------------------------------------------
select is(
  (select network_advertiser_id from public.merchants where slug = 'simple-project'),
  '158122', '1) awinmid 158122 kaydedildi');

-- --- 2-5: sablonun dort parcasi ------------------------------------------
select ok(
  (select deeplink_template like '%awinmid=158122%' from public.merchants where slug = 'simple-project'),
  '2) sablon MID''i SABIT olarak tasiyor');

select ok(
  (select deeplink_template like '%awinaffid=3074081%' from public.merchants where slug = 'simple-project'),
  '3) yayinci kimligi sablonda');

-- clickref PARANIN GERI DONUS YOLU: Awin bu degeri donusum raporunda geri
-- verir ve bizim tarafta clicks.subid'dir. Olmasaydi komisyon olusur ama
-- hangi tiklamadan geldigi bilinmezdi.
select ok(
  (select deeplink_template like '%clickref={subid}%' from public.merchants where slug = 'simple-project'),
  '4) clickref={subid} -- donusum tiklamaya baglanabilir');

select ok(
  (select deeplink_template like '%ued={url_encoded}%' from public.merchants where slug = 'simple-project'),
  '5) ued={url_encoded} -- hedef urun adresi tasiniyor');

-- --- 6: BU DOSYANIN ASIL IDDIASI -----------------------------------------
-- buildAffiliateUrl {awinmid} yer tutucusunu COZMEZ. Sablonda kalsaydi
-- `new URL()` suslu parantezi sorgu dizesinde korur; adres gecerli gorunur
-- ve tiklama sessizce atfedilmez. (Kod tarafinda ikinci bir kapi daha var:
-- olculdu, `unresolved_placeholder` ile reddediyor. Bu iddia veritabani
-- tarafindaki ilk kapidir.)
select ok(
  (select position('{awinmid}' in deeplink_template) = 0
     from public.merchants where slug = 'simple-project'),
  '6) sablonda cozulmemis {awinmid} YOK -- tiklamalar atfedilebilir');

-- --- 7: desteklenmeyen baska yer tutucu da yok ---------------------------
select ok(
  (select deeplink_template !~ '\{(?!url\}|url_encoded\}|tracking_id\}|subid\})[a-z_]+\}'
     from public.merchants where slug = 'simple-project'),
  '7) yalnizca buildAffiliateUrl''in tanidigi yer tutucular var');

-- --- 8-9: MID BIR MENTESEDIR, KAPI DEGIL ---------------------------------
-- Sablonun kurulmus olmasi magazayi yayina hazir YAPMAZ: komisyon hala
-- dogrulanmadi ("%10+" bir taban) ve ana sayfa yok.
select is(
  (select terms_verified_at from public.merchants where slug = 'simple-project'),
  null::timestamptz,
  '8) sartlar hala dogrulanmadi -- MID komisyonu kanitlamaz');

select throws_ok(
  $$ update public.merchants set status = 'active' where slug = 'simple-project' $$,
  '23514', null,
  '9) MID''e ragmen yayina alinamiyor -- dogrulanmis sart sarti duruyor');

-- --- 10: alim icin zorunlu alan hala eksik -------------------------------
-- normalize.ts validateUrl: allowedHosts BOSSA her urun adresi reddedilir.
-- Ana sayfa olmadan feed'den tek satir bile gecmez; bu yuzden eksikligi
-- kayit altinda olmali.
select is(
  (select homepage_url from public.merchants where slug = 'simple-project'),
  null::text,
  '10) ana sayfa hala yok -- alim bu haliyle sifir urun yazar');

select * from finish();
rollback;
