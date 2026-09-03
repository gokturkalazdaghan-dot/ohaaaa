-- ===========================================================================
-- sources.next_refresh_at — uyarlanabilir yoklamanın kalıcı tarafı
-- ---------------------------------------------------------------------------
-- MEVCUT ZAMANLAMA KORUNUYOR
-- `schedule_cron` SİLİNMİYOR. İkisi farklı soruları yanıtlıyor:
--   schedule_cron    — bu kaynak EN FAZLA hangi sıklıkta yoklanabilir
--   next_refresh_at  — bu kaynak BİR SONRAKİ ne zaman yoklanmalı
--
-- Cron bir tavan, next_refresh_at ise bir öneri. Cron'u kaldırmak,
-- uyarlanabilir hesap bozulduğunda hiçbir alt sınır bırakmamak olurdu.
--
-- NEDEN NULL BAŞLIYOR
-- Varsayılan `now()` vermek, hiç ölçülmemiş her kaynağı "şimdi yoklanmalı"
-- diye işaretlerdi. NULL burada dürüst: henüz plan hesaplanmadı. Bir
-- zamanlayıcı NULL'ı "cron'a göre davran" diye okumalı.
-- ===========================================================================

alter table public.sources
  add column next_refresh_at timestamptz,
  /*
   * Sınıf ve gerekçeler AYRICA saklanıyor.
   *
   * Yalnızca zaman damgası saklansaydı "neden 23 dakika sonra?" sorusu
   * cevapsız kalırdı. Bir zamanlama kararı, sebebini taşımadığında hata
   * ayıklanamaz -- ve operatör onu ancak körü körüne kabul edebilir.
   */
  add column refresh_class text
    check (refresh_class is null or
           refresh_class in ('VERY_HOT', 'HOT', 'ACTIVE', 'NORMAL', 'COLD')),
  add column refresh_reasons jsonb not null default '[]'::jsonb,
  add column refresh_planned_at timestamptz;

comment on column public.sources.next_refresh_at is
  'Uyarlanabilir yoklamanin onerdigi sonraki kontrol ani. NULL = henuz plan '
  'hesaplanmadi; zamanlayici bu durumda schedule_cron''a gore davranmali.';
comment on column public.sources.refresh_class is
  'Son hesaplanan tazelik sinifi. Kararin GEREKCESI refresh_reasons''ta.';
comment on column public.sources.refresh_reasons is
  'Planin hangi sinyallerden ciktigi. Sebebini tasimayan bir zamanlama '
  'karari hata ayiklanamaz.';

/*
 * ZAMANLAYICI SORGUSUNUN İNDEKSİ.
 *
 * "Şimdi yoklanması gerekenler" sorgusu `next_refresh_at <= now()` ile
 * gelecek. Kısmi indeks yalnızca etkin kaynakları kapsıyor: devre dışı
 * bırakılmış bir kaynak zaten aday değil.
 */
create index sources_next_refresh_idx
  on public.sources (next_refresh_at)
  where is_enabled and next_refresh_at is not null;
