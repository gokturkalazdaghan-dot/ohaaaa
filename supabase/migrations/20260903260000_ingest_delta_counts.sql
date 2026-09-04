-- ===========================================================================
-- ingest_runs — DELTA SAYILARI
-- ---------------------------------------------------------------------------
-- Mevcut sayaçlar (items_created / items_updated) alım hattının VERİTABANINA
-- NE YAPTIĞINI söylüyor. Delta sayaçları ise KAYNAĞIN NE YAPTIĞINI söylüyor
-- ve bu iki soru farklı:
--
--   items_created = 0, items_updated = 0
--
-- tek başına iki çok farklı durumu aynı gösterir:
--   (a) feed geldi, hiçbir şey değişmemişti  → sağlıklı
--   (b) feed geldi ama hepsi elendi           → arıza
--
-- items_unchanged bu ikisini ayırıyor. Aynı şekilde items_deleted, bir
-- kaynağın sessizce ürün kaybetmeye başladığını gösteren tek sinyal.
--
-- ESKİ SATIRLARLA UYUM
-- Varsayılan 0 ve NOT NULL: geçmiş çalışmalar delta'dan önce olduğu için
-- sayıları yok. Sıfır burada "ölçülmedi" anlamına geliyor ve bu kabul
-- edilebilir -- alternatif NULL olurdu, ama o zaman her okuma yerinde
-- NULL kontrolü gerekirdi ve sayaçlar toplanamaz hâle gelirdi.
-- ===========================================================================

alter table public.ingest_runs
  add column items_new       integer not null default 0 check (items_new >= 0),
  add column items_changed   integer not null default 0 check (items_changed >= 0),
  add column items_unchanged integer not null default 0 check (items_unchanged >= 0),
  add column items_deleted   integer not null default 0 check (items_deleted >= 0),
  /*
   * Bu çalışmada silme DEĞERLENDİRİLDİ Mİ?
   *
   * `items_deleted = 0` iki anlama gelebilir: "hiçbir şey silinmedi" ya da
   * "kısmi görüntü olduğu için silmeye hiç bakılmadı". İkisini ayırmak
   * şart -- birincisi sağlık, ikincisi eksik bir tur.
   */
  add column snapshot_complete boolean not null default false;

comment on column public.ingest_runs.items_unchanged is
  'Parmak izi degismedigi icin HIC YAZILMAYAN kalem sayisi. '
  'items_created=0 + items_updated=0 durumunun saglikli mi arizali mi '
  'oldugunu ayirt eden sayac.';

comment on column public.ingest_runs.snapshot_complete is
  'Bu turda kaynak anlik goruntusu TAM miydi? false ise bayatlatma/silme '
  'hic degerlendirilmedi; items_deleted=0 "silinmedi" DEGIL "bakilmadi" demek.';

/*
 * DELTA SAYAÇLARI GÖRÜLEN KALEMİ AŞAMAZ.
 *
 * NEW + CHANGED + UNCHANGED, kaynaktan gelen kalem sayısından fazla
 * olamaz. Aşarsa sayaçlar iki kez artırılıyor demektir -- ve bu, kimsenin
 * fark etmeyeceği türden bir hata. DELETED dışarıda çünkü o, kaynakta
 * OLMAYAN kayıtları sayar.
 */
alter table public.ingest_runs
  add constraint ingest_runs_delta_tutarli
  check (items_new + items_changed + items_unchanged <= items_seen);
