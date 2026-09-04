-- ===========================================================================
-- TEKLİF PARMAK İZİ — delta tespitinin kalıcı tarafı
-- ---------------------------------------------------------------------------
-- Delta sınıflandırması (NEW/CHANGED/UNCHANGED/DELETED) bir ÖNCEKİ durumu
-- bilmek zorunda. Bunu her seferinde tüm alanları karşılaştırarak yapmak
-- da mümkündü ama iki sorunu var: karşılaştırma mantığı iki yere (kod ve
-- SQL) dağılır, ve "hangi alanlar önemli" tanımı ikisinde ayrışabilir.
--
-- Tek bir özet sütunu, tanımı tek yerde tutuyor: canonicalFingerprint().
-- ===========================================================================

alter table public.products
  add column fingerprint text;

comment on column public.products.fingerprint is
  'canonicalFingerprint() ciktisi. Ayni ise teklif degismemistir. '
  'NULL = henuz delta ile islenmemis (eski satirlar).';

/*
 * İNDEKS (source_id, external_id) ÜZERİNDE.
 *
 * Alım hattı her turda "bu kaynağın bilinen parmak izleri" sorgusunu
 * atıyor. Kaynak başına on binlerce satır olabilir ve bu sorgu her
 * çalışmada bir kez, tam tablo taraması yapmadan dönmeli.
 */
create index products_source_fingerprint_idx
  on public.products (source_id, external_id)
  include (fingerprint)
  where source_id is not null;

grant select (fingerprint) on public.products to anon, authenticated;
