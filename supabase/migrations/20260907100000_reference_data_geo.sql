-- ============================================================================
-- COĞRAFİ REFERANS VERİSİ — ülke, para birimi, dil, pazar
-- ----------------------------------------------------------------------------
-- NEDEN
-- Bugün dört ayrı kavram üç yere sıkışmış durumda:
--
--   market   → `public.market` enum ('TR','DE','US')  — KAPALI liste
--   currency → char(3) + market_currency() CHECK'i    — pazara ZİNCİRLİ
--   country  → merchants/vendors.country_code         — serbest char(2),
--                                                       referans tablosu YOK
--   locale   → TypeScript'te sabit dizi
--
-- Hedef pazarlar (TR, AB, UK, US, CA, Okyanusya, İskandinavya, Körfez)
-- ~41 ülke ve 21 para birimi demek. Enum ile bu, her ülke için bir
-- `alter type` + bir TypeScript düzenlemesi + bir dağıtım demektir. Üstelik
-- PostgreSQL enum değeri SİLMEZ: yanlış bir etiket kalıcıdır.
--
-- BU GÖÇÜN KURALI: ÜLKE VE PARA BİRİMİ VERİDİR, ŞEMA DEĞİL.
-- Yeni bir ülke, para birimi ya da dil eklemek bundan sonra BİR SATIR
-- eklemektir. Şema değişmez, TypeScript değişmez, dağıtım gerekmez.
--
-- ----------------------------------------------------------------------------
-- DÖRT EKSEN BİRBİRİNDEN BAĞIMSIZ
--
--   country  ──┐ N:M ┌── market        (İsveç hem NORDICS hem EU olabilir)
--              └─────┘
--   currency ── hiçbirine bağlı değil
--   locale   ── hiçbirine bağlı değil
--
-- `default_currency` alanları FK'dır ama KISIT DEĞİLDİR: "bu bölgenin olağan
-- para birimi" bilgisidir, bir teklifin para birimini BELİRLEMEZ. Bir Alman
-- satıcı GBP ile fiyat verebilir; şema bunu yasaklamaz.
--
-- ----------------------------------------------------------------------------
-- BU GÖÇ TAMAMEN EKLEMELİDİR
-- Hiçbir mevcut tabloya, sütuna, kısıta, fonksiyona ya da tipe DOKUNMAZ.
-- `public.market` enum'u, `market_currency()` ve iki uyum kısıtı yerinde
-- kalır. Yabancı anahtarlar M2'de, `market_code` sütunları M3'te, enum'un
-- düşürülmesi M4'te. Bu sıralama bilinçlidir: her adım tek başına geri
-- alınabilir olmalı.
--
-- GERİ ALMA: beş `drop table` (ters sırada). Hiçbir mevcut nesne etkilenmez.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) currencies — ISO 4217
-- ---------------------------------------------------------------------------
create table public.currencies (
  code       char(3) primary key,
  name_en    text    not null,

  /*
   * KURUŞ HANESİ — bu sütun bir konfor alanı değil, PARA YOLUDUR.
   *
   * Sistem tutarları HER katmanda tam sayı "minor unit" olarak taşıyor.
   * Bu bilgi olmadan her para birimi 2 haneli varsayılırdı ve:
   *
   *   KWD/BHD/OMR (3 hane) → 10 KAT hata
   *   ISK          (0 hane) → 100 KAT hata
   *
   * Körfez ve İzlanda hedef kapsamda olduğu için bu dört değer modelin en
   * kritik hücreleridir. Hata sessizdir: yanlış tutar da geçerli bir
   * tam sayıdır.
   */
  minor_unit smallint not null default 2 check (minor_unit between 0 and 4),
  symbol     text,
  is_active  boolean not null default true,

  constraint currencies_code_bicimi check (code ~ '^[A-Z]{3}$')
);

comment on table public.currencies is
  'ISO 4217 para birimleri. Yeni para birimi = BIR SATIR; kod degisikligi yok.';
comment on column public.currencies.minor_unit is
  'Alt birim hane sayisi. KWD/BHD/OMR=3, ISK=0, cogu=2. Tutar matematigi buna bagli.';


