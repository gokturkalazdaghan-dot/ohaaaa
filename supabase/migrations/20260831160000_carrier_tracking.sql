-- ============================================================================
-- KARGO TAKİP DOĞRULAMASI — sahte takip numarasını engelle
-- ----------------------------------------------------------------------------
-- Satıcı siparişi "kargolandı" işaretlerken bir takip numarası giriyordu ve o
-- numara HİÇ DOĞRULANMIYORDU. Uydurma bir numara girip siparişi kargolanmış
-- göstermek, hem alıcıyı bekletir hem de kargo süresi ihlalini gizler:
-- satıcı gecikmeyi cezasız atlatır.
--
-- İKİ KADEMELİ DOĞRULAMA
--   1. BİÇİM (şimdi çalışıyor) — her kargo firmasının takip numarası belli
--      bir kalıptadır. Kalıba uymayan numara zaten sahtedir ve dış servise
--      hiç gitmeden reddedilir. Bu, API anahtarı olmadan da çalışır.
--   2. FİRMA API'Sİ (anahtar girildiğinde) — numaranın gerçekten o firmada
--      var olduğunu sorar. Doğrulama durumu satırda tutulur; anahtar
--      yokken 'dogrulanmadi' kalır, uydurulmaz.
--
-- Neden iki kademe: biçim denetimi tek başına yeterli değil (kalıba uyan
-- rastgele bir numara üretilebilir) ama HEMEN çalışır ve en kaba sahteciliği
-- keser. "Her şey ya da hiç" beklemek, hiçbir korumanın olmaması demekti.
-- ============================================================================

create type public.tracking_verification as enum (
  'dogrulanmadi',   -- firma API'si bagli degil; bicim gecerli
  'dogrulandi',     -- firma numarayi tanidi
  'bulunamadi'      -- firma numarayi TANIMADI -> sahte takip supheli
);

create table public.carriers (
  code            text primary key,
  name            text not null,
  -- Takip numarasi kalibi. Firma degistirdiginde SQL degil bu satir
  -- guncellenir; kod dagitimi beklemeden duzeltilebilsin diye.
  number_pattern  text not null,
  tracking_url    text,
  is_active       boolean not null default true
);

comment on column public.carriers.number_pattern is
  'Takip numarasi bicim kalibi (POSIX regex). Firma kalibi degistirirse yalnizca bu satir guncellenir.';

insert into public.carriers (code, name, number_pattern, tracking_url) values
  ('yurtici',  'Yurtiçi Kargo',  '^[0-9]{10,14}$',
   'https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code={no}'),
  ('aras',     'Aras Kargo',     '^[0-9]{10,13}$',
   'https://kargotakip.araskargo.com.tr/?code={no}'),
  ('mng',      'MNG Kargo',      '^[0-9]{10,14}$',
   'https://kargotakip.mngkargo.com.tr/?takipNo={no}'),
  ('ptt',      'PTT Kargo',      '^[0-9A-Z]{13}$',
   'https://gonderitakip.ptt.gov.tr/Track/Verify?q={no}'),
  ('surat',    'Sürat Kargo',    '^[0-9]{10,14}$', null),
  ('ups',      'UPS',            '^1Z[0-9A-Z]{16}$',
   'https://www.ups.com/track?tracknum={no}'),
  ('diger',    'Diğer',          '^[0-9A-Za-z-]{6,32}$', null);

alter table public.vendor_orders
  add column if not exists tracking_verified public.tracking_verification,
  add column if not exists tracking_checked_at timestamptz;

