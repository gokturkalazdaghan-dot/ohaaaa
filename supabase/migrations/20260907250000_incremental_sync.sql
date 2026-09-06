-- ===========================================================================
-- ARTIMLI SENKRONİZASYON — tam katalog taraması zorunlu olmaktan çıkıyor
-- ===========================================================================
--
-- ÇÖZÜLEN SOMUT PROBLEM
--
-- Bugün her alım turu feed'in TAMAMINI indiriyor ve her satırı yazıyor.
-- Bir kaynak için bu makul. Yüz milyon ürüne giden bir katalogda değil:
--
--   • 50 milyon satırlık bir feed'i 6 saatte bir baştan işlemek, değişmeyen
--     %99'u boşuna yazmak demektir -- ve her boşuna yazma bir `updated_at`
--     tazeler, bir indeks satırı çürütür, bir replikasyon baytı üretir.
--   • Tur bir kez düşerse baştan başlar. Yeterince büyük bir feed'de "baştan"
--     hiçbir zaman bitmez: tur, bir sonraki tur başlamadan tamamlanamaz.
--
-- Bu göç üç ayrı mekanizmayı ekliyor ve üçü BİRBİRİNİN YEDEĞİ değil,
-- farklı durumlar için:
--
--   http_etag / http_last_modified   Sunucu "değişmedi" diyebiliyorsa (304)
--                                    tek bayt bile indirilmez. En ucuzu.
--   sync_watermark                   Feed "şu tarihten sonra değişenler"
--                                    sorgusunu destekliyorsa yalnız delta.
--   sync_cursor                      Sayfalı API'lerde kalınan yer. Tur
--                                    düşerse BAŞTAN değil, kaldığı yerden.
--
-- Hiçbiri desteklenmiyorsa davranış BUGÜNKÜYLE AYNI kalır: tam tarama.
-- Yani bu göç bir zorunluluk getirmiyor, bir imkân açıyor.
--
-- ---------------------------------------------------------------------------
-- NEDEN NULL VARSAYILAN
-- ---------------------------------------------------------------------------
-- Her alan NULL başlıyor: "bu kaynak artımlı senkronizasyonu destekliyor mu"
-- sorusunu HENÜZ BİLMİYORUZ. Varsayılan bir değer koymak, doğrulanmamış bir
-- yeteneği beyan etmek olurdu -- ve ilk turda feed'in yarısı sessizce
-- atlanırdı.
-- ===========================================================================

create type public.sync_mode as enum (
  'full',        -- her turda tam tarama (bugunku davranis)
  'incremental'  -- yalniz degisenler
);

comment on type public.sync_mode is
  'Alim kipi. full varsayilan: dogrulanmamis bir artimli yetenegi beyan '
  'etmek, feed in yarisini sessizce atlamak olurdu.';

alter table public.sources
  add column sync_mode public.sync_mode not null default 'full',

  /*
   * Sayfalı API'lerde kalınan yer. Ağa özgü opak bir değer -- ayrıştırmıyoruz
   * ve anlamlandırmıyoruz; yalnız saklayıp geri veriyoruz.
   */
  add column sync_cursor text,

  /*
   * "Şu andan sonra değişenler" sorgusunun sınırı. Tur BAŞARIYLA bitmeden
   * ilerletilmez: yarıda kalmış bir turda ilerletmek, işlenmemiş satırları
   * sonsuza kadar atlamak demektir.
   */
  add column sync_watermark timestamptz,

  /* Koşullu GET: sunucu "değişmedi" diyebiliyorsa tek bayt inmez. */
  add column http_etag text,
  add column http_last_modified text,

  /*
   * Sayfa başına satır. Sınırsız değil: tek partinin belleğe alınması
   * işçiyi düşürür ve o düşüş, en büyük feed'de en sık olur.
   */
  add column batch_size integer not null default 1000
    check (batch_size between 1 and 50000),

  /* Son tam taramanın anı. Artımlı kipte bile arada tam tarama gerekir: */
  /* silinen satırlar yalnız tam taramada fark edilir. */
  add column last_full_sync_at timestamptz;

comment on column public.sources.sync_cursor is
  'Sayfali API de kalinan yer. Opak: ayristirilmaz. Tur duserse BASTAN '
  'degil, kaldigi yerden devam edilir.';

comment on column public.sources.sync_watermark is
  'Artimli sorgunun siniri. Tur BASARIYLA bitmeden ilerletilmez -- yarida '
  'kalmis turda ilerletmek, islenmemis satirlari sonsuza kadar atlamaktir.';