-- ---------------------------------------------------------------------------
-- 2) locales — arayüz dilleri
-- ---------------------------------------------------------------------------
create table public.locales (
  code    text primary key,
  name_en text not null,

  /*
   * ÇEVİRİ VAR MI?
   *
   * Bir ülkenin `default_locale` değeri o ülkenin GERÇEK dilidir --
   * Fransa için 'fr'. Ama uygulama bugün Fransızca render edemez
   * (çeviri yok). İki bilgiyi ayırmak, veriyi dürüst tutuyor:
   *
   *   veri der ki   : Fransa Fransızca konuşur
   *   bu bayrak der : 'fr' henüz desteklenmiyor
   *   uygulama      : desteklenen bir dile düşer
   *
   * Alternatifi -- Fransa'ya 'en' yazmak -- veriyi yalanlardı ve çeviri
   * geldiğinde 27 satır güncellemek gerekirdi. Böyle TEK BAYRAK çevrilir.
   */
  is_supported boolean not null default false,

  constraint locales_code_bicimi check (code ~ '^[a-z]{2,3}$')
);

comment on table public.locales is
  'Arayuz dilleri. is_supported=false olan dil veride durur; uygulama '
  'desteklenen bir dile duser. Ceviri geldiginde tek bayrak cevrilir.';


-- ---------------------------------------------------------------------------
-- 3) countries — ISO 3166-1 alpha-2
-- ---------------------------------------------------------------------------
create table public.countries (
  code             char(2) primary key,
  name_en          text    not null,

  -- Bu ülkenin OLAĞAN para birimi. Bir teklifin para birimini BELİRLEMEZ.
  default_currency char(3) not null references public.currencies (code),

  -- Bu ülkenin GERÇEK dili -- desteklenip desteklenmediğinden bağımsız.
  default_locale   text    not null references public.locales (code),

  /*
   * SAYI/PARA BİÇİMİ — dilden AYRI bir alan ve BUGÜN ÇALIŞIR.
   *
   * Çeviri gerektirmez: `Intl.NumberFormat` her BCP-47 etiketini bugün
   * işler. Yani Fransa'nın arayüzü İngilizce olsa bile fiyatı
   * "1 234,56 €" diye Fransız biçiminde yazabiliriz.
   *
   * money.ts'teki mevcut yorumun söylediği kural budur:
   * "AYIRICILAR okuyanın dilinden, SEMBOL paranın kendisinden gelir."
   */
  number_locale    text    not null,
  is_active        boolean not null default true,

  constraint countries_code_bicimi check (code ~ '^[A-Z]{2}$'),
  constraint countries_number_locale_bicimi
    check (number_locale ~ '^[a-z]{2,3}-[A-Z]{2}$')
);

comment on table public.countries is
  'ISO 3166-1 alpha-2 ulkeler. Yeni ulke = BIR SATIR; kod degisikligi yok.';
comment on column public.countries.default_currency is
  'Ulkenin olagan para birimi. ONERIDIR -- teklifin para birimini belirlemez.';
comment on column public.countries.number_locale is
  'Sayi/para bicimi icin BCP-47 etiketi. Ceviri gerektirmez, bugun calisir.';


-- ---------------------------------------------------------------------------
-- 4) markets — ticari bölge
-- ---------------------------------------------------------------------------
create table public.markets (
  code             text primary key,
  name_en          text not null,

  /*
   * NULL SERBEST VE ANLAMLIDIR: "tek bir varsayılan yok".
   *
   * NORDICS beş ülkede dört para birimi (DKK, EUR, ISK, NOK, SEK), GCC
   * altı ülkede altı para birimi taşıyor. Bunlardan birini seçip
   * varsayılan yazmak, operatörün fark etmeyeceği bir tahmin olurdu ve
   * yanlış para biriminde açılmış bir kaynak sessizce yanlış fiyat
   * üretirdi. NULL, operatörü SÖYLEMEYE zorlar -- fail-closed.
   *
   * ⛔ `default_locale` sütunu BİLEREK YOK. EU 27 ülke ve ~23 dil demek;
   * pazarı tek bir dile zorlamak, modelin çözmeye çalıştığı hatanın ta
   * kendisiydi. Dil ÜLKE üzerinde tutulur.
   */
  default_currency char(3) references public.currencies (code),
  is_active        boolean not null default true,

  constraint markets_code_bicimi check (code ~ '^[A-Z][A-Z0-9_]{1,15}$')
);

comment on table public.markets is
  'Ticari bolge. Az sayida ve stratejiktir; ulkeler gibi sik degismez. '
  'Para birimi ZORLAMASI YOKTUR ve dil TASIMAZ -- dil ulke uzerindedir.';
