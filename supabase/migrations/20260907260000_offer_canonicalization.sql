-- ===========================================================================
-- TEKLİF → KANONİK ÜRÜN BAĞI
-- ===========================================================================
--
-- ÖNCEKİ GÖÇTE EKSİK KALAN PARÇA
--
-- `product_groups.canonical_key` kanonik ürünü tekilleştiriyor. Ama TEKLİF
-- tarafında (`products`) ne `gtin` ne `mpn` var; yani bir feed satırının
-- hangi kanonik ürüne ait olduğu HESAPLANAMIYOR. Sonuç: `group_id` nullable
-- kalıyor ve pratikte hiç dolmuyor -- katalog, aynı telefonun her mağazada
-- ayrı bir "ürün" olarak göründüğü bir listeye dönüyor ve fiyat
-- karşılaştırması, var olma sebebimiz, hiç çalışmıyor.
--
-- Bu göç o parçayı ekliyor: teklif de kendi kanonik anahtarını taşıyor ve
-- iki taraf aynı fonksiyonla hesaplandığı için eşleşme GARANTİ.
--
-- ---------------------------------------------------------------------------
-- ÇÖZÜM DB'DE, KODDA DEĞİL
-- ---------------------------------------------------------------------------
-- `resolve_canonical_group` tek ifadeyle "varsa bul, yoksa aç" yapıyor:
-- `insert ... on conflict (canonical_key) do update ... returning id`.
--
-- Kod tarafında "önce SELECT, grup var mı, yoksa INSERT" yapılabilirdi ama
-- yüz milyonluk hacimde o kalıp tam olarak kaçındığımız yarışı üretir: iki
-- işçi aynı anda "yok" görür, ikisi de yazar, kanonik ürün ikiye bölünür.
-- `do nothing` DEĞİL `do update` kullanılmasının sebebi de bu: `do nothing`
-- çakışmada HİÇ SATIR döndürmez ve çağıran ikinci bir SELECT'e mecbur
-- kalırdı -- yani yarış geri gelirdi.
-- ===========================================================================

alter table public.products
  -- Feed'lerin verdiği tanımlayıcılar. NULL = feed vermemiş.
  add column gtin text,
  add column mpn  text;

comment on column public.products.gtin is
  'Feed in verdigi GTIN. NULL = verilmemis. Kanonik eslemenin en guvenilir '
  'girdisi.';

alter table public.products
  add column canonical_key text
    generated always as (public.canonical_product_key(gtin, brand, mpn, title)) stored;

comment on column public.products.canonical_key is
  'Teklifin kanonik anahtari. product_groups.canonical_key ile AYNI '
  'fonksiyondan uretilir; eslesme bu yuzden garanti.';

/*
 * Toplu eşleştirme erişim yolu. Bir partideki 50 000 teklifi kanonik
 * gruplarına bağlarken bu indeks olmadan her satır bir tam tarama olurdu.
 */
create index products_canonical_key_idx on public.products (canonical_key);

-- Kanonik ürün başına teklifler: karşılaştırma tablosunun ana sorgusu.
create index products_group_active_idx
  on public.products (group_id, price_cents)
  where group_id is not null and status = 'active';

/**
 * Bir teklifin kanonik ürününü bulur, yoksa AÇAR.
 *
 * TEK İFADE, YARIŞSIZ. `on conflict do update` seçilmesinin sebebi
 * dosya başındaki notta.
 *
 * Yalnız EKSİK alanlar doldurulur (`coalesce(mevcut, yeni)`): kanonik ürün
 * birden çok feed'den beslenir ve son gelenin ilk gelenin verisini EZMESİ,
 * daha zengin bir kaydı daha fakiriyle değiştirmek olurdu.
 */
