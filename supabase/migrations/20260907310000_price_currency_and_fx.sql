-- ===========================================================================
-- FİYATIN PARA BİRİMİ VE KUR DÖNÜŞÜMÜ
-- ===========================================================================
--
-- BULUNAN İKİ EKSİK
--
-- 1) `price_points` bir TUTAR saklıyor ama PARA BİRİMİ saklamıyor.
--    Tek pazarlı bir sitede bu görünmez; küresel bir katalogda kayıt
--    ANLAMSIZDIR: `price_cents = 1000` satırı 10 USD mi 10 TRY mi
--    olduğunu söylemiyor. Ürünün bugünkü para birimine bakarak yorumlamak
--    da yanlış -- ürün para birimi değişirse GEÇMİŞİN TAMAMI sessizce
--    yeniden yorumlanır ve "en düşük fiyat" bambaşka bir sayı olur.
--
--    Fiyat geçmişi DEĞİŞMEZ bir kayıttır; ancak yanında para birimini de
--    taşırsa değişmez olur.
--
-- 2) Kur tablosu yok. Pazarlar arası karşılaştırma dönüşüm ister ve
--    dönüşüm TARİHLİ bir kur ister. Kur olmadan yapılabilecek tek şey
--    sayı uydurmaktır.
--
-- ---------------------------------------------------------------------------
-- DÖNÜŞÜM ASLA YAZILMAZ
-- ---------------------------------------------------------------------------
-- `convert_money_cents` STABLE bir okuma fonksiyonudur ve saklanan hiçbir
-- fiyatı değiştirmez. Dönüştürülmüş değeri geri yazmak, orijinali YOK
-- ETMEK olurdu: kur sonradan düzeltildiğinde geçmişi geri alacak hiçbir
-- şey kalmazdı. Saklanan tutar her zaman mağazanın gerçekte istediği
-- tutardır; dönüşüm yalnızca gösterim anında yapılır.
--
-- ---------------------------------------------------------------------------
-- KUR YOKSA SAYI DA YOK
-- ---------------------------------------------------------------------------
-- İstenen tarihte kur bulunamazsa fonksiyon NULL döner. En yakın kuru
-- kullanmak ya da 1.0 varsaymak, uydurma bir fiyatı gerçek gibi göstermek
-- olurdu -- ve kullanıcı o fiyata güvenip tıklar.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) FİYAT GEÇMİŞİ PARA BİRİMİNİ TAŞIR
-- ---------------------------------------------------------------------------
alter table public.price_points
  add column currency char(3) references public.currencies (code);

-- Mevcut satırlar ürünün para biriminden dolduruluyor. Bu bir TAHMİN
-- değil: o satırlar tek pazarlı dönemde, ürünün o günkü para birimiyle
-- yazıldı ve başka bir kaynak yok.
update public.price_points pp
   set currency = p.currency
  from public.products p
 where p.id = pp.product_id and pp.currency is null;

do $$
declare v_bos integer;
begin
  select count(*) into v_bos from public.price_points where currency is null;
  if v_bos > 0 then
    raise exception
      'DOGRULAMA: % fiyat noktasi para birimsiz kaldi. NOT NULL yapmadan '
      'once bunlarin kaynagi bulunmali -- para birimsiz bir fiyat kaydi '
      'anlamsizdir.', v_bos;
  end if;
end $$;

/*
 * PARA BİRİMİ VERİLMEDİYSE ÜRÜNDEN DOLDURULUR.
 *
 * NOT NULL kısıtını eklemek, `price_points`a doğrudan yazan her çağrıyı
 * (tetikleyici, testler, ileride bir bakım betiği) tek tek düzeltmeyi
 * gerektirirdi -- ve unutulan ilk çağrı canlıda düşerdi. Bir fiyat
 * noktasının para birimi zaten TEK bir yerden gelebilir: ait olduğu
 * teklifin para birimi. Bunu tetikleyiciye almak, yazanları HATIRLAMAYA
 * değil YAPIYA bağlıyor.
 *
 * Açıkça verilen değer EZİLMEZ: çağıran farklı bir para birimi biliyorsa
 * o kazanır.
 */
