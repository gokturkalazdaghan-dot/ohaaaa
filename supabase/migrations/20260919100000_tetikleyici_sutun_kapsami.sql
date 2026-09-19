-- ===========================================================================
-- products ÜZERİNDEKİ İKİ TETİKLEYİCİ SÜTUNA KAPSANIYOR
-- ---------------------------------------------------------------------------
-- ÖLÇÜLEN ARIZA
-- Alım turu, teklifleri yazdıktan sonra "gördük" damgasını basarken
-- düşüyordu:
--
--   Görülme damgası yazılamadı: canceling statement due to statement timeout
--
-- `touchSeen` YALNIZCA dört zaman damgası yazıyor (last_seen_at,
-- price_checked_at, stock_checked_at, offer_checked_at). Bu sütunların
-- hiçbiri hiçbir toplamı etkilemez. Buna rağmen her satır için grup
-- istatistikleri baştan hesaplanıyordu.
--
-- ÖLÇÜM (üretim):
--   refresh_product_group_stats tek çağrı ........  7,90 ms
--   satır başı toplam (zaman damgası yazma) ...... 13,53 ms
--   parti boyutu / parti sayısı .................. 166 / 216
--   tam katalog için boşa giden hesap ............ 35.762 x 7,90 ms ~ 283 sn
--
-- Yani turun en pahalı işi, sonucu HİÇ DEĞİŞMEYEN bir yeniden hesaplamaydı.
-- Boşta ölçülen 166 satırlık parti 8 saniyelik `statement_timeout`un altında
-- kalıyor (~2,2 sn); alım sırasında aynı tetikleyici teklif yazmalarında da
-- çalıştığı için yük altında eşik aşılıyordu.
--
-- ---------------------------------------------------------------------------
-- NEDEN BU DÜZELTME, `statement_timeout`U YÜKSELTMEK DEĞİL
-- ---------------------------------------------------------------------------
-- Zaman aşımını yükseltmek, gereksiz işi daha uzun sürede yapmaya izin
-- vermekti. İş hâlâ yapılacak, veritabanı hâlâ yorulacak ve katalog
-- büyüdükçe aynı duvara daha geç ama yine çarpılacaktı. Kaldırılması
-- gereken şey süre değil, İŞİN KENDİSİ.
--
-- ---------------------------------------------------------------------------
-- SÜTUN LİSTESİ TAHMİN DEĞİL, FONKSİYON GÖVDESİNDEN ÇIKARILDI
-- ---------------------------------------------------------------------------
-- Bir tetikleyiciyi dar kapsamak, sessizce yanlış çalışan bir sisteme giden
-- en kısa yoldur: unutulan bir sütun, bayat kalan bir toplam demektir ve
-- bayatlık kendini göstermez. Bu yüzden liste, `refresh_product_group_stats`
-- gövdesinin `products`'tan OKUDUĞU her sütundur:
--
--   group_id                 -> hangi grubun hesaplanacağı (bölüm anahtarı)
--   status                   -> where p.status = 'active'
--   stock                    -> where p.stock > 0
--   currency                 -> group by p.currency
--   price_cents              -> min(), max() ve en iyi teklif sıralaması
--   shipping_fee_cents       -> en iyi teklif sıralaması
--   estimated_delivery_days  -> en iyi teklif sıralaması
--   created_at               -> en iyi teklifte eşitlik bozucu
--
-- `id` de okunuyor (best_offer_id) ama birincil anahtar güncellenmiyor.
--
-- INSERT ve DELETE KAPSANMIYOR ve bu doğru: yeni bir teklif ya da silinen
-- bir teklif, hangi sütunu taşıdığına bakılmaksızın toplamı değiştirir.
--
-- Risk kapısı için liste yine gövdeden: fonksiyon `new.status`,
-- `new.price_cents`, `new.group_id`, `new.compare_at_price_cents`,
-- `new.vendor_id` okuyor. Gövdesinde zaten bir erken çıkış var (bu dördü
-- değişmemişse hemen dönüyor), yani burada kazanılan şey hesaplama değil
-- 35.762 gereksiz plpgsql çağrısı.
-- ===========================================================================

drop trigger if exists products_sync_group_stats on public.products;

create trigger products_sync_group_stats
after insert or delete or update of
  group_id, status, stock, currency,
  price_cents, shipping_fee_cents, estimated_delivery_days, created_at
on public.products
for each row
execute function public.tg_products_sync_group_stats();

drop trigger if exists products_risk_gate on public.products;

create trigger products_risk_gate
after insert or update of
  status, price_cents, group_id, compare_at_price_cents, vendor_id
on public.products
for each row
execute function public.tg_products_risk_gate();

-- ---------------------------------------------------------------------------
-- GÖÇÜN KENDİ DOĞRULAMASI
-- ---------------------------------------------------------------------------
-- Sütun adı yanlış yazılırsa PostgreSQL zaten hata verir, ama tetikleyicinin
-- BEKLENEN sütun sayısıyla kurulduğunu da burada sabitliyoruz: ileride biri
-- listeyi kısaltırsa göç yeniden koşturulduğunda fark edilir.
do $$
declare
  v_stats int;
  v_risk  int;
begin
  select cardinality(tgattr) into v_stats
    from pg_trigger where tgname = 'products_sync_group_stats'
      and tgrelid = 'public.products'::regclass;

  select cardinality(tgattr) into v_risk
    from pg_trigger where tgname = 'products_risk_gate'
      and tgrelid = 'public.products'::regclass;

  if v_stats <> 8 then
    raise exception 'products_sync_group_stats 8 sutuna kapsanmali, % bulundu', v_stats;
  end if;

  if v_risk <> 5 then
    raise exception 'products_risk_gate 5 sutuna kapsanmali, % bulundu', v_risk;
  end if;
end $$;
