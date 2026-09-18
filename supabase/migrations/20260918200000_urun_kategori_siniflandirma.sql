-- ===========================================================================
-- ÜRÜNLERİ TAKSONOMİYE DAĞIT — 132 kategorinin 128'i BOŞTU
-- ===========================================================================
--
-- ÖLÇÜLEN DURUM
-- Taksonomi (15 üst + 117 alt kategori) kuruldu ama ürünler hiç
-- dağıtılmadı. 34.722 ürün grubunun tamamı DÖRT kategoride yığılıydı:
--
--   bilgisayar   32.894
--   telefon         814
--   kulaklik        541
--   ev-yasam        261
--
-- Sonuç ekranda şuydu: "Bilgisayar, Elektronik" kategorisine girildiğinde
-- 12 alt kategoriden yalnızca 2'si görünüyordu (geri kalan 10'u ürünsüz
-- olduğu için `buildCategoryTree` tarafından eleniyordu) ve diğer 14 üst
-- kategorinin alt kategorilerinin HİÇBİRİ görünmüyordu. Kullanıcı için
-- taksonomi pratikte yoktu.
--
-- ---------------------------------------------------------------------------
-- NEDEN BAŞLIKTAN SINIFLANDIRMA
-- ---------------------------------------------------------------------------
-- Katalogdaki 35.718 teklifin TAMAMI tek bir mağazadan geliyor
-- (back-to-the-office, Awin MID 61655). Yani "mağazanın sektörü" ayırt
-- edici bir sinyal DEĞİL: hepsi aynı sektörde. Elde kalan tek gerçek
-- sinyal ürünün kendi başlığı ve markası.
--
-- Kural listesi ÖLÇÜLEREK yazıldı, tahminle değil: her kalıp önce
-- salt-okunur bir sorguyla sayıldı, eşleşen başlıklardan örnek çekilip
-- gözle doğrulandı, sonra listeye eklendi. Bugünkü isabet 34.722
-- grubun 27.802'si (%80).
--
-- ---------------------------------------------------------------------------
-- SINIFLANDIRILAMAYAN ÜRÜN YERİNDE KALIR
-- ---------------------------------------------------------------------------
-- Fonksiyon emin olamadığında NULL döner ve ürün mevcut kategorisinde
-- kalır. "Kalanları da bir yere koyalım" demek, 6.920 ürünü rastgele bir
-- kategoriye doldurmak olurdu: kullanıcı "Yazıcı" kategorisine girip
-- alakasız ürün görseydi, kategori sisteminin tamamına güveni biterdi.
-- Yanlış yere koymaktansa olduğu yerde bırakmak.
--
-- ---------------------------------------------------------------------------
-- SIRA ÖNEMLİ
-- ---------------------------------------------------------------------------
-- `case` yukarıdan aşağıya ilk eşleşmede durur, bu yüzden kurallar
-- ÖZGÜLDEN GENELE sıralı. Örnek: "printer cable" bir yazıcı kablosudur,
-- kablo kuralı önce gelseydi aksesuara düşerdi; "UPS battery cartridge"
-- bir yedek parçadır, `ups` kuralı önce gelseydi aksesuara düşerdi.
-- ===========================================================================

