-- ===========================================================================
-- Kanonik urun eslestirme imzasi
-- ---------------------------------------------------------------------------
-- BULUNAN HATA
-- Barkodsuz teklifler icin "marka + normalize baslik imzasi" ile eslestirme
-- yapildigi yaziyordu. Imza fonksiyonu gercekten de kelime sirasindan ve
-- Turkce karakterlerden bagimsizdi. Ama veritabani on filtresi TAM BASLIK
-- esitligi ile aday cekiyordu:
--
--     .from('product_groups').select('id, title, brand').in('title', basliklar)
--
-- Yani imza yalnizca baslik zaten harfi harfine ayni oldugunda
-- karsilastiriliyordu - o durumda da imzanin hicbir katkisi yok. Sonuc:
-- iki satici "Kablosuz Kulaklik" ve "Kulaklik Kablosuz" yazdiginda IKI AYRI
-- kanonik urun olusuyordu ve fiyatlari hic karsilastirilmiyordu.
--
-- Bir fiyat karsilastirma sitesinde bu, olabilecek en pahali sessiz hata:
-- sitenin var olma sebebi olan islev, kimse fark etmeden calismiyor.
--
-- COZUM
-- Imza veritabaninda URETILEN (generated) bir sutun olarak tutulur ve on
-- filtre bu sutun uzerinden yapilir. Boylece eslestirme indeksli, kesin ve
-- baslik yazimindan bagimsiz olur.
--
-- Sutun uretilen olarak tanimlandi, uygulama tarafindan yazilan bir alan
-- olarak degil: baska bir yol (ingest islevi, elle ekleme) satir eklerse o
-- satirin imzasi da kendiliginden dogru olur. Uygulamanin yazmasi gerekseydi,
-- unutulan her yol sessizce eslesmeyen urunler uretirdi.
-- ===========================================================================

-- plpgsql secildi: SQL fonksiyonu satir ici acilabilir (inline), acildiginda
-- alt sorgu uretilen sutun ifadesinde gorunur ve Postgres bunu reddeder.
create or replace function public.product_signature(p_title text, p_brand text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v_words text;
begin
  -- Baslik: ASCII'ye indirgenir, harf/rakam disi her sey ayirica olur,
  -- kelimeler SIRALANIR (yazim sirasi farki eslesmeyi bozmasin).
  -- collate "C": bayt sirasi. Sunucu yereline bagli bir siralama, JavaScript
  -- tarafindaki .sort() ile ayrisirdi (orn. rakam/harf sirasi) ve ayni urun
  -- iki farkli imza alirdi.
  select coalesce(string_agg(w, ' ' order by w collate "C"), '')
    into v_words
    from unnest(
      string_to_array(
        regexp_replace(public.normalize_search(coalesce(p_title, '')), '[^a-z0-9]+', ' ', 'g'),
        ' '
      )
    ) as w
   where w <> '';

  return public.normalize_search(coalesce(p_brand, '')) || '|' || v_words;
end;
$$;

comment on function public.product_signature(text, text) is
  'Kanonik urun eslestirme imzasi: marka + siralanmis, ASCII indirgenmis baslik kelimeleri.';

alter table public.product_groups
  add column if not exists match_signature text
  generated always as (public.product_signature(title, brand)) stored;

comment on column public.product_groups.match_signature is
  'Barkodsuz eslestirmenin on filtresi. Uretilen sutun: her yazma yolunda dogru kalir.';

-- Eslestirme sorgusu bu sutun uzerinden calisir; indekssiz her beslemede
-- tam tablo taramasi olurdu.
create index if not exists product_groups_match_signature_idx
  on public.product_groups (match_signature);
