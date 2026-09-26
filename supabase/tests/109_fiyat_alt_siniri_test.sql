-- ============================================================================
-- FİYAT ALT SINIRI — 50 USD karşılığının altındaki teklif yayına girmez
-- ----------------------------------------------------------------------------
-- seed.sql sınırı geliştirme veritabanında sıfırlar; bu dosya onu ÜRETİM
-- değerine (50 USD) geri çeker ve kapıyı iki yönden sınar:
--   * altındaki teklif archived olur (USD, GBP, kuru olmayan para birimi)
--   * üstündeki teklif active kalır; fiyatı sonradan yükselen geri açılır
-- Her şey işlem içinde ve sonunda geri alınır.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

update public.listing_price_floor set amount_cents = 5000, currency = 'USD';

do $$
declare
  v_merchant uuid;
  v_group    uuid;
  v_ucuz     uuid;
  v_pahali   uuid;
  v_gbp      uuid;
  v_kursuz   uuid;
  v_durum    text;
begin
  insert into public.merchants (slug, display_name, network)
  values ('fiyat-alt-siniri-testi', 'Fiyat Alt Siniri Testi', 'direct')
  returning id into v_merchant;

  insert into public.product_groups (slug, title)
  values ('fiyat-alt-siniri-grup', 'Fiyat Alt Siniri Urunu')
  returning id into v_group;

  -- 49,99 USD: sınırın bir sent altı
  insert into public.products
    (merchant_id, external_id, group_id, title, product_url, price_cents,
     shipping_fee_cents, currency, stock, status, market_code, fulfillment)
  values (v_merchant, 'ucuz', v_group, 'Ucuz', 'https://example.invalid/1',
          4999, 0, 'USD', 5, 'active', 'US', 'affiliate')
  returning id into v_ucuz;

  -- 50,00 USD: tam sınır, geçer
  insert into public.products
    (merchant_id, external_id, group_id, title, product_url, price_cents,
     shipping_fee_cents, currency, stock, status, market_code, fulfillment)
  values (v_merchant, 'pahali', v_group, 'Pahali', 'https://example.invalid/2',
          5000, 0, 'USD', 5, 'active', 'US', 'affiliate')
  returning id into v_pahali;

  -- 30 GBP ~ 40 USD: altında
  insert into public.products
    (merchant_id, external_id, group_id, title, product_url, price_cents,
     shipping_fee_cents, currency, stock, status, market_code, fulfillment)
  values (v_merchant, 'gbp', v_group, 'Sterlin', 'https://example.invalid/3',
          3000, 0, 'GBP', 5, 'active', 'UK', 'affiliate')
  returning id into v_gbp;

  select status into v_durum from public.products where id = v_ucuz;
  if v_durum <> 'archived' then
    raise exception '49,99 USD teklif archived olmaliydi, % bulundu', v_durum;
  end if;

  select status into v_durum from public.products where id = v_pahali;
  if v_durum <> 'active' then
    raise exception '50,00 USD teklif active kalmaliydi, % bulundu', v_durum;
  end if;

  select status into v_durum from public.products where id = v_gbp;
  if v_durum <> 'archived' then
    raise exception '30 GBP teklif archived olmaliydi, % bulundu', v_durum;
  end if;

  -- Fiyat yükselince bir sonraki yazım teklifi geri açar (alım turu böyle yazar)
  update public.products set price_cents = 6000, status = 'active' where id = v_gbp;
  select status into v_durum from public.products where id = v_gbp;
  if v_durum <> 'active' then
    raise exception '60 GBP teklif active olmaliydi, % bulundu', v_durum;
  end if;

  -- Fiyat düşünce yayından iner
  update public.products set price_cents = 1000 where id = v_pahali;
  select status into v_durum from public.products where id = v_pahali;
  if v_durum <> 'archived' then
    raise exception 'fiyati dusen teklif archived olmaliydi, % bulundu', v_durum;
  end if;

  -- Kuru bilinmeyen para birimi: fail-closed
  delete from public.fx_rates where quote_currency = 'SEK';
  insert into public.products
    (merchant_id, external_id, group_id, title, product_url, price_cents,
     shipping_fee_cents, currency, stock, status, market_code, fulfillment)
  values (v_merchant, 'kursuz', v_group, 'Kursuz', 'https://example.invalid/4',
          9999999, 0, 'SEK', 5, 'active', 'SE', 'affiliate')
  returning id into v_kursuz;
  select status into v_durum from public.products where id = v_kursuz;
  if v_durum <> 'archived' then
    raise exception 'kuru olmayan teklif archived olmaliydi, % bulundu', v_durum;
  end if;

  raise notice '✓ fiyat alt siniri: altindaki arsivde, ustundeki yayinda, kur yoksa kapali';
end;
$$;

rollback;
