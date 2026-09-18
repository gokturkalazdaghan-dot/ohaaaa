alter table public.price_points
  add column currency char(3) references public.currencies (code);

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

create index price_points_product_currency_idx
  on public.price_points (product_id, currency, observed_at desc);

create or replace function public.tg_products_record_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.price_cents is distinct from old.price_cents
     or (new.stock > 0) is distinct from (old.stock > 0) then

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

create table public.fx_rates (
  base_currency  char(3) not null references public.currencies (code),
  quote_currency char(3) not null references public.currencies (code),
  rate           numeric(20, 10) not null check (rate > 0),
  as_of          date not null,
  source         text not null,
  fetched_at     timestamptz not null default now(),

  primary key (base_currency, quote_currency, as_of),

  constraint fx_rates_source_not_blank check (length(btrim(source)) > 0),
  constraint fx_rates_not_identity check (base_currency <> quote_currency)
);

comment on table public.fx_rates is
  'Tarihli kurlar. Kaynak ZORUNLU: kaynagi bilinmeyen bir kur, '
  'denetlenemeyen bir fiyat demektir.';

create index fx_rates_lookup_idx
  on public.fx_rates (base_currency, quote_currency, as_of desc);

create or replace function public.convert_money_cents(
  p_amount_cents bigint,
  p_from char(3),
  p_to   char(3),
  p_as_of date default current_date
)
returns bigint
language sql
stable
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

alter table public.fx_rates enable row level security;
create policy fx_rates_public_read on public.fx_rates for select using (true);
revoke all on public.fx_rates from anon, authenticated;
grant select on public.fx_rates to anon, authenticated;
grant select, insert, update, delete on public.fx_rates to service_role;

do $$
declare v_sonuc bigint;
begin
  if public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-07') is not null then
    raise exception
      'DOGRULAMA 1: kursuz donusum bir sayi dondurdu -- uydurma fiyat gercek '
      'gibi gorunurdu.';
  end if;

  if public.convert_money_cents(1000, 'USD', 'USD', date '2026-09-07') <> 1000 then
    raise exception 'DOGRULAMA 2: ayni para birimi degisti.';
  end if;

  insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
  values ('USD', 'TRY', 40.0000000000, date '2026-09-01', 'goc-dogrulama');

  v_sonuc := public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-07');
  if v_sonuc <> 40000 then
    raise exception 'DOGRULAMA 3: donusum yanlis (%).', v_sonuc;
  end if;

  insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
  values ('USD', 'TRY', 50.0000000000, date '2026-09-10', 'goc-dogrulama');

  v_sonuc := public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-07');
  if v_sonuc <> 40000 then
    raise exception
      'DOGRULAMA 4: gecmis bir fiyat GELECEKTEKI kurla cevrildi -- o gun var '
      'olmayan bir bilgi kullanildi (%).', v_sonuc;
  end if;

  if public.convert_money_cents(1000, 'USD', 'TRY', date '2026-09-11') <> 50000 then
    raise exception 'DOGRULAMA 5: yeni kur uygulanmadi.';
  end if;

  begin
    insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
    values ('EUR', 'TRY', 45, date '2026-09-01', '   ');
    raise exception 'DOGRULAMA 6: kaynaksiz kur kabul edildi.';
  exception when check_violation then null;
  end;

  begin
    insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
    values ('USD', 'USD', 1, date '2026-09-01', 'x');
    raise exception 'DOGRULAMA 7: kendine kur kabul edildi.';
  exception when check_violation then null;
  end;

  begin
    insert into public.fx_rates (base_currency, quote_currency, rate, as_of, source)
    values ('EUR', 'TRY', 0, date '2026-09-01', 'x');
    raise exception 'DOGRULAMA 8: sifir kur kabul edildi.';
  exception when check_violation then null;
  end;

  declare
    v_v uuid; v_pr uuid; v_pb integer;
  begin
    select id into v_v from public.vendors limit 1;
    if v_v is not null then
      insert into public.products
        (vendor_id, external_id, title, price_cents, currency, stock, market_code)
           values (v_v, 'GOC-FIYAT-1', 'Goc Fiyat Testi', 1999, 'USD', 5,
                   (select code from public.markets order by code limit 1))
        returning id into v_pr;

      select count(*) into v_pb from public.price_points
       where product_id = v_pr and currency = 'USD';
      if v_pb <> 1 then
        raise exception
          'DOGRULAMA 9: tetikleyici para birimini yazmadi -- NOT NULL ilk '
          'yazmada duserdi.';
      end if;

      insert into public.price_points (product_id, price_cents, in_stock)
           values (v_pr, 1234, true);
      if (select currency from public.price_points
           where product_id = v_pr and price_cents = 1234) is distinct from 'USD' then
        raise exception 'DOGRULAMA 10: dogrudan yazmada para birimi doldurulmadi.';
      end if;

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