create or replace function public.resolve_canonical_group(
  p_gtin  text,
  p_brand text,
  p_mpn   text,
  p_title text,
  p_image_url text default null,
  p_category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key  text;
  v_id   uuid;
begin
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    /*
     * Başlıksız bir teklif kanonik ürüne bağlanamaz: 'title:' dalı boş bir
     * anahtar üretir ve BÜTÜN başlıksız teklifler tek bir sahte ürüne
     * yığılırdı -- sessiz ve geri dönüşü zor bir bozulma.
     */
    return null;
  end if;

  v_key := public.canonical_product_key(p_gtin, p_brand, p_mpn, p_title);

  insert into public.product_groups (slug, title, brand, gtin, mpn, image_url, category_id)
  values (
    -- Slug deterministik: anahtarın özeti. Başlıktan üretilseydi iki farklı
    -- ürün aynı slug'a düşer ve slug tekilliği kanonik eklemeyi düşürürdü.
    left(public.normalize_search(p_title), 60) || '-' || left(md5(v_key), 8),
    p_title, p_brand, p_gtin, p_mpn, p_image_url, p_category_id
  )
  on conflict (canonical_key) do update
     set title       = coalesce(public.product_groups.title, excluded.title),
         brand       = coalesce(public.product_groups.brand, excluded.brand),
         mpn         = coalesce(public.product_groups.mpn, excluded.mpn),
         image_url   = coalesce(public.product_groups.image_url, excluded.image_url),
         category_id = coalesce(public.product_groups.category_id, excluded.category_id)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.resolve_canonical_group is
  'Teklifin kanonik urununu bulur, yoksa acar. Tek ifade: on conflict do '
  'update ... returning. do nothing olsaydi cakismada satir donmez ve '
  'cagiran ikinci bir SELECT e, yani yarisa mecbur kalirdi.';

revoke all on function public.resolve_canonical_group(text, text, text, text, text, uuid) from public;
revoke all on function public.resolve_canonical_group(text, text, text, text, text, uuid)
  from anon, authenticated;
grant execute on function public.resolve_canonical_group(text, text, text, text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid; v_b uuid; v_c uuid; v_bos uuid;
begin
  -- 1) AYNI URUN IKI FARKLI GOSTERIMDEN TEK GRUBA DUSUYOR.
  v_a := public.resolve_canonical_group('012345678905', 'TestMarka', null, 'Test Telefon');
  v_b := public.resolve_canonical_group('0012345678905', 'TestMarka', null, 'Test Telefon');

  if v_a is null or v_a <> v_b then
    raise exception
      'DOGRULAMA 1: ayni urun iki kanonik gruba dustu -- karsilastirma hic '
      'calismazdi.';
  end if;

  -- 2) FARKLI urun ayri grup: kapatma fazla kapatmamis.
  v_c := public.resolve_canonical_group('0987654321098', 'TestMarka', null, 'Baska Telefon');
  if v_c = v_a then
    raise exception 'DOGRULAMA 2: farkli urunler ayni gruba dustu.';
  end if;

  -- 3) BASLIKSIZ teklif bagLANMIYOR -- hepsi tek sahte urune yigilirdi.
  v_bos := public.resolve_canonical_group(null, null, null, '   ');
  if v_bos is not null then
    raise exception 'DOGRULAMA 3: basliksiz teklif kanonik gruba baglandi.';
  end if;

  -- 4) MEVCUT VERI EZILMIYOR: ikinci cagri markayi silmemeli.
  perform public.resolve_canonical_group('012345678905', null, null, 'Test Telefon');
  if (select brand from public.product_groups where id = v_a) is distinct from 'TestMarka' then
    raise exception
      'DOGRULAMA 4: ikinci feed ilk feed in verisini ezdi -- zengin kayit '
      'fakiriyle degistirildi.';
  end if;

  -- 5) TEKLIF ve GRUP ayni anahtari uretiyor: eslesme garanti.
  if (select canonical_key from public.product_groups where id = v_a)
     <> public.canonical_product_key('012345678905', 'TestMarka', null, 'Test Telefon') then
    raise exception 'DOGRULAMA 5: teklif ve grup anahtarlari ayristi.';
  end if;

  delete from public.product_groups where id in (v_a, v_c);

  raise notice
    'Teklif-kanonik bagi kuruldu: resolve_canonical_group tek ifadede '
    'yarissiz calisiyor, basliksiz teklif baglanmiyor, mevcut veri ezilmiyor.';
end $$;
