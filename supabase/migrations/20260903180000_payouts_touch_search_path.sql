-- ===========================================================================
-- tg_payouts_touch — search_path sabitlenmesi
-- ---------------------------------------------------------------------------
-- SORUN
-- Fonksiyon `set search_path` olmadan tanımlanmıştı (Supabase güvenlik
-- danışmanı: function_search_path_mutable). Bir tetikleyici fonksiyonu,
-- kendisini tetikleyen INSERT/UPDATE'i yapan rolün search_path'i altında
-- çalışır. O rol kendi şemasına `now()` adında bir fonksiyon koyabilirse,
-- tetikleyicinin çağırdığı `now()` artık bizim beklediğimiz işlev olmaz.
--
-- Somut sonuç: `payouts.updated_at` saldırganın seçtiği bir değere
-- yazılabilir; tahsilat mutabakatının zaman çizelgesi bozulur.
--
-- Sömürü için şema oluşturma yetkisi gerekir; bu yüzden şiddet DÜŞÜK.
-- Ama düzeltme tek satır ve davranışı hiç değiştirmiyor: bu bir risk/maliyet
-- takası değil, sadece eksik bırakılmış bir satır.
--
-- ÇÖZÜM
-- `search_path = ''` (boş) + şema nitelikli çağrı. Boş search_path, adı
-- niteliksiz bırakılmış HER nesneyi hata hâline getirir -- yani ileride
-- birisi buraya niteliksiz bir çağrı eklerse sessizce yanlış çalışmak
-- yerine derhal patlar. Sessiz yanlışlık, gürültülü hatadan pahalıdır.
--
-- Gövde birebir aynı; yalnızca `now()` → `pg_catalog.now()`.
-- ===========================================================================

create or replace function public.tg_payouts_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

comment on function public.tg_payouts_touch() is
  'payouts.updated_at damgasi. search_path bos ve sabit: niteliksiz ad cozumlemesi kapali.';
