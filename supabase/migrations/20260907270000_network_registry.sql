-- ===========================================================================
-- AĞ KAYDI — yeni ortaklık ağı eklemek ŞEMA DEĞİŞİKLİĞİ olmaktan çıkıyor
-- ===========================================================================
--
-- ÇÖZÜLEN SOMUT PROBLEM
--
-- Bugün ağ listesi DÖRT ayrı CHECK kısıtında sabit yazılı:
--   merchants_network_known
--   programs_network_known
--   merchant_network_links_network_known
--   program_application_attempts_network_known
--
-- Onuncu ağ eklenirken dördünün de değişmesi gerekir. Biri unutulursa
-- sonuç sessizdir ve yalnız o yolda ortaya çıkar: keşif turu programı
-- yazar, başvuru motoru denetim satırını yazamaz -- yani gerçekten
-- yapılmış bir dış eylem kayıtsız kalır.
--
-- Ülke, pazar ve para birimi için aynı karar zaten verilmişti
-- (`countries`, `markets`, `currencies` referans tabloları). Ağ da aynı
-- kalıba geçiyor: yeni ağ bir SATIR, bir göç değil.
--
-- ---------------------------------------------------------------------------
-- SÖZLEŞME DURUMU VERİDE
-- ---------------------------------------------------------------------------
-- `contract_verified` bir ağın sözleşmesinin DOĞRULANIP doğrulanmadığını
-- söylüyor. Kod tarafındaki kanıt kaydının (`capabilityEvidence`) veri
-- tarafındaki karşılığı: panelde "hangi ağa bakılacak" sorusu buradan
-- yanıtlanıyor. Varsayılan FALSE -- doğrulanmamışlık varsayılan olmalı,
-- aksi hâlde eklenen her ağ kendini doğrulanmış ilan ederdi.
-- ===========================================================================

create table public.affiliate_networks (
  code         text primary key,
  display_name text not null,

  /*
   * Sözleşmesi doğrulandı mı. Kod tarafındaki `CapabilityEvidence` ile
   * aynı soruyu yanıtlar. Varsayılan FALSE: doğrulanmamışlık varsayılan
   * olmalı.
   */
  contract_verified boolean not null default false,

  /** Resmî doküman adresi. NULL = henüz bakılmadı. */
  docs_url     text,
  /** Doğrulamanın yapıldığı an. NULL = doğrulanmadı. */
  verified_at  timestamptz,

  /** Neden bu durumda. Boş bırakılamaz. */
  note         text not null,

  /*
   * DIŞ ağ mı. `direct` bizim kendi HMAC şemamız: sözleşmeyi biz
   * tanımlıyoruz, dolayısıyla gösterilecek bir DIŞ doküman yok. Bir
   * marketplace seller ya da doğrudan anlaşma da aynı yere düşecek.
   *
   * Bu ayrım olmasaydı `direct` için sahte bir doküman adresi uydurmak
   * gerekirdi -- yani kanıt kuralını kanıt uydurarak geçmek.
   */
  is_external  boolean not null default true,

  is_enabled   boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint affiliate_networks_code_shape
    check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint affiliate_networks_note_not_blank
    check (length(btrim(note)) > 0),

  /*
   * DOĞRULANMIŞ bir ağ KANIT taşımak zorunda. Taşımasaydı "doğrulandı"
   * bir hatıraya dayanabilirdi ve o hatıra, var olmayan bir uç noktaya
   * gerçek istek göndermek demek.
   */
  constraint affiliate_networks_verified_needs_evidence
    check (
      not contract_verified
      or not is_external
      or (docs_url is not null and docs_url like 'https://%' and verified_at is not null)
    ),

  /* İç ağın dış dokümanı olamaz: sözleşmeyi biz tanımlıyoruz. */
  constraint affiliate_networks_internal_has_no_docs
    check (is_external or docs_url is null)
);

comment on table public.affiliate_networks is
  'Taninan ortaklik aglari. Yeni ag bir SATIR, bir goc degil: liste dort '
  'ayri CHECK kisitinda sabit yaziliydi ve biri unutulursa sonuc sessizdi.';

comment on column public.affiliate_networks.contract_verified is
  'Sozlesme dogrulandi mi. Varsayilan FALSE -- aksi halde eklenen her ag '
  'kendini dogrulanmis ilan ederdi.';

create trigger affiliate_networks_set_updated_at
  before update on public.affiliate_networks
  for each row execute function public.tg_set_updated_at();

-- --- Tanınan ağlar ---------------------------------------------------------
-- `direct` ve `awin` MEVCUT ve calisan yollar; digerleri kod tarafinda her
-- yetenegi `unavailable` olan kayitlarla birebir ayni durumda.
insert into public.affiliate_networks (code, display_name, contract_verified, is_external, note) values
  ('direct',       'Doğrudan anlaşma', true, false,
   'Kendi HMAC postback semamiz. IC sozlesme: gosterilecek bir DIS dokuman '
   'yok, cunku sozlesmeyi biz tanimliyoruz.'),
  ('awin',         'Awin',             false, true,
   'Deeplink sablonu operator tarafindan dogrulandi; API sozlesmesi (kesif, '
   'basvuru, feed, postback) DOGRULANMADI.'),
  ('cj',           'CJ Affiliate',     false, true, 'Sozlesme dogrulanmadi.'),
  ('daisycon',     'Daisycon',         false, true, 'Sozlesme dogrulanmadi.'),
  ('tradedoubler', 'Tradedoubler',     false, true, 'Sozlesme dogrulanmadi.'),
  ('rakuten',      'Rakuten Advertising', false, true, 'Sozlesme dogrulanmadi.'),
  ('impact',       'Impact',           false, true, 'Sozlesme dogrulanmadi.'),
  ('partnerize',   'Partnerize',       false, true, 'Sozlesme dogrulanmadi.'),
  ('admitad',      'Admitad',          false, true, 'Sozlesme dogrulanmadi.'),
  ('webgains',     'Webgains',         false, true, 'Sozlesme dogrulanmadi.'),
  ('tradetracker', 'TradeTracker',     false, true, 'Sozlesme dogrulanmadi.');