create or replace function public.kategori_slug_tahmin(p_title text, p_brand text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with g as (
    select lower(coalesce(p_title, '') || ' ' || coalesce(p_brand, '')) as t
  )
  select case
    -- Yazıcı ve sarf: "printer cable" kablo kuralından ÖNCE yakalanmalı.
    when t ~ '(toner|\mink\M|inkjet|laserjet|printhead|drum unit|printer|plotter|label writer|thermal print|workforce|imageclass|pixma|ecotank|officejet|deskjet|multifunction print|\mmfp\M)' then 'yazici'

    -- Yedek parça: batarya ve UPS kartuşu. `ups` genel kuralından ÖNCE.
    when t ~ '(ups battery|battery cartridge|\mrbc[0-9]|[0-9]+wh .*battery|battery for (dell|hp|lenovo|macbook|asus|acer)|replacement battery|laptop battery)' then 'bilgisayar-yedek-parcalari'

    when t ~ '(playstation|\mps5\M|\mps4\M|xbox|nintendo|game console|games console)' then 'oyun-konsollari'
    when t ~ '(gaming (mouse|keyboard|chair|headset)|racing wheel|razer|steelseries|logitech g[0-9]|joystick|gamepad)' then 'oyuncu-ozel'
    when t ~ '(headphone|headset|earbud|earphone|jabra evolve|evolve2|poly voyager|blackwire)' then 'kulaklik'
    when t ~ '(router|access point|wireless ap|modem|firewall|network switch|poe switch|ethernet switch|managed l2|wi-?fi (extender|mesh|adapter)|mesh system)' then 'ag-modem'
    when t ~ '(\mssd\M|nvme|hard drive|\mhdd\M|external drive|memory card|\msd card\M|usb flash|flash drive|nas enclosure|tape cartridge|\mlto-|storage array|raid enclosure)' then 'veri-depolama'
    when t ~ '(ddr[345]|memory module|motherboard|micro atx|\matx\M|processor|\mcpu\M|graphics card|geforce|radeon|power supply|\mpsu\M|cpu cooler|heatsink|computer case|midi tower|full tower|case fan|thermal paste)' then 'bilgisayar-bilesenleri'
    when t ~ '(projector|projection screen)' then 'projeksiyon-sistemleri'
    when t ~ '(monitor|keyboard|\mmouse\M|webcam|docking station|dock station|\mkvm\M|barcode scanner|document scanner|scanner|trackball|graphics tablet|keypad)' then 'cevre-birimleri'
    when t ~ '(licen[cs]e|software|antivirus|office 365|microsoft 365|subscription|windows server|windows 1[01])' then 'yazilim-urunleri'
    when t ~ '(soundbar|speaker|amplifier|television|\mtv\M|av receiver|microphone|dj controller)' then 'ses-goruntu-sistemleri'
    when t ~ '(security camera|ip camera|video doorbell|surveillance|cctv|smart plug|thermostat|smart bulb|door sensor)' then 'ev-gerecleri'
    when t ~ '(\mdesk lamp\M|led lamp|desk light)' then 'aydinlatma'
    when t ~ '(iphone|smartphone|mobile phone|galaxy s[0-9]|pixel [0-9]|android phone)' then 'android-telefonlar'
    when t ~ '(phone case|screen protector|phone holder|charging cable|charger|power bank|crossbody strap|\mfolio\M|tablet case|carry case|sleeve for)' then 'cep-telefonu-aksesuarlari'

    -- GERÇEK mobilya. Montaj aparatları (kol, askı, sehpa) buraya DEĞİL
    -- aksesuara gider: bir monitör kolu mobilya değil, monitör parçasıdır.
    when t ~ '(\mdesk\M|office chair|filing cabinet|bookcase|pedestal|cupboard|\mlocker\M|shelving|trolley)' then 'ofis-mobilyalari'

    when t ~ '(copier paper|copy paper|a[34] paper|printer paper|multipurpose paper|thermal paper|photo paper)' then 'fotokopi-kagitlari'
    when t ~ '(envelope|stapler|binder|ring file|\mfolder\M|notepad|whiteboard|flipchart|laminator|shredder|\mpen\M|pencil|marker|highlighter|sticky note|\mlabel|adhesive|cover film|desk pad)' then 'ofis-okul-kirtasiye'
    when t ~ '(cable|adapter|adaptor|converter|hdmi|displayport|usb hub|extension lead|surge protect|dongle|\mups\M|uninterruptible|sensor|patch (lead|panel)|monitor arm|wall mount|floor stand|cpu holder|vesa)' then 'elektronik-aksesuarlar'
    when t ~ '(laptop|notebook|desktop|all-in-one|tablet|chromebook|thin client|\mserver\M|barebone|surface pro|surface laptop|mini pc|workstation)' then 'bilgisayar'

    -- EMİN DEĞİLİZ. NULL döner ve ürün olduğu yerde kalır.
    else null
  end
  from g;
$$;

comment on function public.kategori_slug_tahmin is
  'Urun basligindan kategori slug tahmini. Emin olunamayan urunde NULL '
  'doner -- yanlis kategoriye koymak, kategori sistemine olan guveni '
  'bitirirdi. Kurallar olculerek yazildi, tahminle degil.';

revoke all on function public.kategori_slug_tahmin(text, text) from public;
revoke all on function public.kategori_slug_tahmin(text, text) from anon, authenticated;
grant execute on function public.kategori_slug_tahmin(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- YENİ ÜRÜNLER DE DAĞITILIR
-- ---------------------------------------------------------------------------
-- Tetikleyici YALNIZCA iki durumda yazar:
--   1. category_id boşsa,
--   2. category_id alım hattının toplu attığı KABA kovalardan biriyse
--      (bilgisayar / telefon / ev-yasam).
--
-- Bilerek verilmiş ÖZGÜL bir kategori asla ezilmez: bir insan ya da
-- sonraki bir göç "bu ürün yazıcıdır" dediyse, kalıp listesi onu geri
-- alamamalı. Kural listesi insandan daha iyi bilmiyor.
create or replace function public.tg_product_groups_kategori_ata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug   text;
  v_hedef  uuid;
  v_mevcut text;
begin
  select c.slug into v_mevcut from public.categories c where c.id = new.category_id;

  if new.category_id is not null
     and v_mevcut is not null
     and v_mevcut not in ('bilgisayar', 'telefon', 'ev-yasam') then
    return new;
  end if;

  v_slug := public.kategori_slug_tahmin(new.title, new.brand);
  if v_slug is null then
    return new;
  end if;

  select c.id into v_hedef from public.categories c where c.slug = v_slug;
  if v_hedef is not null then
    new.category_id := v_hedef;
  end if;

  return new;
end;
$$;

revoke all on function public.tg_product_groups_kategori_ata() from public;
revoke all on function public.tg_product_groups_kategori_ata() from anon, authenticated;

drop trigger if exists product_groups_kategori_ata on public.product_groups;
create trigger product_groups_kategori_ata
  before insert or update of title, brand, category_id on public.product_groups
  for each row execute function public.tg_product_groups_kategori_ata();

-- ---------------------------------------------------------------------------
-- MEVCUT KATALOĞUN DAĞITIMI
-- ---------------------------------------------------------------------------
-- Yalnızca kaba kovalardaki satırlar taşınır; başka bir kategoriye
-- bilerek konmuş hiçbir ürüne dokunulmaz. Tekrar çalıştırılabilir.
update public.product_groups g
   set category_id = hedef.id
  from public.categories mevcut, public.categories hedef
 where mevcut.id = g.category_id
   and mevcut.slug in ('bilgisayar', 'telefon', 'ev-yasam')
   and hedef.slug = public.kategori_slug_tahmin(g.title, g.brand)
   and hedef.id <> g.category_id;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- DOGRULAMA DAVRANISI OLCER, HACMI DEGIL
-- ---------------------------------------------------------------------------
-- Ilk yazimda "en az 12 alt kategori dolmali" gibi SAYIYA dayali iddialar
-- vardi. Uretimde dogruydular ama CI sifirdan kurulan bosa yakin bir
-- veritabaninda kosuyor: orada 12 dolu alt kategori HIC olmayacak ve goc
-- her derlemede duserdi. Sayi uretimin o gunku halini olcer, kurallarin
-- dogrulugunu degil. Burada olculen sey davranis: dogru kategoriye
-- gidiyor mu, emin olmadiginda susuyor mu, elle verileni eziyor mu.

do $$
declare
  v_id  uuid;
  v_kat text;
begin
  -- Fonksiyon kararli ve beklendigi gibi ayiriyor.
  if public.kategori_slug_tahmin('HP 305A Original LaserJet Toner Cartridge', 'HP') <> 'yazici' then
    raise exception 'DOGRULAMA 1: toner yazici kategorisine dusmedi.';
  end if;
  if public.kategori_slug_tahmin('Lindy 2m Premium HDMI Cable', 'Lindy') <> 'elektronik-aksesuarlar' then
    raise exception 'DOGRULAMA 1b: HDMI kablosu aksesuara dusmedi.';
  end if;
  if public.kategori_slug_tahmin('Bir sey', null) is not null then
    raise exception 'DOGRULAMA 1c: taninmayan urun icin bir kategori UYDURULDU.';
  end if;

  -- Tetikleyici yeni urunu dagitiyor.
  insert into public.product_groups (slug, title, brand)
       values ('goc-kategori-testi', 'Canon PIXMA Ink Cartridge Black', 'Canon')
    returning id into v_id;
  select c.slug into v_kat from public.categories c
    join public.product_groups g on g.category_id = c.id where g.id = v_id;
  if v_kat is distinct from 'yazici' then
    raise exception 'DOGRULAMA 2: tetikleyici yeni urunu dagitmadi (%).', coalesce(v_kat, 'NULL');
  end if;

  -- BILEREK verilmis ozgul kategori EZILMIYOR.
  update public.product_groups
     set category_id = (select id from public.categories where slug = 'mobilya')
   where id = v_id;
  select c.slug into v_kat from public.categories c
    join public.product_groups g on g.category_id = c.id where g.id = v_id;
  if v_kat is distinct from 'mobilya' then
    raise exception 'DOGRULAMA 3: elle verilen kategori kalip listesi tarafindan ezildi (%).', v_kat;
  end if;

  delete from public.product_groups where id = v_id;

  raise notice 'Siniflandirici kuruldu ve mevcut katalog dagitildi.';
end $$;