comment on column public.markets.default_currency is
  'Pazarin olagan para birimi. NULL = tek bir varsayilan yok (NORDICS, GCC, ANZ).';


-- ---------------------------------------------------------------------------
-- 5) market_countries — ÇOKLU ÜYELİK
-- ---------------------------------------------------------------------------
/*
 * BİR ÜLKE BİRDEN FAZLA PAZARDA OLABİLİR.
 *
 * İsveç hem NORDICS hem EU üyesidir; Norveç ve İzlanda yalnızca NORDICS
 * (AB üyesi değiller). Tek skaler bir `market` sütunu bunu ifade EDEMEZDİ
 * -- bu join tablosunun varlık sebebi tam olarak budur.
 *
 * `on delete restrict` ülke tarafında: bir pazara bağlı ülkeyi silmek,
 * o pazarın kapsamını sessizce daraltmak olurdu.
 */
create table public.market_countries (
  market_code  text    not null references public.markets (code)   on delete cascade,
  country_code char(2) not null references public.countries (code) on delete restrict,
  primary key (market_code, country_code)
);

create index market_countries_country_idx
  on public.market_countries (country_code);

comment on table public.market_countries is
  'Pazar-ulke uyeligi. COKLU: bir ulke birden fazla pazarda olabilir '
  '(Isvec hem NORDICS hem EU).';


-- ===========================================================================
-- TOHUM VERİSİ
-- ===========================================================================

-- --- para birimleri (21) ---------------------------------------------------
insert into public.currencies (code, name_en, minor_unit, symbol) values
  ('TRY', 'Turkish lira',          2, '₺'),
  ('EUR', 'Euro',                  2, '€'),
  ('GBP', 'Pound sterling',        2, '£'),
  ('USD', 'United States dollar',  2, '$'),
  ('CAD', 'Canadian dollar',       2, '$'),
  ('AUD', 'Australian dollar',     2, '$'),
  ('NZD', 'New Zealand dollar',    2, '$'),
  ('SEK', 'Swedish krona',         2, 'kr'),
  ('NOK', 'Norwegian krone',       2, 'kr'),
  ('DKK', 'Danish krone',          2, 'kr'),
  ('ISK', 'Icelandic krona',       0, 'kr'),   -- alt birimi YOK
  ('CZK', 'Czech koruna',          2, 'Kč'),
  ('HUF', 'Hungarian forint',      2, 'Ft'),
  ('PLN', 'Polish zloty',          2, 'zł'),
  ('RON', 'Romanian leu',          2, 'lei'),
  ('AED', 'UAE dirham',            2, 'د.إ'),
  ('SAR', 'Saudi riyal',           2, '﷼'),
  ('QAR', 'Qatari riyal',          2, '﷼'),
  ('KWD', 'Kuwaiti dinar',         3, 'د.ك'),  -- UC haneli
  ('BHD', 'Bahraini dinar',        3, '.د.ب'), -- UC haneli
  ('OMR', 'Omani rial',            3, '﷼')     -- UC haneli
on conflict (code) do nothing;

-- --- diller (27) -----------------------------------------------------------
-- is_supported = true YALNIZCA cevirisi olan uc dil icin.
insert into public.locales (code, name_en, is_supported) values
  ('tr', 'Turkish',    true),
  ('de', 'German',     true),
  ('en', 'English',    true),
  ('ar', 'Arabic',     false),
  ('bg', 'Bulgarian',  false),
  ('cs', 'Czech',      false),
  ('da', 'Danish',     false),
  ('el', 'Greek',      false),
  ('es', 'Spanish',    false),
  ('et', 'Estonian',   false),
  ('fi', 'Finnish',    false),
  ('fr', 'French',     false),
  ('hr', 'Croatian',   false),
  ('hu', 'Hungarian',  false),
  ('is', 'Icelandic',  false),
  ('it', 'Italian',    false),
  ('lt', 'Lithuanian', false),
  ('lv', 'Latvian',    false),
  ('mt', 'Maltese',    false),
  ('nb', 'Norwegian Bokmal', false),
  ('nl', 'Dutch',      false),
  ('pl', 'Polish',     false),
  ('pt', 'Portuguese', false),
  ('ro', 'Romanian',   false),
  ('sk', 'Slovak',     false),
  ('sl', 'Slovenian',  false),
  ('sv', 'Swedish',    false)