create or replace function public.tg_price_points_fill_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency is null then
    select p.currency into new.currency
      from public.products p
     where p.id = new.product_id;
  end if;
  return new;
end;
$$;

comment on function public.tg_price_points_fill_currency is
  'Para birimi verilmediyse teklifin para biriminden doldurur. Yazanlari '
  'hatirlamaya degil yapiya bagliyor; acikca verilen deger EZILMEZ.';

create trigger price_points_fill_currency
  before insert on public.price_points
  for each row execute function public.tg_price_points_fill_currency();

alter table public.price_points
  alter column currency set not null;

comment on column public.price_points.currency is
  'Tutarin para birimi. ZORUNLU: parasiz bir fiyat kaydi anlamsizdir ve '
  'urunun BUGUNKU para birimine bakarak yorumlamak, para birimi degisince '
  'gecmisin tamamini sessizce yeniden yorumlar.';

-- Karşılaştırma sorgusu para birimini de filtreler: iki para birimini
-- toplamak ya da min() almak, iki farklı şeyi tek sayıya indirmektir.
create index price_points_product_currency_idx
  on public.price_points (product_id, currency, observed_at desc);

-- ---------------------------------------------------------------------------
-- 1b) FİYATI YAZAN TETİKLEYİCİ PARA BİRİMİNİ DE YAZAR
-- ---------------------------------------------------------------------------
-- Sütunu eklemek yetmez: fiyat noktalarını yazan `tg_products_record_price`
-- para birimini taşımıyordu ve NOT NULL kısıtı ilk yazmada düşerdi. Kısıtı
-- gevşetmek yanlış cevap olurdu -- yazanı düzeltmek doğru olan.
create or replace function public.tg_products_record_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Yalnızca fiyat veya stok DURUMU değiştiyse yaz.
  if tg_op = 'INSERT'
     or new.price_cents is distinct from old.price_cents
     or (new.stock > 0) is distinct from (old.stock > 0) then

    /*
     * Para birimi TEKLİFİN o andaki para birimidir, ürünün bugünküsü
     * değil: fiyat geçmişi yazıldığı anın kaydıdır ve sonradan değişen
     * bir alana bağlanırsa geçmişin tamamı sessizce yeniden yorumlanır.
     */
    insert into public.price_points (product_id, price_cents, in_stock, currency)
    values (new.id, new.price_cents, new.stock > 0, new.currency);
  end if;

  return new;
end;
$$;

comment on function public.tg_products_record_price is
  'Fiyat noktasini yazar. Para birimini de yazar: parasiz bir fiyat kaydi '
  'anlamsizdir ve urunun BUGUNKU para birimine bakarak yorumlamak gecmisi '
  'sessizce yeniden yorumlar.';

-- ---------------------------------------------------------------------------
-- 2) KUR TABLOSU — TARİHLİ VE KAYNAKLI
-- ---------------------------------------------------------------------------
create table public.fx_rates (
  base_currency  char(3) not null references public.currencies (code),
  quote_currency char(3) not null references public.currencies (code),

  /*
   * 1 base = rate quote. `numeric` ve GENİŞ: kur bir ölçüdür, para değil.
   * Kuruşa yuvarlamak dönüşümün kendisinde yapılıyor.
   */
  rate           numeric(20, 10) not null check (rate > 0),

  /** Kurun GEÇERLİ OLDUĞU gün. Dönüşüm bu tarihe göre seçilir. */
  as_of          date not null,

  /*
   * Kurun NEREDEN geldiği. Boş bırakılamaz: kaynağı bilinmeyen bir kur,
   * denetlenemeyen bir fiyat demektir ve bir gün "bu rakam nereden geldi"
   * sorusu sorulacak.
   */
  source         text not null,
  fetched_at     timestamptz not null default now(),

  primary key (base_currency, quote_currency, as_of),

  constraint fx_rates_source_not_blank check (length(btrim(source)) > 0),
  -- Bir para biriminin kendine kuru 1'dir ve tabloda yeri yok.
  constraint fx_rates_not_identity check (base_currency <> quote_currency)
);

