-- ============================================================================
-- Alım hatalarının SINIFI
-- ----------------------------------------------------------------------------
-- `ingest_runs.error` ve `sources.last_error` insana ne olduğunu söylüyordu
-- ama makineye hiçbir şey söylemiyordu. Sonuç: "secret eksik" ile "sağlayıcı
-- bir an düştü" aynı sütunda aynı görünüyor, operatör hangisini
-- düzelteceğini metni okuyarak tahmin etmek zorunda kalıyordu. Sayılamıyordu
-- da: "bu hafta kaç kimlik doğrulama hatası aldık" sorusunun cevabı yoktu.
--
-- SINIF METİNDEN TÜRETİLMEZ, AYRI TAŞINIR.
-- Hata cümlesine bakarak sınıflandırma, birisi bir cümleyi düzelttiğinde
-- sessizce bozulur. Karar TypeScript tarafında (`classifyIngestError`)
-- veriliyor ve sonucu buraya yazılıyor.
--
-- Sütunlar NULL kabul eder: geçmiş kayıtların sınıfı yok ve olmayan bir
-- bilgiyi uydurmak yerine boş bırakmak doğrudur. Yeni bir tablo ya da yeni
-- bir hata mekanizması YOK -- yalnızca mevcut iki satıra bir alan.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ingest_error_class') then
    create type public.ingest_error_class as enum (
      'CONFIG_ERROR',
      'AUTH_ERROR',
      'NETWORK_ERROR',
      'HTTP_ERROR',
      'PARSER_ERROR',
      'VALIDATION_ERROR',
      'DATABASE_ERROR',
      'SECURITY_ERROR',
      'UNKNOWN_ERROR'
    );
  end if;
end $$;

comment on type public.ingest_error_class is
  'Alim hatasinin sinifi. Karar TypeScript tarafinda verilir; burada yalnizca '
  'saklanir. Enum secildi cunku serbest metin, zamanla ayni seyin bes farkli '
  'yazimina donusur ve gruplama anlamsizlasir.';

alter table public.ingest_runs
  add column if not exists error_class public.ingest_error_class;

comment on column public.ingest_runs.error_class is
  'Bu turu dusuren hatanin sinifi. NULL = tur basarili ya da sinif kaydedilmemis '
  '(bu surumden onceki kayitlar).';

alter table public.sources
  add column if not exists last_error_class public.ingest_error_class;

comment on column public.sources.last_error_class is
  'Son turun hata sinifi. Panelde "neyi duzeltmem gerekiyor" sorusunu '
  'metin okumadan cevaplar: CONFIG_ERROR operatorun isi, NETWORK_ERROR beklemek.';

-- Hata sınıfına göre sorgulama, izlemenin temel sorusudur ("son 24 saatte
-- hangi sınıf arttı"). Yalnızca hatalı turlar indeksleniyor: başarılı
-- turlarda sütun NULL ve onları indekslemek indeksi gereksiz büyütürdü.
create index if not exists ingest_runs_error_class_idx
  on public.ingest_runs (error_class, started_at desc)
  where error_class is not null;