on conflict (code) do nothing;

-- --- ülkeler (41) ----------------------------------------------------------
-- AB-27 + Turkiye + UK + US + CA + AU/NZ + IS/NO + Korfez 6.
insert into public.countries (code, name_en, default_currency, default_locale, number_locale) values
  -- Avrupa Birligi (27)
  ('AT', 'Austria',        'EUR', 'de', 'de-AT'),
  ('BE', 'Belgium',        'EUR', 'nl', 'nl-BE'),
  ('BG', 'Bulgaria',       'EUR', 'bg', 'bg-BG'),  -- EUR: 1 Ocak 2026
  ('HR', 'Croatia',        'EUR', 'hr', 'hr-HR'),
  ('CY', 'Cyprus',         'EUR', 'el', 'el-CY'),
  ('CZ', 'Czechia',        'CZK', 'cs', 'cs-CZ'),
  ('DK', 'Denmark',        'DKK', 'da', 'da-DK'),
  ('EE', 'Estonia',        'EUR', 'et', 'et-EE'),
  ('FI', 'Finland',        'EUR', 'fi', 'fi-FI'),
  ('FR', 'France',         'EUR', 'fr', 'fr-FR'),
  ('DE', 'Germany',        'EUR', 'de', 'de-DE'),
  ('GR', 'Greece',         'EUR', 'el', 'el-GR'),
  ('HU', 'Hungary',        'HUF', 'hu', 'hu-HU'),
  ('IE', 'Ireland',        'EUR', 'en', 'en-IE'),
  ('IT', 'Italy',          'EUR', 'it', 'it-IT'),
  ('LV', 'Latvia',         'EUR', 'lv', 'lv-LV'),
  ('LT', 'Lithuania',      'EUR', 'lt', 'lt-LT'),
  ('LU', 'Luxembourg',     'EUR', 'fr', 'fr-LU'),
  ('MT', 'Malta',          'EUR', 'mt', 'mt-MT'),
  ('NL', 'Netherlands',    'EUR', 'nl', 'nl-NL'),
  ('PL', 'Poland',         'PLN', 'pl', 'pl-PL'),
  ('PT', 'Portugal',       'EUR', 'pt', 'pt-PT'),
  ('RO', 'Romania',        'RON', 'ro', 'ro-RO'),
  ('SK', 'Slovakia',       'EUR', 'sk', 'sk-SK'),
  ('SI', 'Slovenia',       'EUR', 'sl', 'sl-SI'),
  ('ES', 'Spain',          'EUR', 'es', 'es-ES'),
  ('SE', 'Sweden',         'SEK', 'sv', 'sv-SE'),
  -- Turkiye
  ('TR', 'Turkiye',        'TRY', 'tr', 'tr-TR'),
  -- Birlesik Krallik / Kuzey Amerika
  ('GB', 'United Kingdom', 'GBP', 'en', 'en-GB'),
  ('US', 'United States',  'USD', 'en', 'en-US'),
  ('CA', 'Canada',         'CAD', 'en', 'en-CA'),  -- fr-CA ileride alternatif
  -- Okyanusya
  ('AU', 'Australia',      'AUD', 'en', 'en-AU'),
  ('NZ', 'New Zealand',    'NZD', 'en', 'en-NZ'),
  -- Iskandinavya (AB disi)
  ('IS', 'Iceland',        'ISK', 'is', 'is-IS'),
  ('NO', 'Norway',         'NOK', 'nb', 'nb-NO'),
  -- Korfez
  ('AE', 'United Arab Emirates', 'AED', 'ar', 'ar-AE'),
  ('SA', 'Saudi Arabia',   'SAR', 'ar', 'ar-SA'),
  ('QA', 'Qatar',          'QAR', 'ar', 'ar-QA'),
  ('KW', 'Kuwait',         'KWD', 'ar', 'ar-KW'),
  ('BH', 'Bahrain',        'BHD', 'ar', 'ar-BH'),
  ('OM', 'Oman',           'OMR', 'ar', 'ar-OM')
on conflict (code) do nothing;