comment on table public.fx_rates is
  'Tarihli kurlar. Kaynak ZORUNLU: kaynagi bilinmeyen bir kur, '
  'denetlenemeyen bir fiyat demektir.';

create index fx_rates_lookup_idx
  on public.fx_rates (base_currency, quote_currency, as_of desc);

-- ---------------------------------------------------------------------------
-- 3) DÖNÜŞÜM — SALT OKUMA, KAPALI BAŞARISIZ
-- ---------------------------------------------------------------------------
/**
 * Kuruş tutarını başka bir para birimine çevirir.
 *
 * `p_as_of` tarihinde ya da ONDAN ÖNCEKİ en yakın kur kullanılır: kurlar
 * her gün yayınlanmayabilir (hafta sonu, tatil) ve o günlerde bir önceki
 * iş gününün kuru geçerlidir. SONRAKİ bir kur ASLA kullanılmaz -- geçmiş
 * bir fiyatı gelecekteki bir kurla çevirmek, o gün var olmayan bir bilgiyi
 * kullanmaktır.
 *
 * Kur yoksa NULL. 1.0 varsaymak ya da en yakın herhangi bir kuru almak,
 * uydurma bir fiyatı gerçek gibi göstermek olurdu.
 */
create or replace function public.convert_money_cents(
  p_amount_cents bigint,
  p_from char(3),
  p_to   char(3),
  p_as_of date default current_date
)
returns bigint
language sql
stable
/*
 * SECURITY INVOKER (varsayılan) -- DEFINER DEĞİL.
 *
 * Fonksiyon yalnızca `fx_rates`i okuyor ve o tablo zaten vitrine açık
 * (RLS politikası select'e izin veriyor). DEFINER yapmak, hiç gerekmeyen
 * bir yetki yükseltmesi olurdu: `86_function_execute_public_sweep_test`
 * tam da bunu yakalamak için var ve yakaladı.
 */
set search_path = ''
as $$
  select case
    when p_amount_cents is null or p_from is null or p_to is null then null
    when p_from = p_to then p_amount_cents
    else (
      select round(p_amount_cents * r.rate)::bigint
        from public.fx_rates r
       where r.base_currency = p_from
         and r.quote_currency = p_to
         and r.as_of <= p_as_of
       order by r.as_of desc
       limit 1
    )
  end;
$$;

comment on function public.convert_money_cents is
  'Kurus tutarini cevirir. SALT OKUMA: saklanan fiyati DEGISTIRMEZ -- '
  'donusturulmus degeri geri yazmak orijinali yok etmek olurdu. Kur yoksa '
  'NULL: 1.0 varsaymak uydurma bir fiyati gercek gibi gostermek olurdu. '
  'SECURITY INVOKER: fx_rates zaten vitrine acik, yetki yukseltmesi gereksiz.';

revoke all on function public.convert_money_cents(bigint, char, char, date) from public;
grant execute on function public.convert_money_cents(bigint, char, char, date)
  to anon, authenticated, service_role;

