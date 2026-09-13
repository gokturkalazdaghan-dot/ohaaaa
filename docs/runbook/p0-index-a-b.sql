-- ============================================================
-- P0 — Index A + Index B, Supabase SQL Editor runbook
-- Onay: CTO, "INDEX REMEDIATION" (P0 outage istisnası)
-- Kapsam: YALNIZCA iki indeks. Başka hiçbir şeye dokunulmaz.
-- ============================================================
--
-- TANIMLAR NEREDEN GELDİ
-- Uydurulmadı; başarısız isteğin kendisinden türetildi (edge_logs):
--
--   GET 500 .../product_groups
--     ?select=id,slug,title,brand,image_url,offer_count,
--             min_price_cents,max_price_cents,best_offer_id
--     &offer_count=gt.0
--     &category_id=in.(c0000000-0000-4000-8000-000000000012)
--     &order=offer_count.desc.nullslast,title.asc.nullslast
--     &offset=0&limit=5
--
-- Sıralama yönleri BİREBİR eşleşmek zorunda: DESC'in varsayılanı
-- NULLS FIRST olduğu için `offer_count desc nulls last` AÇIKÇA yazılıyor.
-- Eşleşmezse planner indeksi sıralama için kullanamaz ve sort geri gelir.
--
-- YÖNTEM SEÇİMİ
-- Düz (CONCURRENTLY olmayan) CREATE INDEX, açık transaction içinde.
--   * Transactional: istemci/sunucu kesintisinde TEMİZ geri alınır,
--     INVALID indeks BIRAKMAZ. Önceki üç CONCURRENTLY denemesinin
--     bıraktığı hasar buydu.
--   * Tablo 34.721 satır / 33 MB -- ACCESS EXCLUSIVE kilit penceresi kısa.
--   * Site zaten >120 sn yanıt veriyor; kısa kilit, mevcut durumdan iyidir.
-- lock_timeout kilit kuyruğu oluşturmayı engeller: alamazsa çekilir.
--
-- statement_timeout NEDEN 3 DAKİKA (15 değil)
-- İndeks ~3,6 MB; sağlıklı bir örnekte saniyenin altında biter. Tavan,
-- sorunu gizlemek için değil, KİLİDİ BIRAKMAK için var: bu düz CREATE
-- INDEX süresince product_groups üzerinde ACCESS EXCLUSIVE kilit durur ve
-- katalog tamamen bloke olur. 15 dakikalık bir tavan, teşhis değeri
-- katmadan kataloğu 15 dakika kilitli tutabilirdi.
-- 3 dakikayı aşması BAŞLI BAŞINA BULGUDUR: 3,6 MB'lık bir yapı bu sürede
-- bitmiyorsa sorun indeks değildir. O durumda tavanı YÜKSELTME -- DUR ve
-- bildir.

-- ---------- ADIM 1: ÖN DURUM (çalıştır, çıktıyı sakla) ----------
select i.relname as indeks, x.indisvalid, x.indisready, pg_get_indexdef(i.oid) as tanim
from pg_index x
join pg_class i on i.oid = x.indexrelid
join pg_class t on t.oid = x.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relname = 'product_groups'
order by i.relname;
-- BEKLENEN: 10 indeks, hepsi indisvalid=true; A ve B YOK.
-- INVALID bir indeks görürsen DUR ve bildir.


-- ---------- ADIM 2: INDEX B (baskın hata yolu, ~349/354) ----------
begin;
set local lock_timeout = '10s';
set local statement_timeout = '3min';
set local maintenance_work_mem = '128MB';

create index if not exists product_groups_category_offers_idx
  on public.product_groups
     (category_id, offer_count desc nulls last, title asc nulls last)
  where offer_count > 0;

commit;
-- Hata alırsan: transaction geri alınır, artık kalmaz. ADIM 5'e geç ve bildir.


-- ---------- ADIM 3: INDEX A (kategorisiz varyant) ----------
begin;
set local lock_timeout = '10s';
set local statement_timeout = '3min';
set local maintenance_work_mem = '128MB';

create index if not exists product_groups_offers_idx
  on public.product_groups
     (offer_count desc nulls last, title asc nulls last)
  where offer_count > 0;

commit;


-- ---------- ADIM 4: DOĞRULAMA ----------
select i.relname as indeks,
       x.indisvalid  as gecerli,
       x.indisready  as hazir,
       pg_size_pretty(pg_relation_size(i.oid)) as boyut,
       pg_get_indexdef(i.oid) as tanim
from pg_index x
join pg_class i on i.oid = x.indexrelid
join pg_class t on t.oid = x.indrelid
where t.relname = 'product_groups'
  and i.relname in ('product_groups_category_offers_idx','product_groups_offers_idx');
-- BEKLENEN: 2 satır, ikisi de gecerli=true VE hazir=true.
-- gecerli=false gören olursa: o indeksi DROP et ve DUR.

-- Beklenmeyen/yinelenen indeks kalmadığını doğrula (toplam 12 olmalı):
select count(*) as toplam_indeks
from pg_index x join pg_class i on i.oid = x.indexrelid
join pg_class t on t.oid = x.indrelid where t.relname = 'product_groups';

-- INVALID kalıntı taraması (0 dönmeli):
select count(*) as gecersiz_indeks
from pg_index x join pg_class i on i.oid = x.indexrelid
join pg_class t on t.oid = x.indrelid
where t.relname = 'product_groups' and x.indisvalid = false;


-- ---------- ADIM 5: PLANNER GERÇEKTEN KULLANIYOR MU ----------
-- Başarısız olan sorgunun BİREBİR kendisi.
explain (analyze, buffers)
select id, slug, title, brand, image_url, offer_count,
       min_price_cents, max_price_cents, best_offer_id
from public.product_groups
where offer_count > 0
  and category_id in ('c0000000-0000-4000-8000-000000000012')
order by offer_count desc nulls last, title asc nulls last
offset 0 limit 5;
-- BAŞARI ÖLÇÜTÜ: planda "Index Scan using product_groups_category_offers_idx"
-- GÖRÜNMELİ ve "Sort" DÜĞÜMÜ OLMAMALI. Execution Time < 50 ms beklenir.
-- Hâlâ Seq Scan + Sort görüyorsan indeks kurulsa bile SORUN ÇÖZÜLMEDİ demektir.

-- Eşlik eden exact-count (169 HEAD 500'ün kaynağı):
explain (analyze, buffers)
select count(*) from public.product_groups
where offer_count > 0
  and category_id in ('c0000000-0000-4000-8000-000000000012');
