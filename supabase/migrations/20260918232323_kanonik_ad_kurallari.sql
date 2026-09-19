-- ============================================================================
-- KANONİK AD KURALLARI — kaynak, kategoriyi BİZİM adımızla söylediğinde
-- ============================================================================
--
-- ÇÖZÜLEN PROBLEM
-- `category_source_map` bugün yalnızca Awin sektör adlarını ve ortak İngilizce
-- feed terimlerini tanıyor. Türkçe yayın yapan bir kaynak ("Kadın", "Ayakkabı",
-- "Kulaklık") hiçbir kurala düşmüyor ve ürün sınıflandırılmamış kalıyordu.
--
-- NEDEN ELLE YAZILMADI
-- Trendyol/AliExpress taksonomi metinlerini elle yazmak, GÖRÜLMEMİŞ bir değer
-- için kural uydurmak olurdu. Bu depoda kural açık: doğrulanmamış varsayımı
-- veriye gömme. Bugün canlıda o kaynaklardan tek bir satır bile yok.
--
-- ONUN YERİNE: kurallar KENDİ kataloğumuzdan TÜRETİLİYOR. Bir kaynak kategoriyi
-- bizim kanonik adımızla söylüyorsa, o ada sahip kategoriye gider. Bu bir tahmin
-- değil, kimlik eşlemesidir.
--
-- ----------------------------------------------------------------------------
-- BELİRSİZ ADLAR BİLEREK DIŞARIDA
-- ----------------------------------------------------------------------------
-- Aynı ad birden çok kategoride geçiyorsa (ölçüldü: "Oto & Yedek Parça" Seviye-1
-- ile çocuğu "Oto Yedek Parça" aynı anahtara iniyor) hangisinin kastedildiği
-- BİLİNMEZ. Böyle bir adı birine bağlamak, yazı tura atıp sonucu veri diye
-- kaydetmek olurdu. Belirsiz ad kural üretmez; başlık kurallarına düşer.
--
-- Aynı sebeple bu türetme, KISALTILMIŞ adlar için kural üretmez: kataloğumuzda
-- "Kadın Giyim" var, yalın "Kadın" yok. Yalın "Kadın" giyim mi kozmetik mi
-- aksesuar mı belli değildir ve çözümsüz bırakılır -- yanlış kategori,
-- kategorisizlikten zararlıdır.
--
-- ----------------------------------------------------------------------------
-- MEVCUT KURALLAR KAZANIR
-- ----------------------------------------------------------------------------
-- `on conflict do nothing`: elle yazılmış bir kural (özellikle KAPSAM DIŞI
-- işaretli gıda/tütün satırları) bu türetmeyle EZİLMEZ. Aksi halde "Gıda"
-- kategorimizin adı, bilerek kapsam dışı bıraktığımız gıda kuralını geçersiz
-- kılabilirdi.
-- ============================================================================

create or replace function public.kategori_ad_kurallarini_tazele()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  eklenen integer;
begin
  with tekil as (
    select public.kategori_anahtar(c.name) as anahtar, min(c.id::text) as kimlik
      from public.categories c
     where c.is_active
       and public.kategori_anahtar(c.name) is not null
     group by 1
    having count(*) = 1
  )
  insert into public.category_source_map (source, source_key, category_id, excluded_reason, note)
  select '*', t.anahtar, t.kimlik::uuid, null,
         'Kanonik kategori adindan TURETILDI. Kaynak kategoriyi bizim adimizla '
         || 'soyluyorsa ayni kategoriye gider; elle yazilmis bir varsayim degil.'
    from tekil t
  on conflict (source, source_key) do nothing;

  get diagnostics eklenen = row_count;
  return eklenen;
end $$;

comment on function public.kategori_ad_kurallarini_tazele is
  'Kanonik kategori adlarindan '' * '' esleme kurali turetir. Belirsiz adlari '
  'ATLAR ve mevcut kurallari EZMEZ. Yeni kategori eklendiginde tekrar cagrilabilir; '
  'idempotenttir.';

revoke all on function public.kategori_ad_kurallarini_tazele() from public;
revoke all on function public.kategori_ad_kurallarini_tazele() from anon, authenticated;
grant execute on function public.kategori_ad_kurallarini_tazele() to service_role;

do $$
declare n integer;
begin
  select public.kategori_ad_kurallarini_tazele() into n;
  raise notice 'kanonik ad kurali eklendi: %', n;
end $$;