-- --- pazarlar (8) ----------------------------------------------------------
-- default_currency NULL = tek bir varsayilan YOK; operator soylemek zorunda.
insert into public.markets (code, name_en, default_currency) values
  ('TR',      'Turkiye',               'TRY'),
  ('EU',      'European Union',        'EUR'),
  ('UK',      'United Kingdom',        'GBP'),
  ('US',      'United States',         'USD'),
  ('CA',      'Canada',                'CAD'),
  ('ANZ',     'Australia/New Zealand',  null),
  ('NORDICS', 'Nordics',                null),
  ('GCC',     'Gulf Cooperation Council', null)
on conflict (code) do nothing;

-- --- pazar-ülke üyelikleri (44) --------------------------------------------
-- DK, FI, SE BILEREK IKI KEZ gecer: hem EU hem NORDICS.
insert into public.market_countries (market_code, country_code) values
  ('TR', 'TR'),
  ('UK', 'GB'),
  ('US', 'US'),
  ('CA', 'CA'),
  ('ANZ', 'AU'), ('ANZ', 'NZ'),
  ('NORDICS', 'DK'), ('NORDICS', 'FI'), ('NORDICS', 'IS'),
  ('NORDICS', 'NO'), ('NORDICS', 'SE'),
  ('GCC', 'AE'), ('GCC', 'SA'), ('GCC', 'QA'),
  ('GCC', 'KW'), ('GCC', 'BH'), ('GCC', 'OM'),
  ('EU', 'AT'), ('EU', 'BE'), ('EU', 'BG'), ('EU', 'HR'), ('EU', 'CY'),
  ('EU', 'CZ'), ('EU', 'DK'), ('EU', 'EE'), ('EU', 'FI'), ('EU', 'FR'),
  ('EU', 'DE'), ('EU', 'GR'), ('EU', 'HU'), ('EU', 'IE'), ('EU', 'IT'),
  ('EU', 'LV'), ('EU', 'LT'), ('EU', 'LU'), ('EU', 'MT'), ('EU', 'NL'),
  ('EU', 'PL'), ('EU', 'PT'), ('EU', 'RO'), ('EU', 'SK'), ('EU', 'SI'),
  ('EU', 'ES'), ('EU', 'SE')
on conflict (market_code, country_code) do nothing;


-- ===========================================================================
-- YETKİLER — referans verisi VİTRİNE AÇIK
-- ===========================================================================
-- Bu tablolar ticari sır taşımaz: ulke adlari, para birimleri ve diller
-- zaten kamuya acik bilgidir. Vitrin bunlari okuyabilmeli (para biciminden
-- dil secimine kadar). `is_active` suzgeci politikada duruyor: kapatilan bir
-- ulke istemciye hic gorunmez.
alter table public.currencies       enable row level security;
alter table public.locales          enable row level security;
alter table public.countries        enable row level security;
alter table public.markets          enable row level security;
alter table public.market_countries enable row level security;

create policy "currencies_public_read" on public.currencies
  for select using (is_active);
create policy "currencies_admin_all" on public.currencies
  for all using (public.is_admin()) with check (public.is_admin());

create policy "locales_public_read" on public.locales
  for select using (true);
create policy "locales_admin_all" on public.locales
  for all using (public.is_admin()) with check (public.is_admin());

create policy "countries_public_read" on public.countries
  for select using (is_active);
create policy "countries_admin_all" on public.countries
  for all using (public.is_admin()) with check (public.is_admin());

create policy "markets_public_read" on public.markets
  for select using (is_active);
create policy "markets_admin_all" on public.markets
  for all using (public.is_admin()) with check (public.is_admin());

create policy "market_countries_public_read" on public.market_countries
  for select using (true);
create policy "market_countries_admin_all" on public.market_countries
  for all using (public.is_admin()) with check (public.is_admin());

grant select on
  public.currencies, public.locales, public.countries,
  public.markets, public.market_countries
  to anon, authenticated;


-- ===========================================================================
-- KENDİ KENDİNİ DOĞRULAYAN KONTROL
-- ===========================================================================
-- Yorum yalan soyleyebilir; iddia soyleyemez.
do $$
declare
  v_sayi   int;
  v_eksik  text;
