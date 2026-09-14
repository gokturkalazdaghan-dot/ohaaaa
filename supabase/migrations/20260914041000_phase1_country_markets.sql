-- ============================================================================
-- FAZ 1 — ÜLKE BAZLI PAZARLAR (Türkiye, UK, Avrupa, Körfez)
--
-- ⚠️  BU GÖÇ ÜRETİMDE ÇALIŞTIRILMADI. Hazırlandı ve incelemeye bırakıldı.
--
-- NEDEN
-- Avrupa bugün tek bir `EU` pazarı, Körfez tek bir `GCC` pazarı olarak
-- duruyor. İkisi de ticari olarak yanlış: `EU` kapsamındaki İsveç'in para
-- birimi SEK, `GCC` kapsamındaki altı ülkenin altı ayrı birimi var. Tek
-- pazar varsayımı, ziyaretçiye yanlış para biriminde fiyat göstermenin
-- kurumsallaşmış hâli olurdu.
--
-- NE YAPIYOR
-- Faz 1'de faaliyet gösterilecek her ÜLKE için bir pazar satırı açıyor ve
-- ülkeyi kendi pazarına bağlıyor. `EU`, `GCC`, `NORDICS`, `ANZ` satırları
-- SİLİNMİYOR: bölgesel gruplama olarak duruyorlar ve ülkeler onlara üye
-- kalmaya devam ediyor (`market_countries` çoklu üyeliği zaten destekliyor).
--
-- KOD DEĞİŞİKLİĞİ GEREKTİRMEZ. `Market` tipi `string`; uygulama pazarları
-- `markets` tablosundan okuyor (`apps/web/src/data/markets.ts`). Çözümleme
-- sırası ülkeye özel pazarı bölgesel olana tercih ediyor
-- (`marketCatalog.ts` → `ulkeninPazari`), dolayısıyla bu satırlar
-- eklendiğinde Almanya `EU` yerine `DE` pazarına, BAE `GCC` yerine `AE`
-- pazarına düşer -- tek satır TypeScript değişmeden.
--
-- PAZAR ADI VE PARA BİRİMİ ÜLKEDEN TÜRETİLİYOR, elle yazılmıyor. Elle
-- yazmak, `countries` ile ayrışacak ikinci bir doğruluk kaynağı üretirdi.
--
-- TR VE GB HARİÇ: ikisinin ülkeye özel pazarı (`TR`, `UK`) zaten var.
-- `GB` ülkesinin pazar kodu `UK`; aynı ülke için ikinci bir pazar açmak
-- çözümlemeyi belirsizleştirirdi.
-- ============================================================================

-- Faz 1 kapsamı: Avrupa (27) + Körfez (6). TR ve GB bilerek dışarıda.
create temporary table faz1_ulkeler (code char(2) primary key) on commit drop;

insert into faz1_ulkeler (code) values
  -- Avrupa
  ('AT'), ('BE'), ('BG'), ('HR'), ('CY'), ('CZ'), ('DK'), ('EE'), ('FI'),
  ('FR'), ('DE'), ('GR'), ('HU'), ('IE'), ('IT'), ('LV'), ('LT'), ('LU'),
  ('MT'), ('NL'), ('PL'), ('PT'), ('RO'), ('SK'), ('SI'), ('ES'), ('SE'),
  -- Körfez
  ('AE'), ('SA'), ('QA'), ('KW'), ('BH'), ('OM');

/*
 * Pazar kodu = ülke kodu. İkisinin aynı olması tesadüf değil, çözümlemenin
 * dayandığı kural: `ulkeninPazari` önce "kodu ülkeyle aynı olan pazar"a
 * bakar. Böylece ülkeye özel pazar her zaman bölgesel olanı yener.
 *
 * `markets_code_bicimi` kısıtı iki büyük harfi kabul ediyor (^[A-Z][A-Z0-9_]{1,15}$).
 */
insert into public.markets (code, name_en, default_currency, is_active)
select u.code, c.name_en, c.default_currency, true
  from faz1_ulkeler u
  join public.countries c on c.code = u.code
on conflict (code) do nothing;

/*
 * Ülkeyi KENDİ pazarına bağla. Bölgesel üyelikler (EU, GCC, NORDICS)
 * SİLİNMİYOR -- ülke artık iki pazarda birden üye ve bu şemanın zaten
 * desteklediği durum.
 */
insert into public.market_countries (market_code, country_code)
select u.code, u.code from faz1_ulkeler u
on conflict (market_code, country_code) do nothing;


-- ---------------------------------------------------------------------------
-- DOĞRULAMA — göç uygulanırsa bu sorgular beklenen tabloyu göstermeli
-- ---------------------------------------------------------------------------
-- Her Faz 1 ülkesi kendi pazarına çözülmeli:
--   select c.code, m.code, m.default_currency
--     from public.countries c
--     join public.markets m on m.code = c.code
--    where c.code in (select code from faz1_ulkeler);
--
-- İsveç iki pazarda üye olmalı (SE ve EU ve NORDICS):
--   select market_code from public.market_countries where country_code = 'SE';


-- ---------------------------------------------------------------------------
-- GERİ ALMA
-- ---------------------------------------------------------------------------
-- delete from public.market_countries
--  where market_code = country_code
--    and country_code in ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR',
--                         'DE','GR','HU','IE','IT','LV','LT','LU','MT','NL',
--                         'PL','PT','RO','SK','SI','ES','SE',
--                         'AE','SA','QA','KW','BH','OM');
-- delete from public.markets
--  where code in ( ... ayni liste ... );
--
-- Bolgesel pazarlar (EU, GCC, NORDICS, ANZ) hic degismedigi icin sistem
-- bu gocten onceki haline birebir doner.
