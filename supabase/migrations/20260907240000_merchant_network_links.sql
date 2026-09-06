-- ===========================================================================
-- MERCHANT ↔ AĞ BAĞLARI — merchant modelini ağdan bağımsızlaştırır
-- ===========================================================================
--
-- ÇÖZÜLEN SOMUT PROBLEM
--
-- `merchants.network`, `tracking_id` ve `deeplink_template` bir mağazanın
-- TEK bir ağ üzerinden erişildiğini varsayıyor. Gerçekte büyük bir mağaza
-- aynı anda Awin'de, CJ'de ve doğrudan anlaşmayla bulunur; komisyonu ve
-- çerez penceresi her birinde FARKLIDIR.
--
-- Bu varsayımla ölçeklenince iki şey olur, ikisi de sessiz:
--   1. Aynı mağaza her ağ için AYRI merchant satırı olarak açılır. Katalogda
--      aynı mağaza üç kez görünür, fiyat karşılaştırması kendi kendiyle
--      yapılır.
--   2. Ya da tek satır tutulur ve ağ alanı en son yazana göre değişir --
--      yani deeplink bir gün Awin'e, ertesi gün CJ'ye gider ve yanlış ağın
--      izleme kimliğiyle gönderilen her tıklama komisyonsuz kalır.
--
-- ÇÖZÜM: ağa özgü olan her şey AYRI bir tabloya taşınıyor. `merchants`
-- artık "hangi mağaza" sorusunu, `merchant_network_links` "o mağazaya hangi
-- ağdan, hangi kimlikle ulaşıyoruz" sorusunu yanıtlıyor.
--
-- ---------------------------------------------------------------------------
-- MEVCUT SÜTUNLAR DÜŞÜRÜLMÜYOR
-- ---------------------------------------------------------------------------
-- `merchants.network`, `tracking_id`, `deeplink_template` YERİNDE KALIYOR ve
-- çalışan `/git/:offerId` yolu hiç değişmiyor. Genişlet/taşı/daralt kalıbının
-- ilk adımı bu: yeni yapı yanına kuruluyor, kod taşındıktan SONRA eskisi
-- düşürülür. Aynı göçte düşürmek, çalışan gelir hattını bir dağıtımda
-- kesmek olurdu.
--
-- ---------------------------------------------------------------------------
-- MARKETPLACE SELLER İÇİN KİLİTLENMİYOR
-- ---------------------------------------------------------------------------
-- `network` burada da `merchants.network` ile aynı değer kümesinden geliyor
-- ve 'direct' dâhil. Yarın doğrudan marketplace seller onboarding'i
-- eklendiğinde o satıcı da bir merchant olur ve ağ bağı hiç açılmaz --
-- model affiliate'e kilitlenmiyor.
-- ===========================================================================

create table public.merchant_network_links (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references public.merchants (id) on delete cascade,

  network      text not null,
  /** Ağın kendi advertiser/program kimliği (Awin'de MID). */
  network_program_id text not null,

  /** Keşif kaydına bağ. NULL = bu bağ elle kuruldu. */
  program_id   uuid references public.programs (id) on delete set null,

  /*
   * Ağa özgü izleme kimliği ve deeplink şablonu. SIR DEĞİLDİR: ikisi de her
   * giden linkin içinde açıkça görünür ve yayıncıyı tanımlar, yetkilendirmez.
   * Sır olan `postback_secret`; o merchants üzerinde kalıyor.
   */
  tracking_id       text,
  deeplink_template text,

  /* Ağa özgü şartlar: aynı mağaza iki ağda FARKLI komisyon öder. */
  commission_rate    numeric(5, 4),
  cookie_window_days integer,

  is_primary   boolean not null default false,
  is_enabled   boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint merchant_network_links_network_known
    check (network = any (array['direct'::text, 'awin'::text])),

  /*
   * Aynı ağda aynı program iki merchant'a bağlanamaz. Bağlanabilseydi tek
   * bir tıklama iki mağazaya atfedilir ve gelir mutabakatı imkânsızlaşırdı.
   */
  constraint merchant_network_links_network_program_unique
    unique (network, network_program_id),

  /* Aynı mağaza aynı ağda iki kez listelenemez. */
  constraint merchant_network_links_merchant_network_unique
    unique (merchant_id, network),

  constraint merchant_network_links_program_id_not_blank
    check (length(btrim(network_program_id)) > 0),
  constraint merchant_network_links_commission_range
    check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 0.9)),
  constraint merchant_network_links_cookie_positive
    check (cookie_window_days is null or cookie_window_days > 0)
);

comment on table public.merchant_network_links is
  'Bir magazaya hangi agdan, hangi kimlikle ulastigimiz. merchants "hangi '
  'magaza" sorusunu yanitlar; ag ozgu her sey burada. Ayni magaza birden '
  'cok agda bulunabilir ve komisyonu her birinde FARKLIDIR.';

/*
 * BİRİNCİL BAĞ EN FAZLA BİR TANE.
 *
 * Kısmi tekil indeks. Olmasaydı iki bağ birden birincil işaretlenebilir ve
 * deeplink üretimi hangisini seçeceğini bilemezdi -- pratikte sıralamaya
 * göre değişen, yani turdan tura farklı bir ağa giden tıklamalar.
 */