-- ---------------------------------------------------------------------------
-- Biçim denetimi
-- ---------------------------------------------------------------------------
create or replace function public.validate_tracking_number(
  p_carrier text,
  p_number  text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_pattern text;
begin
  if p_carrier is null or p_number is null then
    return false;
  end if;

  select number_pattern into v_pattern
    from public.carriers
   where code = lower(trim(p_carrier)) and is_active;

  -- Tanimsiz firma kabul EDILMEZ. Serbest metin kabul etseydik, satici
  -- "kargom" yazip her kalibi gecerdi ve denetim anlamsizlasirdi.
  if v_pattern is null then
    return false;
  end if;

  -- Bosluk ve tire temizlenir: firma sitesinden kopyalanan numara bunlari
  -- tasiyabilir ve bu bir sahtecilik degil, bicim gurultusudur.
  return regexp_replace(upper(trim(p_number)), '[\s-]', '', 'g') ~ v_pattern;
end;
$$;

-- ---------------------------------------------------------------------------
-- Kargolama anında zorunlu denetim
-- ---------------------------------------------------------------------------
create or replace function public.tg_vendor_orders_check_tracking()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Yalnizca KARGOLANDI'ya gecerken denetlenir. Teslim/iptal gibi sonraki
  -- gecislerde numara zaten dogrulanmis olur ve tekrar sinamak gereksiz.
  if new.status is distinct from 'shipped' or old.status = 'shipped' then
    return new;
  end if;

  if new.carrier is null or new.tracking_number is null then
    raise exception 'OHAAAA_TRACKING_REQUIRED: kargo firmasi ve takip numarasi zorunludur'
      using errcode = 'check_violation';
  end if;

  if not public.validate_tracking_number(new.carrier, new.tracking_number) then
    raise exception
      'OHAAAA_TRACKING_INVALID: takip numarasi % firmasinin bicimine uymuyor', new.carrier
      using errcode = 'check_violation';
  end if;

  -- Bicim gecerli ama firma API'si henuz sorulmadi. Durum UYDURULMAZ:
  -- 'dogrulandi' demek, sormadigimiz bir seyi bildigimizi iddia etmek olurdu.
  new.tracking_verified := 'dogrulanmadi';
  new.tracking_checked_at := now();
  return new;
end;
$$;

create trigger vendor_orders_check_tracking
  before update on public.vendor_orders
  for each row execute function public.tg_vendor_orders_check_tracking();

-- ---------------------------------------------------------------------------
-- Firma API'si "bulunamadi" derse: ihlal puani
-- ---------------------------------------------------------------------------
-- Sozlesme md. 7: sahte takip numarasi 50 puan. Puan burada elle yazilmiyor,
-- record_violation kural tablosundan okuyor.
create or replace function public.mark_tracking_missing(p_vendor_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_vendor uuid;
  v_order  uuid;
  v_no     text;
begin
  select vendor_id, order_id, tracking_number
    into v_vendor, v_order, v_no
    from public.vendor_orders where id = p_vendor_order_id;

  if v_vendor is null then
    raise exception 'OHAAAA_NOT_FOUND: siparis bulunamadi'
      using errcode = 'no_data_found';
  end if;

  update public.vendor_orders
     set tracking_verified = 'bulunamadi', tracking_checked_at = now()
   where id = p_vendor_order_id;

  return public.record_violation(
    v_vendor, 'sahte_takip', v_order,
    jsonb_build_object('vendor_order_id', p_vendor_order_id, 'tracking_number', v_no));
end;
$$;

-- ---------------------------------------------------------------------------
-- Yetkiler
-- ---------------------------------------------------------------------------
alter table public.carriers enable row level security;
-- Firma listesi herkese acik okunur: satici hangi kodu kullanacagini,
-- alici da takip baglantisini gormeli.
create policy "carriers_read" on public.carriers for select using (true);
create policy "carriers_admin" on public.carriers for all
  using (public.is_admin()) with check (public.is_admin());

revoke all on table public.carriers from public, anon, authenticated;
grant select on public.carriers to anon, authenticated;

revoke execute on function public.tg_vendor_orders_check_tracking()
  from public, anon, authenticated;
revoke execute on function public.mark_tracking_missing(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_tracking_missing(uuid) to service_role;
grant execute on function public.validate_tracking_number(text, text)
  to authenticated, service_role;
