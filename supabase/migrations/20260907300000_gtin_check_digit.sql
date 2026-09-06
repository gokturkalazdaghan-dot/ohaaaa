-- ===========================================================================
-- GTIN KONTROL BASAMAĞI — biçim kontrolü yetmez
-- ===========================================================================
--
-- BULUNAN AYRIŞMA
--
-- GTIN normalizasyonu İKİ YERDE yazılmıştı ve ikisi FARKLI şeyler yapıyordu:
--
--   `packages/ingest/normalize.ts`   kontrol basamağını doğruluyor ama
--                                    GTIN-14'e DOLDURMUYOR
--   `public.normalize_gtin` (SQL)    dolduruyor ama kontrol basamağına
--                                    BAKMIYOR
--
-- İkincisinin sonucu somut: bir feed'de yanlış yazılmış TEK BİR RAKAM,
-- tamamen başka bir ürünün geçerli görünen GTIN'ini üretir. Kontrol
-- basamağı doğrulanmazsa o iki ürün AYNI kanonik satıra düşer ve kullanıcı
-- karşılaştırma tablosunda BAŞKA BİR ÜRÜNÜN fiyatlarını görür -- yani
-- yanlış ürünü satın alır. Tekilleştirmenin en pahalı hatası budur.
--
-- Bu göç iki uygulamayı tek davranışta birleştiriyor: DOĞRULA ve DOLDUR.
-- `verify-canonical-parity.mjs` eşitliği CI'da kilitliyor.
--
-- ---------------------------------------------------------------------------
-- ÜRETİLMİŞ SÜTUNLAR KENDİLİĞİNDEN TAZELENİR
-- ---------------------------------------------------------------------------
-- `product_groups.gtin_normalized` ve `canonical_key` ile
-- `products.canonical_key` bu fonksiyondan türetiliyor. PostgreSQL,
-- fonksiyon gövdesi değiştiğinde üretilmiş sütunları KENDİLİĞİNDEN
-- yeniden hesaplamaz; bu yüzden aşağıda tablolar açıkça yeniden
-- yazdırılıyor. Yapılmasaydı eski (geçersiz) anahtarlar yerinde kalır ve
-- yeni satırlarla eşleşmezdi -- yani düzeltme, düzeltmeyi bekleyen
-- satırlara HİÇ ULAŞMAZDI.
-- ===========================================================================

create or replace function public.normalize_gtin(p_gtin text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with d as (
    select regexp_replace(coalesce(p_gtin, ''), '[^0-9]', '', 'g') as s
  ),
  gecerli as (
    select s from d where length(s) in (8, 12, 13, 14)
  ),
  -- GS1 kontrol basamagi: sagdan sola 3-1-3-1 agirlikli toplam.
  hesap as (
    select
      g.s,
      (10 - (sum(
        substr(g.s, i, 1)::int
        * case when (length(g.s) - i) % 2 = 1 then 3 else 1 end
      ) % 10)) % 10 as beklenen
    from gecerli g,
         lateral generate_series(1, length(g.s) - 1) as i
    group by g.s
  )
  select case
    when h.beklenen = substr(h.s, length(h.s), 1)::int then lpad(h.s, 14, '0')
    else null
  end
  from hesap h;
$$;

comment on function public.normalize_gtin is
  'GTIN-14 tek gosterimi, KONTROL BASAMAGI dogrulanmis. Bicim kontrolu '
  'yetmez: yanlis yazilmis tek bir rakam baska bir urunun gecerli gorunen '
  'GTIN ini uretir ve iki urun birlesirse kullanici yanlis urunu satin alir.';

-- ---------------------------------------------------------------------------
-- ÜRETİLMİŞ SÜTUNLARI YENİDEN HESAPLAT
-- ---------------------------------------------------------------------------
-- Fonksiyon değişti ama üretilmiş sütunlar eski değeri taşıyor. Boş bir
-- UPDATE satırları yeniden yazdırır ve üretilmiş sütunlar tazelenir.
--
-- Bu tablolar bugün BOŞ (production'da 0 satır); işlem ucuz. Dolu bir
-- tabloda bu bir yeniden yazma turudur ve o zaman parti parti yapılmalıdır
-- -- ama o gün geldiğinde eski anahtarları yerinde bırakmak, düzeltmeyi
-- düzeltilecek satırlara hiç ulaştırmamak olurdu.
update public.product_groups set gtin = gtin where gtin is not null;
update public.products        set gtin = gtin where gtin is not null;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
begin
  -- 1) GECERLI GTIN hala normalize ediliyor ve DOLDURULUYOR.
  if public.normalize_gtin('012345678905') is distinct from '00012345678905' then
    raise exception 'DOGRULAMA 1: gecerli GTIN normalize edilemedi (%).',
      public.normalize_gtin('012345678905');
  end if;

  -- 2) Ayni urunun uc gosterimi hala TEK degere iniyor.
  if public.normalize_gtin('0012345678905') is distinct from public.normalize_gtin('012345678905')
     or public.normalize_gtin('0-12345-67890-5') is distinct from public.normalize_gtin('012345678905') then
    raise exception 'DOGRULAMA 2: ayni GTIN farkli gosterimlerde ayristi.';
  end if;

  -- 3) KONTROL BASAMAGI YANLIS olan REDDEDILIYOR -- bu gocun varlik sebebi.
  --    '012345678906' son rakami disinda '012345678905' ile ayni: tam olarak
  --    bir feed'de olusan yazim hatasi.
  if public.normalize_gtin('012345678906') is not null then
    raise exception
      'DOGRULAMA 3: kontrol basamagi yanlis GTIN kabul edildi -- iki farkli '
      'urun birleseceyi ve kullanici yanlis urunu satin alacakti.';
  end if;

  -- 4) Gecersiz uzunluk hala NULL.
  if public.normalize_gtin('123') is not null or public.normalize_gtin('abc') is not null then
    raise exception 'DOGRULAMA 4: gecersiz uzunluk bir DEGER dondu.';
  end if;

  -- 5) Kanonik anahtar gecersiz GTIN'de bir alt basamaga DUSUYOR.
  if public.canonical_product_key('012345678906', 'Marka', 'MPN-1', 'Baslik') not like 'mpn:%' then
    raise exception
      'DOGRULAMA 5: gecersiz GTIN kanonik anahtarda hala gtin: dalinda -- '
      'yazim hatasi kimlik sayilirdi.';
  end if;

  raise notice
    'GTIN kontrol basamagi eklendi: yazim hatasi artik kimlik sayilmiyor, '
    'uretilmis sutunlar yeniden hesaplandi.';
end $$;