create unique index merchant_network_links_one_primary_idx
  on public.merchant_network_links (merchant_id)
  where is_primary;

create index merchant_network_links_network_idx
  on public.merchant_network_links (network, is_enabled);

create index merchant_network_links_program_idx
  on public.merchant_network_links (program_id)
  where program_id is not null;

create trigger merchant_network_links_set_updated_at
  before update on public.merchant_network_links
  for each row execute function public.tg_set_updated_at();

-- --- Erişim: tamamen sunucu tarafı -----------------------------------------
alter table public.merchant_network_links enable row level security;
revoke all on public.merchant_network_links from anon, authenticated;
grant select, insert, update, delete on public.merchant_network_links to service_role;

-- ---------------------------------------------------------------------------
-- MAĞAZA KİMLİĞİ: ALAN ADI
-- ---------------------------------------------------------------------------
-- Aynı mağaza iki ağda farklı adlarla listelenir ("Nike", "Nike US",
-- "Nike Store"). Onları birleştirmenin tek güvenilir işareti alan adıdır.
--
-- TEKİL YAPILMIYOR: iki gerçek mağaza aynı alan adının altında yaşayabilir
-- (bölgesel mağazalar, alt markalar) ve tekillik onları birleştirmeye
-- ZORLARDI. Burada yalnız aday üretiliyor; birleştirme kararı insanın.
create or replace function public.registrable_domain(p_url text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        lower(coalesce(p_url, '')),
        '^\s*[a-z][a-z0-9+.-]*://', ''      -- şema
      ),
      '^(www\.)?([^/:?#]*).*$', '\2'        -- www, yol, port, sorgu
    ),
  '');
$$;

comment on function public.registrable_domain is
  'Adresten alan adi. Ayni magaza iki agda farkli adlarla listelenir; onlari '
  'birlestirmenin tek guvenilir isareti alan adidir.';

alter table public.merchants
  add column canonical_domain text
    generated always as (public.registrable_domain(homepage_url)) stored;

comment on column public.merchants.canonical_domain is
  'homepage_url den turetilen alan adi. TEKIL DEGIL: iki gercek magaza ayni '
  'alan adi altinda yasayabilir ve tekillik onlari birlesmeye ZORLARDI.';

create index merchants_canonical_domain_idx
  on public.merchants (canonical_domain);

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_m uuid; v_m2 uuid;
begin
  select id into v_m from public.merchants order by slug limit 1;
  select id into v_m2 from public.merchants order by slug desc limit 1;

  if v_m is null or v_m = v_m2 then
    raise notice 'Dogrulama atlandi: en az iki merchant gerekiyor.';
    return;
  end if;

  -- 1) Ayni magaza IKI agda bulunabiliyor -- modelin butun amaci bu.
  insert into public.merchant_network_links
    (merchant_id, network, network_program_id, commission_rate, is_primary)
  values (v_m, 'awin', 'GOC-MNL-1', 0.10, true);

  insert into public.merchant_network_links
    (merchant_id, network, network_program_id, commission_rate)
  values (v_m, 'direct', 'GOC-MNL-1', 0.15);

  -- 2) Ayni agda ayni program IKI magazaya baglanamaz.
  begin
    insert into public.merchant_network_links (merchant_id, network, network_program_id)
    values (v_m2, 'awin', 'GOC-MNL-1');
    raise exception
      'DOGRULAMA 2: ayni ag programi iki magazaya baglandi -- tek tiklama iki '
      'magazaya atfedilir ve gelir mutabakati imkansizlasirdi.';
  exception when unique_violation then null;
  end;

  -- 3) Ayni magaza ayni agda iki kez listelenemez.
  begin
    insert into public.merchant_network_links (merchant_id, network, network_program_id)
    values (v_m, 'awin', 'GOC-MNL-2');
    raise exception 'DOGRULAMA 3: ayni magaza ayni agda iki kez listelendi.';
  exception when unique_violation then null;
  end;

  -- 4) BIRINCIL BAG EN FAZLA BIR TANE.
  begin
    update public.merchant_network_links set is_primary = true
     where merchant_id = v_m and network = 'direct';
    raise exception
      'DOGRULAMA 4: iki birincil bag kabul edildi -- deeplink turdan tura '
      'farkli aga giderdi.';
  exception when unique_violation then null;
  end;

  -- 5) Alan adi normalizasyonu.
  if public.registrable_domain('https://www.Ornek.example/yol?x=1')
     is distinct from public.registrable_domain('http://ornek.example') then
    raise exception 'DOGRULAMA 5: ayni alan adi farkli normalize edildi.';
  end if;

  -- 6) Tablo istemciye kapali.
  if has_table_privilege('anon', 'public.merchant_network_links', 'select')
     or has_table_privilege('authenticated', 'public.merchant_network_links', 'select') then
    raise exception 'DOGRULAMA 6: ag baglari istemciye acik.';
  end if;

  delete from public.merchant_network_links where network_program_id like 'GOC-MNL-%';

  raise notice
    'Merchant ag baglari kuruldu: ayni magaza birden cok agda bulunabiliyor, '
    'ag programi tek magazaya bagli, birincil bag en fazla bir tane.';
end $$;
