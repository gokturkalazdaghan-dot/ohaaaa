-- ===========================================================================
-- merchants.network — DB seviyesinde kontrollü değerler
-- ---------------------------------------------------------------------------
-- Sütun `text not null default 'direct'` idi: herhangi bir dize kabul
-- ediyordu ve kod tarafında zaten hiç okunmuyordu. Sağlayıcı kaydı
-- (`@ohaaaa/shared/providers`) devreye girdiğine göre, veritabanının tanıdığı
-- ağ listesi ile kodun tanıdığı liste AYNI olmalıdır.
--
-- Neden bu önemli: yanlış yazılmış bir `network` değeri, o mağazanın
-- bildirimlerinin YANLIŞ imza şemasıyla doğrulanmasına yol açardı. Kayıt
-- katmanı bunu artık reddediyor (`getProvider` hata fırlatıyor); bu kısıt
-- aynı hatanın veritabanına hiç yazılamamasını sağlıyor.
--
-- YENİ AĞ EKLEME (Amazon, Impact, CJ …):
--   1. packages/shared/src/providers/<ag>.ts
--   2. registry.ts içindeki PROVIDERS dizisine bir satır
--   3. bu kısıta bir değer (tek satırlık migration)
-- `/git/:offerId`, clicks, conversions ve open-redirect savunması değişmez.
-- ===========================================================================

-- Beklenmeyen bir değer varsa SESSİZCE düzeltmek yerine durulur: hangi
-- mağazanın hangi ağa ait olduğu bir tahmin işi değildir.
do $$
declare
  v_bilinmeyen text;
begin
  select string_agg(distinct network, ', ')
    into v_bilinmeyen
  from public.merchants
  where network not in ('direct', 'awin');

  if v_bilinmeyen is not null then
    raise exception
      'merchants.network icinde taninmayan deger(ler) var: %. Once bunlari duzeltin.',
      v_bilinmeyen;
  end if;
end;
$$;

alter table public.merchants
  drop constraint if exists merchants_network_known;

alter table public.merchants
  add constraint merchants_network_known
  check (network in ('direct', 'awin'));

comment on column public.merchants.network is
  'Ortaklik agi. Kod tarafindaki saglayici kaydiyla (providers/registry.ts) '
  'AYNI listedir; ikisi ayrisirsa postback yanlis semayla dogrulanir.';