comment on column public.sources.last_full_sync_at is
  'Son tam taramanin ani. Artimli kipte bile arada tam tarama gerekir: '
  'SILINEN satirlar yalnizca tam taramada fark edilir.';

/*
 * ARTIMLI KİP BİR DAYANAK İSTER.
 *
 * `incremental` seçilip ne cursor ne watermark ne de ETag varsa, alım hattı
 * "değişenleri getir" diyecek bir şey bulamaz ve pratikte HİÇBİR ŞEY
 * getirmez. Kaynak sessizce boşalır ve durum kodu bunu göstermez.
 *
 * İlk tur için üçünün de NULL olması meşru; bu yüzden kısıt
 * `last_full_sync_at`e bağlı: bir kez tam tarama yapıldıktan SONRA artımlı
 * kip bir dayanak taşımak zorunda.
 */
alter table public.sources
  add constraint sources_incremental_needs_anchor
    check (
      sync_mode = 'full'
      or last_full_sync_at is null
      or sync_cursor is not null
      or sync_watermark is not null
      or http_etag is not null
      or http_last_modified is not null
    );

-- Tam tarama sırası: en uzun süredir taranmayan önce. NULL en başta --
-- hiç tam taranmamış bir kaynağı beklemek onu hiç taramamaktır.
create index sources_full_sync_idx
  on public.sources (last_full_sync_at nulls first)
  where is_enabled;

-- ---------------------------------------------------------------------------
-- TEKLİF TARAFI: DELTA İÇİN İMZA
-- ---------------------------------------------------------------------------
-- `products` üzerinde zaten `offer_fingerprint` var (20260903164547).
-- Eksik olan, artımlı turda "bu satır değişti mi" sorusunu TEK indeksle
-- yanıtlayan erişim yolu: kaynak + son görülme.
create index if not exists products_source_seen_idx
  on public.products (merchant_id, last_seen_at)
  where merchant_id is not null;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.sources limit 1;

  if v_id is null then
    -- Kaynak yoksa kisitlar yine de dogrulanabilir: varsayilanlari kontrol et.
    if (select count(*) from information_schema.columns
         where table_schema='public' and table_name='sources'
           and column_name in ('sync_mode','sync_cursor','sync_watermark',
                               'http_etag','http_last_modified','batch_size',
                               'last_full_sync_at')) <> 7 then
      raise exception 'DOGRULAMA 0: yedi artimli senkronizasyon sutunu eklenmedi.';
    end if;
    raise notice 'Kaynak yok; davranis dogrulamalari atlandi, sema dogrulandi.';
    return;
  end if;

  -- 1) Varsayilan kip FULL: bugunku davranis degismiyor.
  if (select sync_mode from public.sources where id = v_id) <> 'full' then
    raise exception 'DOGRULAMA 1: varsayilan kip full degil -- mevcut davranis degisirdi.';
  end if;

  -- 2) Parti boyutu sinirsiz olamaz.
  begin
    update public.sources set batch_size = 100000 where id = v_id;
    raise exception 'DOGRULAMA 2: sinirsiz parti boyutu kabul edildi -- isci duserdu.';
  exception when check_violation then null;
  end;

  -- 3) TAM TARAMA YAPILMISKEN dayanaksiz artimli kip REDDEDILIYOR.
  update public.sources set last_full_sync_at = now() where id = v_id;
  begin
    update public.sources set sync_mode = 'incremental' where id = v_id;
    raise exception
      'DOGRULAMA 3: dayanaksiz artimli kip kabul edildi -- kaynak sessizce '
      'bosalirdi ve durum kodu bunu gostermezdi.';
  exception when check_violation then null;
  end;

  -- 4) Dayanak varsa artimli kip serbest: kapatma fazla kapatmamis.
  update public.sources set sync_watermark = now(), sync_mode = 'incremental' where id = v_id;

  -- 5) Ilk tur icin (hic tam tarama yokken) dayanak beklenmiyor.
  update public.sources
     set sync_mode = 'full', sync_watermark = null, last_full_sync_at = null
   where id = v_id;
  update public.sources set sync_mode = 'incremental' where id = v_id;

  -- Temizlik: kaynagi bulundugu hale dondur.
  update public.sources
     set sync_mode = 'full', sync_cursor = null, sync_watermark = null,
         http_etag = null, http_last_modified = null, batch_size = 1000,
         last_full_sync_at = null
   where id = v_id;

  raise notice
    'Artimli senkronizasyon kuruldu: varsayilan full, dayanaksiz artimli kip '
    'reddediliyor, parti boyutu sinirli, tam tarama sirasi indekslendi.';
end $$;
