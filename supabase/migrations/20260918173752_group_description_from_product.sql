-- ============================================================================
-- GRUP AÇIKLAMASI ÜRÜNDEN DOLDURULUR
--
-- ⚠️  ÜRETİMDE UYGULANDI (işlev + tetikleyici göç olarak, geri doldurma
--     toplu yazımla). Bu dosya ikisini birden taşır ve yeniden
--     çalıştırılabilir.
--
-- ÖLÇÜLEN DURUM:
--   products      : 35.709 / 35.762 ürünün açıklaması VAR
--   product_groups:      0 / 34.721 grubun açıklaması var
--   kesişim       : 34.458 grubun altında açıklamalı ürün var, grubun
--                   kendi açıklaması boş
--
-- Ürün sayfası `product_groups.description` okuyor
-- (apps/web/src/app/urun/[slug]/page.tsx:391). Yani açıklama
-- veritabanında DURUYOR ama hiçbir ürün sayfasında görünmüyordu;
-- 34.458 sayfa bu yüzden ince içerikti.
--
-- HANGİ AÇIKLAMA SEÇİLİR: grubun altındaki EN UZUN açıklama. Bir kanonik
-- ürünü birden çok mağaza besleyebilir; en uzun metin en çok bilgi
-- taşıyandır. Eşitlikte ürün kimliğine göre kararlı seçim yapılır --
-- aynı girdi her zaman aynı çıktıyı verir.
--
-- DOLU OLANI ASLA EZMEZ. Grubun kendi açıklaması varsa dokunulmaz.
-- ============================================================================

create or replace function public.grup_aciklamasi_sec(p_group_id uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select p.description
  from public.products p
  where p.group_id = p_group_id
    and p.description is not null
    and length(btrim(p.description)) > 40
  order by length(p.description) desc, p.id
  limit 1;
$$;

comment on function public.grup_aciklamasi_sec(uuid) is
  'Grubun altindaki en uzun urun aciklamasi. Esitlikte urun kimligine gore kararli.';

revoke all on function public.grup_aciklamasi_sec(uuid) from public;
revoke all on function public.grup_aciklamasi_sec(uuid) from anon;
grant execute on function public.grup_aciklamasi_sec(uuid) to service_role;

-- --- İleriye dönük eşitleme ---------------------------------------------
-- Mevcut `tg_products_sync_group_stats` DEĞİŞTİRİLMİYOR. Ayrı ve toplayıcı
-- bir tetikleyici: çalışan bir yolun içine girmek, o yol bozulduğunda
-- fiyat/sayı istatistiklerini de düşürürdü.
create or replace function public.tg_products_sync_group_description()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.group_id is null then
    return new;
  end if;

  update public.product_groups g
     set description = new.description
   where g.id = new.group_id
     and (g.description is null or length(btrim(g.description)) <= 40)
     and new.description is not null
     and length(btrim(new.description)) > 40;

  return new;
end;
$$;

drop trigger if exists products_sync_group_description on public.products;
create trigger products_sync_group_description
  after insert or update of description, group_id on public.products
  for each row execute function public.tg_products_sync_group_description();

comment on function public.tg_products_sync_group_description() is
  'Grubun aciklamasi BOSSA urununkiyle doldurur. Dolu olani asla ezmez.';

-- --- Geri doldurma -------------------------------------------------------
-- Tetikleyici yalnızca BUNDAN SONRAKİ yazımları yakalar; hâlihazırda duran
-- 34.458 grup bu tek deyimle dolduruluyor. Yeniden çalıştırılabilir: dolu
-- olanı ezmediği için ikinci çalıştırma hiçbir satıra dokunmaz.
with kaynak as (
  select distinct on (p.group_id) p.group_id, p.description
  from public.products p
  where p.group_id is not null
    and p.description is not null
    and length(btrim(p.description)) > 40
  order by p.group_id, length(p.description) desc, p.id
)
update public.product_groups g
   set description = k.description
  from kaynak k
 where g.id = k.group_id
   and (g.description is null or length(btrim(g.description)) <= 40);