-- --- Erişim ----------------------------------------------------------------
-- Kurlar VİTRİNDE kullanılır (fiyat gösterimi), o yüzden okumaya açık.
-- Yazma sunucu tarafında: bir kur satırı eklemek, gösterilen her fiyatı
-- değiştirmektir.
alter table public.fx_rates enable row level security;
create policy fx_rates_public_read on public.fx_rates for select using (true);
revoke all on public.fx_rates from anon, authenticated;
grant select on public.fx_rates to anon, authenticated;
grant select, insert, update, delete on public.fx_rates to service_role;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare v_sonuc bigint;
begin
  -- 1) KUR YOKSA SAYI YOK.
  if public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-07') is not null then
    raise exception
      'DOGRULAMA 1: kursuz donusum bir sayi dondurdu -- uydurma fiyat gercek '
      'gibi gorunurdu.';
  end if;

  -- 2) AYNI para birimi dokunulmadan geciyor.
  if public.convert_money_cents(1000, 'USD', 'USD', date '2026-09-07') <> 1000 then
    raise exception 'DOGRULAMA 2: ayni para birimi degisti.';
  end if;

  -- 3) Kur varsa donusum yapiliyor.
  insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
  values ('USD', 'TRY', 40.0000000000, date '2026-09-01', 'goc-dogrulama');

  v_sonuc := public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-07');
  if v_sonuc <> 40000 then
    raise exception 'DOGRULAMA 3: donusum yanlis (%).', v_sonuc;
  end if;

  -- 4) GELECEKTEKI kur GECMIS bir fiyata uygulanmiyor.
  insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
  values ('USD', 'TRY', 50.0000000000, date '2026-09-10', 'goc-dogrulama');

  v_sonuc := public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-07');
  if v_sonuc <> 40000 then
    raise exception
      'DOGRULAMA 4: gecmis bir fiyat GELECEKTEKI kurla cevrildi -- o gun var '
      'olmayan bir bilgi kullanildi (%).', v_sonuc;
  end if;

  -- 5) Sonraki tarihte YENI kur gecerli.
  if public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-11') <> 50000 then
    raise exception 'DOGRULAMA 5: yeni kur uygulanmadi.';
  end if;

  -- 6) Kaynaksiz kur REDDEDILIYOR.
  begin
    insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
    values ('EUR', 'TRY', 45, date '2026-09-01', '   ');
    raise exception 'DOGRULAMA 6: kaynaksiz kur kabul edildi.';
  exception when check_violation then null;
  end;

  -- 7) Kendine kur tabloda olamaz.
  begin
    insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
    values ('USD', 'USD', 1, date '2026-09-01', 'x');
    raise exception 'DOGRULAMA 7: kendine kur kabul edildi.';
  exception when check_violation then null;
  end;

  -- 8) Negatif/sifir kur REDDEDILIYOR.
  begin
    insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
    values ('EUR', 'TRY', 0, date '2026-09-01', 'x');
    raise exception 'DOGRULAMA 8: sifir kur kabul edildi.';
  exception when check_violation then null;
  end;

  -- 9) TETIKLEYICI para birimini yaziyor: NOT NULL ilk yazmada dusmez.
  declare
    v_v uuid; v_pr uuid; v_pb integer;
  begin
    select id into v_v from public.vendors limit 1;
    if v_v is not null then
      insert into public.products (vendor_id, external_id, title, price_cents, currency, stock)
           values (v_v, 'GOC-FIYAT-1', 'Goc Fiyat Testi', 1999, 'USD', 5)
        returning id into v_pr;

      select count(*) into v_pb from public.price_points
       where product_id = v_pr and currency = 'USD';
      if v_pb <> 1 then
        raise exception
          'DOGRULAMA 9: tetikleyici para birimini yazmadi -- NOT NULL ilk '
          'yazmada duserdi.';
      end if;

      -- 10) DOGRUDAN yazma da doldurulyor: yazanlar hatirlamak zorunda degil.
      insert into public.price_points (product_id, price_cents, in_stock)
           values (v_pr, 1234, true);
      if (select currency from public.price_points
           where product_id = v_pr and price_cents = 1234) is distinct from 'USD' then
        raise exception 'DOGRULAMA 10: dogrudan yazmada para birimi doldurulmadi.';
      end if;

      -- 11) ACIKCA verilen deger EZILMIYOR.
      insert into public.price_points (product_id, price_cents, in_stock, currency)
           values (v_pr, 4321, true, 'EUR');
      if (select currency from public.price_points
           where product_id = v_pr and price_cents = 4321) is distinct from 'EUR' then
        raise exception 'DOGRULAMA 11: acikca verilen para birimi ezildi.';
      end if;

      delete from public.products where id = v_pr;
    end if;
  end;

  delete from public.fx_rates where source = 'goc-dogrulama';

  raise notice
    'Fiyat para birimi ve kur kuruldu: fiyat gecmisi para birimini tasiyor, '
    'donusum salt okuma, kur yoksa NULL, gelecekteki kur gecmise uygulanmiyor.';
end $$;
