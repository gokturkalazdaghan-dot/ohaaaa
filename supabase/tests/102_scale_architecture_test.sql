-- ===========================================================================
-- 102 — global ölçek: kanonik ürün, ağ bağları, artımlı senkronizasyon
-- ===========================================================================
--
-- Bu dosyanın merkezindeki üç tehlike, hepsi SESSİZ ve hepsi yalnız ÖLÇEKTE
-- görünür olanlar:
--
--   1. Aynı ürünün her feed'de yeni kanonik satır açması. Katalog aynı
--      telefonu 400 kez gösterir, fiyat karşılaştırması kendi kendiyle
--      yapılır ve bu hiçbir hata üretmez.
--   2. Aynı mağazanın her ağ için ayrı merchant satırı olması -- ya da tek
--      satırın ağ alanının en son yazana göre değişmesi, yani deeplink'in
--      yanlış ağın izleme kimliğiyle gitmesi.
--   3. Dayanaksız artımlı kip: kaynak sessizce boşalır, durum kodu bunu
--      göstermez.
begin;
select plan(26);

-- =========================================================================
-- KANONİK ÜRÜN KİMLİĞİ
-- =========================================================================
select is(
  (select count(*)::int from pg_indexes
    where schemaname='public' and tablename='product_groups'
      and indexname='product_groups_canonical_key_idx'),
  1, '1) kanonik anahtar TEKIL -- on conflict in dayanagi budur');

select is(public.normalize_gtin('012345678905'), public.normalize_gtin('0012345678905'),
  '2) UPC-12 ve EAN-13 ayni degere iniyor');

select is(public.normalize_gtin('0-12345-67890-5'), '00012345678905',
  '3) tireli gosterim de ayni degere iniyor');

select is(public.normalize_gtin('123'), null,
  '4) gecersiz uzunluk NULL -- 0 ya da bos metin bir DEGER gibi davranirdi');

select isnt(
  public.canonical_product_key('012345678905', null, null, 'X'),
  public.canonical_product_key(null, 'Marka', '012345678905', 'X'),
  '5) onek ayrimi: GTIN ile MPN anahtarlari cakisamaz');

select is(
  public.canonical_product_key(null, 'MARKA', null, 'Urun  cok   bosluklu'),
  public.canonical_product_key(null, 'marka', null, ' Urun cok bosluklu '),
  '6) bosluk ve buyuk/kucuk harf farki urunu BOLMUYOR');

-- --- 7-8: AYNI ÜRÜN İKİ FEED'DEN ------------------------------------------
insert into public.product_groups (slug, title, brand, gtin)
values ('olcek-a', 'Test Telefon 128GB', 'TestMarka', '012345678905');

select throws_ok(
  $$ insert into public.product_groups (slug, title, brand, gtin)
     values ('olcek-b', 'Test Telefon 128GB', 'TestMarka', '0012345678905') $$,
  '23505', null,
  '7) ayni urun ikinci kanonik satir ACAMIYOR -- katalog onu defalarca gosterirdi');

select lives_ok(
  $$ insert into public.product_groups (slug, title, brand, gtin)
     values ('olcek-c', 'Test Telefon 256GB', 'TestMarka', '0777000333000') $$,
  '8) FARKLI urun ayri kaliyor -- kapatma fazla kapatmamis');

-- --- 9: AYNI ÜRÜN FARKLI MERCHANT — teklifler ayrı, kanonik bir ------------
-- Kanonik anahtar magazayi ve agi HIC gormuyor; gorseydi ayni urun her
-- magazada ayri kanonik satir acar ve karsilastirma imkansizlasirdi.
select is(
  (select count(distinct canonical_key)::int from public.product_groups
    where slug in ('olcek-a', 'olcek-c')),
  2, '9) iki farkli urun iki anahtar; magaza/ag anahtara GIRMIYOR');

-- =========================================================================
-- MERCHANT ↔ AĞ BAĞLARI
-- =========================================================================
select has_table('public', 'merchant_network_links',
  '10) merchant ag baglari tablosu var -- merchant modeli agdan bagimsiz');

-- --- 11-14: aynı mağaza birden çok ağda -----------------------------------
--
-- FIKSTUR KENDI MAGAZASINI ACIYOR. Onceki hali alfabetik olarak ILK GERCEK
-- magazayi oduncu aliyordu. Bu, testi goc verisine baglar: 20260907340000
-- 'alison'i ekledigi anda ilk sira 'aosom-uk'tan 'alison'a gecti, Alison'in
-- zaten bir awin bagi vardi ve test -- sinadigi kisitla hicbir ilgisi olmayan
-- bir sebepten -- dustu.
--
-- Iki adet kendi magazasi, testi veriden bagimsiz ve YINELENEBILIR yapiyor.
insert into public.merchants (slug, display_name) values
  ('olcek-magaza-1', 'Olcek Magaza 1'),
  ('olcek-magaza-2', 'Olcek Magaza 2');

insert into public.merchant_network_links
  (merchant_id, network, network_program_id, commission_rate, is_primary)
select id, 'awin', 'OLCEK-MID-1', 0.10, true
  from public.merchants where slug = 'olcek-magaza-1';

select lives_ok(
  $$ insert into public.merchant_network_links
       (merchant_id, network, network_program_id, commission_rate)
     select id, 'direct', 'OLCEK-MID-1', 0.15
          from public.merchants where slug = 'olcek-magaza-1' $$,
  '11) AYNI MAGAZA iki agda bulunabiliyor ve komisyonlari FARKLI');