begin
  -- 1) Tohum sayilari
  select count(*) into v_sayi from public.currencies;
  if v_sayi <> 21 then raise exception 'BASARISIZ: 21 para birimi bekleniyordu, %', v_sayi; end if;

  select count(*) into v_sayi from public.locales;
  if v_sayi <> 27 then raise exception 'BASARISIZ: 27 dil bekleniyordu, %', v_sayi; end if;

  select count(*) into v_sayi from public.countries;
  if v_sayi <> 41 then raise exception 'BASARISIZ: 41 ulke bekleniyordu, %', v_sayi; end if;

  select count(*) into v_sayi from public.markets;
  if v_sayi <> 8 then raise exception 'BASARISIZ: 8 pazar bekleniyordu, %', v_sayi; end if;

  select count(*) into v_sayi from public.market_countries;
  if v_sayi <> 44 then raise exception 'BASARISIZ: 44 uyelik bekleniyordu, %', v_sayi; end if;

  -- 2) AB tam olarak 27 ulke
  select count(*) into v_sayi from public.market_countries where market_code = 'EU';
  if v_sayi <> 27 then raise exception 'BASARISIZ: EU 27 ulke tasimaliydi, %', v_sayi; end if;

  -- 3) NORDICS tam olarak DK/FI/IS/NO/SE
  select string_agg(country_code, ',' order by country_code) into v_eksik
    from public.market_countries where market_code = 'NORDICS';
  if v_eksik <> 'DK,FI,IS,NO,SE' then
    raise exception 'BASARISIZ: NORDICS kapsami yanlis: %', v_eksik;
  end if;

  -- 4) CAKISMA GERCEKTEN VAR MI -- modelin varlik sebebi
  select string_agg(country_code, ',' order by country_code) into v_eksik
    from (select country_code from public.market_countries
           group by country_code having count(*) > 1) t;
  if v_eksik is not distinct from null or v_eksik <> 'DK,FI,SE' then
    raise exception
      'BASARISIZ: coklu uyelik DK,FI,SE olmaliydi, bulunan: %', coalesce(v_eksik, '(yok)');
  end if;

  -- 5) UC HANELI PARA BIRIMLERI -- para yolu; sessiz 10 kat hata buradan cikardi
  select string_agg(code, ',' order by code) into v_eksik
    from public.currencies where minor_unit = 3;
  if v_eksik <> 'BHD,KWD,OMR' then
    raise exception 'BASARISIZ: 3 haneli para birimleri BHD,KWD,OMR olmaliydi: %', v_eksik;
  end if;
  if (select minor_unit from public.currencies where code = 'ISK') <> 0 then
    raise exception 'BASARISIZ: ISK alt birimi 0 olmaliydi';
  end if;

  -- 6) Desteklenen diller YALNIZCA cevirisi olan uc dil
  select string_agg(code, ',' order by code) into v_eksik
    from public.locales where is_supported;
  if v_eksik <> 'de,en,tr' then
    raise exception 'BASARISIZ: desteklenen diller de,en,tr olmaliydi: %', v_eksik;
  end if;

  -- 7) Yetim referans yok (FK zaten engeller ama tohum eksikligi de yakalanmali)
  select string_agg(code, ',' order by code) into v_eksik
    from public.countries c
   where not exists (select 1 from public.currencies x where x.code = c.default_currency)
      or not exists (select 1 from public.locales   l where l.code = c.default_locale);
  if v_eksik is not null then
    raise exception 'BASARISIZ: su ulkelerin para birimi/dili tohumda yok: %', v_eksik;
  end if;

  -- 8) MEVCUT MERCHANT ULKELERI KAPSANIYOR MU -- M2'nin FK'si buna bagli
  select string_agg(distinct country_code, ',') into v_eksik
    from public.merchants
   where country_code is not null
     and not exists (select 1 from public.countries c where c.code = merchants.country_code);
  if v_eksik is not null then
    raise exception
      'BASARISIZ: su merchant ulkeleri tohumda YOK, M2 yabanci anahtari duserdi: %', v_eksik;
  end if;

  -- 9) BU GOC MEVCUT SEMAYA DOKUNMADI: enum ve eski kisitlar YERINDE olmali
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'market') then
    raise exception 'BASARISIZ: public.market enum''u dusurulmus -- M1 ekleyici olmaliydi';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_market_currency_uyumlu') then
    raise exception 'BASARISIZ: eski uyum kisiti dusurulmus -- o M2''nin isi';
  end if;

  raise notice
    '✓ Cografi referans verisi kuruldu: 21 para birimi (3 tanesi uc haneli, ISK sifir), '
    '27 dil (3 destekli), 41 ulke, 8 pazar, 44 uyelik (DK/FI/SE cift). '
    'Mevcut semaya dokunulmadi.';
end $$;