-- ---------------------------------------------------------------------------
-- SABİT LİSTELER YABANCI ANAHTARA DÖNÜYOR
-- ---------------------------------------------------------------------------
-- CHECK kisiti FK ile degistiriliyor: artik tek bir dogruluk kaynagi var ve
-- yeni ag eklemek dort kisiti degil bir satiri degistiriyor.
alter table public.merchants
  drop constraint if exists merchants_network_known;
alter table public.merchants
  add constraint merchants_network_fk
    foreign key (network) references public.affiliate_networks (code);

alter table public.programs
  drop constraint if exists programs_network_known;
alter table public.programs
  add constraint programs_network_fk
    foreign key (network) references public.affiliate_networks (code);

alter table public.merchant_network_links
  drop constraint if exists merchant_network_links_network_known;
alter table public.merchant_network_links
  add constraint merchant_network_links_network_fk
    foreign key (network) references public.affiliate_networks (code);

alter table public.program_application_attempts
  drop constraint if exists program_application_attempts_network_known;
alter table public.program_application_attempts
  add constraint program_application_attempts_network_fk
    foreign key (network) references public.affiliate_networks (code);

-- --- Erişim ----------------------------------------------------------------
-- Ag listesi is istihbarati degil ama YAZMA yetkisi istemciye acilmaz:
-- bir ag satiri eklemek, o aga trafik gonderilebilir hale getirmektir.
alter table public.affiliate_networks enable row level security;
revoke all on public.affiliate_networks from anon, authenticated;
grant select, insert, update on public.affiliate_networks to service_role;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  -- 1) Onbir ag tanindi.
  if (select count(*) from public.affiliate_networks) <> 11 then
    raise exception 'DOGRULAMA 1: beklenen 11 ag kaydedilmedi.';
  end if;

  -- 2) YALNIZ direct dogrulanmis. awin'in deeplink'i calisiyor ama API
  --    sozlesmesi dogrulanmadi; ikisini karistirmak, dogrulanmamis bir
  --    uc noktaya gercek istek gondermek olurdu.
  if (select count(*) from public.affiliate_networks where contract_verified) <> 1 then
    raise exception 'DOGRULAMA 2: dogrulanmis ag sayisi 1 degil.';
  end if;

  -- 3) KANITSIZ "dogrulandi" REDDEDILIYOR.
  begin
    update public.affiliate_networks set contract_verified = true where code = 'cj';
    raise exception
      'DOGRULAMA 3: kanitsiz dogrulama kabul edildi -- var olmayan bir uc '
      'noktaya gercek istek giderdi.';
  exception when check_violation then null;
  end;

  -- 4) Kanit varsa dogrulama serbest: kapatma fazla kapatmamis.
  update public.affiliate_networks
     set contract_verified = true, docs_url = 'https://ornek.example/docs', verified_at = now()
   where code = 'cj';
  update public.affiliate_networks
     set contract_verified = false, docs_url = null, verified_at = null
   where code = 'cj';

  -- 4b) IC AG kanit istemiyor ama DIS dokuman da tasiyamaz.
  begin
    update public.affiliate_networks set docs_url = 'https://ornek.example/x' where code = 'direct';
    raise exception
      'DOGRULAMA 4b: ic ag dis dokuman tasidi -- sozlesmeyi biz tanimliyoruz.';
  exception when check_violation then null;
  end;

  -- 5) TANINMAYAN ag hala reddediliyor -- FK kisiti CHECK'in yerini aldi.
  begin
    insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
         values ('bilinmeyen-ag', 'GOC-AG-1', 'Bilinmeyen', now());
    raise exception 'DOGRULAMA 5: taninmayan ag kabul edildi.';
  exception when foreign_key_violation then null;
  end;

  -- 6) YENI ag artik SATIR: goc gerekmeden calisiyor.
  insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
       values ('cj', 'GOC-AG-2', 'CJ Test Program', now())
    returning id into v_id;
  delete from public.programs where id = v_id;

  -- 7) Kullanimda olan ag SILINEMIYOR: FK koruyor.
  insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
       values ('cj', 'GOC-AG-3', 'CJ Test', now()) returning id into v_id;
  begin
    delete from public.affiliate_networks where code = 'cj';
    raise exception 'DOGRULAMA 7: kullanimda olan ag silindi.';
  exception when foreign_key_violation then null;
  end;
  delete from public.programs where id = v_id;

  raise notice
    'Ag kaydi kuruldu: 11 ag, yalniz direct dogrulanmis, kanitsiz dogrulama '
    'reddediliyor, yeni ag artik bir SATIR.';
end $$;
