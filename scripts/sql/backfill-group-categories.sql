-- ---------------------------------------------------------------------------
-- FAZ 2 — product_groups.category_id backfill
-- ---------------------------------------------------------------------------
--
-- BU BİR MIGRATION DEĞİLDİR ve `supabase/migrations/` altında DURMAZ.
-- Üretim ile depo göç geçmişi farklı (ölçüldü: üretimde 96, depoda 63 dosya);
-- buraya bir migration eklemek o farkı büyütür ve `supabase db push`
-- gerektirirdi. Bu dosya elle çalıştırılan, TEKRARLANABİLİR bir veri
-- düzeltmesidir: şema değiştirmez, sütun eklemez, hiçbir şey silmez.
--
-- NE YAPAR
-- Kategorisi boş olan ürün gruplarına, o grubun ÜRÜNLERİNDEN türetilen
-- kategoriyi yazar. Ürünlerde kategori zaten dolu (35.762/35.762 ölçüldü);
-- boş olan yalnızca grup seviyesiydi ve kategori sayfaları grup üzerinden
-- çalıştığı için katalog kategorisiz görünüyordu.
--
-- YENİ SINIFLANDIRMA YOK. Burada hiçbir kural, başlık eşlemesi ya da tahmin
-- yoktur; tek kaynak `products.category_id`. Kategori üretmek beslemenin
-- işidir (`packages/ingest/src/categorize.ts`), bu betiğin değil.
--
-- --- GÜVENLİK KURALLARI (hepsi sorgunun İÇİNDE zorlanır) -------------------
--
--   1) YALNIZCA BOŞ KAYIT. `g.category_id is null` koşulu, elle ya da başka
--      bir yolla atanmış mevcut hiçbir kategorinin üzerine yazılmamasını
--      garanti eder. Aynı zamanda betiği idempotent yapar: ikinci çalıştırma
--      0 satır günceller.
--
--   2) BELİRSİZ GRUP GÜVENLİ BİÇİMDE BOŞ KALIR. `having count(distinct ...)
--      = 1` koşulu, ürünleri FARKLI kategoriler gösteren grupları tamamen
--      dışarıda bırakır. Böyle bir grupta rastgele birini seçmek -- ya da
--      "ilkini al" demek -- ölçmediğimiz bir kararı ölçmüş gibi yazmaktır.
--      Ölçüm: bugün böyle grup YOK (0 çakışma), ama kural veriye değil
--      sorguya gömülü olmalı ki yarın çakışma çıktığında da korusun.
--
--   3) ÜRÜNSÜZ GRUP BOŞ KALIR. `join` zaten onları eler. Bunlar öksüz
--      gruplar (ölçüm: 211 adet) ve kategori türetilecek kanıtları yok.
--      SİLİNMEZLER -- bu betik hiçbir satır silmez.
--
--   4) SIMPLE PROJECT KAYNAK DEĞİLDİR. O mağazanın teklifleri üretime dahil
--      edilmemeli; bugün hiç teklifi yok (ölçüldü) ama koşul yine de burada,
--      çünkü güvenlik kuralı gözleme değil sorguya bağlı olmalı.
--
-- --- ÇALIŞTIRMA ------------------------------------------------------------
--
--   Önce sayıyı gör (hiçbir şey yazmaz):
--     psql "$DATABASE_URL" -f scripts/sql/backfill-group-categories.sql -v kuru=1
--
--   Parti parti çalıştırılabilir: `LIMIT` satırı partiyi sınırlar ve betik
--   0 satır dönene kadar tekrar çalıştırılır. Tek seferde de çalışır; parti
--   yalnızca uzun kilitten ve ifade zaman aşımından kaçınmak içindir.
-- ---------------------------------------------------------------------------

update public.product_groups g
   set category_id = k.kategori
  from (
    select p.group_id,
           -- Tek bir farklı değer olduğu `having` ile garanti; dolayısıyla
           -- dizinin ilk elemanı O değerin ta kendisi, bir seçim değil.
           (array_agg(distinct p.category_id))[1] as kategori
      from public.products p
      left join public.merchants m on m.id = p.merchant_id
     where p.group_id is not null
       and p.category_id is not null
       and (m.slug is null or m.slug <> 'simple-project')   -- kural 4
     group by p.group_id
    having count(distinct p.category_id) = 1                -- kural 2
  ) k
 where g.id = k.group_id
   and g.category_id is null;                               -- kural 1
