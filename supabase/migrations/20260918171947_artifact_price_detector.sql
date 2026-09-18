-- ============================================================================
-- ARTEFAKT FİYAT DEDEKTÖRÜ
--
-- ⚠️  ÜRETİMDE UYGULANDI (schema_migrations 20260918171947). Bu dosya
--     üretimdeki hâlin birebir kopyasıdır.
--
-- ÖLÇÜLEN OLAY: 24 ürün -- 3 metrelik HDMI kablosundan 75 inç akıllı tahtaya
-- kadar birbiriyle alakasız ürünler -- tek beslemeden BİREBİR AYNI fiyatla
-- geldi: 134.400.000 kuruş (£1.344.000,00). Hepsi vitrinde o tutarla göründü.
--
-- NEDEN BÜYÜKLÜK EŞİĞİ DEĞİL
-- İlk akla gelen "çok pahalıysa yanlıştır" kuralı YANLIŞ sonuç verir:
-- katalogda HPE Aruba ClearPass 10K kullanıcı 5 yıllık aboneliği
-- £346.999,00'dan duruyor ve bu GERÇEK bir fiyat. Büyüklük eşiği onu da
-- gizlerdi.
--
-- AYIRT EDİCİ İMZA: aynı kaynakta, BİRDEN FAZLA farklı ürünün TAM OLARAK
-- aynı olağandışı tutarı taşıması. Gerçek pahalı ürün tekildir; ayrıştırma
-- artefaktı ise satır satır tekrar eder.
--
-- EŞİKLER VERİDEN SEÇİLDİ, TAHMİNLE DEĞİL:
--   kaynağın ortancası      6.999 kuruş
--   artefakt                19.203 × ortanca, 24 ürün
--   bir sonraki aday           50 × ortanca,  7 ürün  (gerçek fiyat)
-- İki küme arasında 380 kat boşluk var. 1000× ve 3 ürün eşikleri bu boşluğun
-- ortasına düşüyor; ölçümde artefaktı yakalayıp gerçek fiyatların hiçbirini
-- yakalamıyor.
--
-- BU İŞLEV YAZMAZ. Yalnızca aday döndürür; ne gizlenecekse çağıran karar
-- verir. Otomatik gizleme, yanlış pozitifte gerçek ürünü vitrinden
-- düşürürdü.
-- ============================================================================

create or replace function public.artefakt_fiyatlar(
  p_en_az_urun integer default 3,
  p_ortanca_kati integer default 1000
)
returns table (
  source_id      uuid,
  price_cents    bigint,
  urun_sayisi    bigint,
  kaynak_ortanca bigint,
  ortanca_kati   numeric
)
language sql
stable
set search_path = public, pg_temp
as $$
  with kaynak_ortanca as (
    select p.source_id,
           percentile_disc(0.5) within group (order by p.price_cents) as ortanca
    from public.products p
    where p.price_cents > 0
    group by p.source_id
  ),
  tekrar as (
    select p.source_id, p.price_cents, count(distinct p.id) as urun
    from public.products p
    where p.price_cents > 0
    group by p.source_id, p.price_cents
  )
  select t.source_id,
         t.price_cents,
         t.urun,
         k.ortanca,
         round(t.price_cents::numeric / nullif(k.ortanca, 0), 1)
  from tekrar t
  join kaynak_ortanca k on k.source_id is not distinct from t.source_id
  where t.urun >= greatest(p_en_az_urun, 2)
    and k.ortanca > 0
    and t.price_cents >= k.ortanca * greatest(p_ortanca_kati, 2)
  order by t.price_cents desc;
$$;

comment on function public.artefakt_fiyatlar(integer, integer) is
  'Ayristirma artefakti olan fiyat adaylari: ayni kaynakta birden fazla farkli '
  'urunun tasidigi olagandisi yuksek AYNI tutar. Yalnizca okur, yazmaz.';

revoke all on function public.artefakt_fiyatlar(integer, integer) from public;
revoke all on function public.artefakt_fiyatlar(integer, integer) from anon;
revoke all on function public.artefakt_fiyatlar(integer, integer) from authenticated;
grant execute on function public.artefakt_fiyatlar(integer, integer) to service_role;