select throws_ok(
  $$ insert into public.merchant_network_links (merchant_id, network, network_program_id)
     select id, 'awin', 'OLCEK-MID-1'
          from public.merchants where slug = 'olcek-magaza-2' $$,
  '23505', null,
  '12) ayni ag programi iki magazaya baglanamiyor -- gelir mutabakati bozulurdu');

select throws_ok(
  $$ insert into public.merchant_network_links (merchant_id, network, network_program_id)
     select id, 'awin', 'OLCEK-MID-2'
          from public.merchants where slug = 'olcek-magaza-1' $$,
  '23505', null,
  '13) ayni magaza ayni agda iki kez listelenemiyor');

select throws_ok(
  $$ update public.merchant_network_links set is_primary = true
      where network = 'direct' and network_program_id = 'OLCEK-MID-1' $$,
  '23505', null,
  '14) birincil bag EN FAZLA BIR -- deeplink turdan tura farkli aga giderdi');

-- --- 15-16: mağaza kimliği ve marketplace uyumu ---------------------------
select is(
  public.registrable_domain('https://www.Ornek.example/yol?x=1'),
  public.registrable_domain('http://ornek.example'),
  '15) alan adi normalizasyonu: ayni magaza iki agda farkli adlarla listelenir');

-- Alan adi TEKIL DEGIL: iki gercek magaza ayni alan adi altinda yasayabilir
-- (bolgesel magazalar, alt markalar) ve tekillik onlari birlesmeye ZORLARDI.
select is(
  (select count(*)::int from pg_indexes
    where schemaname='public' and tablename='merchants'
      and indexname='merchants_canonical_domain_idx' and indexdef like 'CREATE INDEX%'),
  1, '16) alan adi indeksi TEKIL DEGIL -- birlestirme karari insanin');

-- =========================================================================
-- ARTIMLI SENKRONİZASYON
-- =========================================================================
select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='sources'
      and column_name in ('sync_mode','sync_cursor','sync_watermark',
                          'http_etag','http_last_modified','batch_size','last_full_sync_at')),
  7, '17) yedi artimli senkronizasyon sutunu eklendi');

select is(
  (select column_default from information_schema.columns
    where table_schema='public' and table_name='sources' and column_name='sync_mode'),
  '''full''::sync_mode', '18) varsayilan FULL -- mevcut davranis degismiyor');

-- --- 19-20: dayanaksız artımlı kip ve parti sınırı ------------------------
insert into public.sources (merchant_id, slug, name, kind, endpoint_url, market_code, last_full_sync_at)
select id, 'olcek-kaynak', 'Olcek Kaynak', 'feed_csv', 'https://ornek.example/feed.csv',
       (select code from public.markets order by code limit 1), now()
  from public.merchants where slug = 'olcek-magaza-1';

select throws_ok(
  $$ update public.sources set sync_mode = 'incremental' where slug = 'olcek-kaynak' $$,
  '23514', null,
  '19) dayanaksiz artimli kip REDDEDILIYOR -- kaynak sessizce bosalirdi');

select throws_ok(
  $$ update public.sources set batch_size = 100000 where slug = 'olcek-kaynak' $$,
  '23514', null,
  '20) sinirsiz parti boyutu reddediliyor -- isci EN BUYUK feed de duserdi');

-- =========================================================================
-- TEKLİF → KANONİK ÜRÜN BAĞI
-- =========================================================================
select has_column('public', 'products', 'canonical_key',
  '21) TEKLIF de kanonik anahtar tasiyor -- olmadan group_id hic dolmazdi');

-- 22-23: aynı ürün iki gösterimden TEK gruba
select is(
  public.resolve_canonical_group('0555000111008', 'OlcekMarka', null, 'Olcek Telefon'),
  public.resolve_canonical_group('00555000111008', 'OlcekMarka', null, 'Olcek Telefon'),
  '22) ayni urun iki gosterimden TEK kanonik gruba dusuyor');

select isnt(
  public.resolve_canonical_group('0555000111008', 'OlcekMarka', null, 'Olcek Telefon'),
  public.resolve_canonical_group('0777000333000', 'OlcekMarka', null, 'Baska Telefon'),
  '23) FARKLI urun ayri grup -- kapatma fazla kapatmamis');

-- 24: başlıksız teklif bağlanmıyor
select is(
  public.resolve_canonical_group(null, null, null, '   '),
  null::uuid,
  '24) basliksiz teklif baglanmiyor -- hepsi tek sahte urune yigilirdi');

-- 25: mevcut veri ezilmiyor
select is(
  (select brand from public.product_groups
    where id = public.resolve_canonical_group('0555000111008', null, null, 'Olcek Telefon')),
  'OlcekMarka',
  '25) ikinci feed ilk feed in verisini EZMIYOR');

-- 26: teklif ve grup ayni anahtari uretiyor
select is(
  (select canonical_key from public.product_groups
    where id = public.resolve_canonical_group('0555000111008', 'OlcekMarka', null, 'Olcek Telefon')),
  public.canonical_product_key('0555000111008', 'OlcekMarka', null, 'Olcek Telefon'),
  '26) teklif ve grup anahtarlari AYRISMIYOR');

select * from finish();
rollback;
