-- ============================================================================
-- İLAN RİSK MOTORU — anormal fiyatlı ilanı YAYINA GİRMEDEN durdurur
-- ----------------------------------------------------------------------------
-- Dolandırıcılığın pazar yerlerindeki en yaygın biçimi, gerçekçi olmayan
-- ucuzlukla ilgi toplayıp sipariş biriktirmektir. Zarar sipariş geldiğinde
-- değil, ilan YAYINA GİRDİĞİNDE başlar; bu yüzden denetim yayından sonra
-- değil, önce çalışır.
--
-- NEDEN YENİ BİR DURUM (enum) EKLENMEDİ
-- `product_status` enum'una 'pending_review' eklemek cazipti. Ama
-- `alter type ... add value` ile eklenen bir değer AYNI işlem içinde
-- kullanılamaz ve göç dosyaları `--single-transaction` ile uygulanıyor;
-- göç kendi eklediği değeri kullanamadan patlardı.
--
-- Bunun yerine tutulan ilan `draft` durumunda bırakılır. Bu bir geçici çözüm
-- değil, doğru olan: `draft` zaten "vitrinde görünmez" anlamına geliyor ve
-- arama/katalog sorgularının hepsi bunu zaten uyguluyor. Yeni bir durum
-- eklemek, o sorguların HEPSİNİ tek tek güncellemeyi gerektirirdi ve
-- unutulan bir sorgu, tutulmuş bir ilanı vitrine sızdırırdı.
--
-- Neden tutulduğu ayrı bir tabloda durur: durum tek başına "neden" bilgisini
-- taşıyamaz ve satıcıya "ilanınız neden yayında değil" diye cevap
-- verilemezdi.
-- ============================================================================

create type public.risk_severity as enum ('bilgi', 'uyari', 'engel');

create table public.product_risk_flags (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  vendor_id     uuid references public.vendors (id) on delete cascade,

  rule          text not null,
  severity      public.risk_severity not null,

  -- Kararın DAYANAĞI saklanır: hangi sayılara bakılarak tutuldu.
  -- Satıcı itiraz ettiğinde "sistem öyle dedi" demek yetmez; hangi medyan,
  -- hangi eşik, hangi fiyat -- hepsi burada.
  detail        jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references public.users (id) on delete set null,
  resolution    text
);

comment on table public.product_risk_flags is
  'Ilan risk motorunun kararlari ve dayanaklari. Cozulmemis "engel" kaydi olan urun yayina alinamaz.';

create index product_risk_flags_open_idx
  on public.product_risk_flags (product_id) where resolved_at is null;
create index product_risk_flags_vendor_idx
  on public.product_risk_flags (vendor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Eşikler tek yerde
-- ---------------------------------------------------------------------------
-- Koda gömülü sihirli sayılar, ayarlanamayan sayılardır. Buradan okunur ve
-- yönetim panelinden değiştirilebilir.
create table public.risk_thresholds (
  key         text primary key,
  value       numeric not null,
  description text not null
);

insert into public.risk_thresholds (key, value, description) values
  ('median_ratio_block', 0.40,
   'Grup medyaninin bu oraninin ALTINDAKI fiyat engellenir (0.40 = medyanin %40 alti).'),
  ('median_ratio_warn', 0.60,
   'Grup medyaninin bu oraninin altindaki fiyat uyari uretir.'),
  ('median_min_offers', 2,
   'Medyan karsilastirmasi icin gereken EN AZ baska aktif teklif sayisi.'),
  ('self_drop_ratio', 0.35,
   'Saticinin kendi onceki fiyatina gore bu oranin altina ani dusus uyari uretir.'),
  ('new_vendor_days', 30,
   'Bu gun sayisindan yeni satici "yeni" sayilir.'),
  ('new_vendor_high_value_cents', 500000,
   'Yeni saticinin bu tutarin ustundeki ilani ek incelemeye alinir (kurus).'),
  ('impossible_discount', 0.90,
   'Ustu cizili fiyata gore bu orandan buyuk indirim iddiasi engellenir.');

-- ---------------------------------------------------------------------------
-- assess_product_risk — karar verir, YAZMAZ
-- ---------------------------------------------------------------------------
-- Değerlendirme ile uygulama ayrıldı: aynı fonksiyon hem tetikleyiciden hem
-- yönetim panelinden çağrılabilsin, ve "bu ilan tutulur muydu?" sorusu yan
-- etki üretmeden yanıtlanabilsin.
create or replace function public.assess_product_risk(
  p_vendor_id   uuid,
  p_group_id    uuid,
  p_price_cents bigint,
  p_compare_at_cents bigint default null,
  p_product_id  uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_flags        jsonb := '[]'::jsonb;
  v_median       numeric;
  v_peer_count   int;
  v_prev_price   bigint;
  v_vendor_age   int;
  t_block_ratio  numeric := (select value from public.risk_thresholds where key = 'median_ratio_block');
  t_warn_ratio   numeric := (select value from public.risk_thresholds where key = 'median_ratio_warn');
  t_min_offers   int     := (select value from public.risk_thresholds where key = 'median_min_offers');
  t_self_drop    numeric := (select value from public.risk_thresholds where key = 'self_drop_ratio');
  t_new_days     int     := (select value from public.risk_thresholds where key = 'new_vendor_days');
  t_high_value   bigint  := (select value from public.risk_thresholds where key = 'new_vendor_high_value_cents');
  t_impossible   numeric := (select value from public.risk_thresholds where key = 'impossible_discount');
begin
  if p_price_cents is null or p_price_cents <= 0 then
    return jsonb_build_object('severity', 'engel', 'flags',
      jsonb_build_array(jsonb_build_object('rule', 'gecersiz_fiyat', 'severity', 'engel')));
  end if;

  -- --- 1) Grup medyanına göre anormal ucuzluk -------------------------------
  -- Ortalama DEĞİL medyan: tek bir uç fiyat ortalamayı kaydırır ve gerçek
  -- ucuzu normal, normali ucuz gösterir.
  if p_group_id is not null then
    select
      percentile_cont(0.5) within group (order by p.price_cents),
      count(*)
      into v_median, v_peer_count
    from public.products p
    where p.group_id = p_group_id
      and p.status = 'active'
      and (p_product_id is null or p.id <> p_product_id)
      and (p_vendor_id is null or p.vendor_id is distinct from p_vendor_id);

    if v_peer_count >= t_min_offers and v_median > 0 then
      if p_price_cents < v_median * t_block_ratio then
        v_flags := v_flags || jsonb_build_object(
          'rule', 'medyan_alti_asiri',
          'severity', 'engel',
          'detail', jsonb_build_object(
            'fiyat', p_price_cents, 'medyan', round(v_median),
            'oran', round(p_price_cents / v_median, 3),
            'esik', t_block_ratio, 'karsilastirilan_teklif', v_peer_count));
      elsif p_price_cents < v_median * t_warn_ratio then
        v_flags := v_flags || jsonb_build_object(
          'rule', 'medyan_alti',
          'severity', 'uyari',
          'detail', jsonb_build_object(
            'fiyat', p_price_cents, 'medyan', round(v_median),
            'oran', round(p_price_cents / v_median, 3),
            'esik', t_warn_ratio, 'karsilastirilan_teklif', v_peer_count));
      end if;
    end if;
  end if;

  -- --- 2) Satıcının kendi fiyatından ani düşüş ------------------------------
  -- Ele geçirilmiş bir satıcı hesabının ilk yaptığı iş, fiyatları dibe
  -- çekmektir.
  if p_product_id is not null then
    select price_cents into v_prev_price
      from public.price_points
     where product_id = p_product_id
     order by observed_at desc
     limit 1;

    if v_prev_price is not null and v_prev_price > 0
       and p_price_cents < v_prev_price * t_self_drop then
      v_flags := v_flags || jsonb_build_object(
        'rule', 'ani_fiyat_dususu',
        'severity', 'uyari',
        'detail', jsonb_build_object(
          'yeni_fiyat', p_price_cents, 'onceki_fiyat', v_prev_price,
          'oran', round(p_price_cents::numeric / v_prev_price, 3), 'esik', t_self_drop));
    end if;
  end if;

  -- --- 3) İmkânsız indirim iddiası ------------------------------------------
  -- "1000 TL'lik ürün 50 TL" iddiası, fiyat karşılaştırma sitesinde
  -- doğrudan yanıltıcı ticari uygulamadır.
  if p_compare_at_cents is not null and p_compare_at_cents > 0
     and p_price_cents < p_compare_at_cents * (1 - t_impossible) then
    v_flags := v_flags || jsonb_build_object(
      'rule', 'imkansiz_indirim',
      'severity', 'engel',
      'detail', jsonb_build_object(
        'fiyat', p_price_cents, 'ustu_cizili', p_compare_at_cents,
        'iddia_edilen_indirim', round(1 - p_price_cents::numeric / p_compare_at_cents, 3),
        'esik', t_impossible));
  end if;

  -- --- 4) Yeni satıcı + yüksek tutar ----------------------------------------
  -- Tek başına suç değil; diğer sinyallerle birlikte ağırlık taşır, o yüzden
  -- yalnızca 'uyari'.
  if p_vendor_id is not null and p_price_cents >= t_high_value then
    select extract(day from now() - created_at)::int into v_vendor_age
      from public.vendors where id = p_vendor_id;

    if v_vendor_age is not null and v_vendor_age < t_new_days then
      v_flags := v_flags || jsonb_build_object(
        'rule', 'yeni_satici_yuksek_tutar',
        'severity', 'uyari',
        'detail', jsonb_build_object(
          'satici_yasi_gun', v_vendor_age, 'esik_gun', t_new_days,
          'fiyat', p_price_cents, 'esik_tutar', t_high_value));
    end if;
  end if;

  return jsonb_build_object(
    'severity',
      case
        when v_flags @> '[{"severity":"engel"}]'::jsonb then 'engel'
        when jsonb_array_length(v_flags) > 0 then 'uyari'
        else 'temiz'
      end,
    'flags', v_flags);
end;
$$;

comment on function public.assess_product_risk is
  'Ilan risk degerlendirmesi. Yan etkisi yoktur; karar verir, uygulamaz.';

-- ---------------------------------------------------------------------------
-- Uygulama — tetikleyici
-- ---------------------------------------------------------------------------
create or replace function public.tg_products_risk_gate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_flag   jsonb;
begin
  /*
   * AFTER tetikleyicisi, BEFORE degil.
   *
   * Ilk yazista BEFORE INSERT idi ve risk kaydini `new.id` ile yaziyordu --
   * ama o anda urun satiri HENUZ YOK ve yabanci anahtar dusuyordu. Seed
   * verisi uygulanirken hemen ortaya cikti.
   *
   * AFTER'da satir mevcut oldugu icin kayit yazilabiliyor; durum degisikligi
   * de ayni yerden, dogrudan UPDATE ile yapiliyor. Ozyineleme riski yok:
   * o UPDATE `status = 'draft'` yaptigi icin bir sonraki cagri asagidaki ilk
   * kosuldan doner.
   */
  if new.status <> 'active' then
    return null;
  end if;

  -- Fiyat ve grup degismediyse yeniden degerlendirme yapilmaz: stok
  -- guncelleyen her besleme cagrisinda medyan hesaplamak pahalidir.
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and new.price_cents = old.price_cents
     and new.group_id is not distinct from old.group_id
     and new.compare_at_price_cents is not distinct from old.compare_at_price_cents then
    return null;
  end if;

  v_result := public.assess_product_risk(
    new.vendor_id, new.group_id, new.price_cents,
    new.compare_at_price_cents, new.id);

  if v_result ->> 'severity' = 'temiz' then
    return null;
  end if;

  -- Kayitlar her halde tutulur; 'uyari' yayini durdurmaz ama iz birakir.
  for v_flag in select * from jsonb_array_elements(v_result -> 'flags') loop
    insert into public.product_risk_flags (product_id, vendor_id, rule, severity, detail)
    values (new.id, new.vendor_id,
            v_flag ->> 'rule',
            (v_flag ->> 'severity')::public.risk_severity,
            coalesce(v_flag -> 'detail', '{}'::jsonb));
  end loop;

  if v_result ->> 'severity' = 'engel' then
    -- Yayin DURDURULUR: taslaga cekilir. Reddetmek (exception) yerine tutmak
    -- secildi -- besleme tek bir supheli kalem yuzunden tamamen dusmemeli,
    -- o kalem beklemeye alinip digerleri gecmeli.
    update public.products set status = 'draft' where id = new.id;
  end if;

  return null;
end;
$$;

create trigger products_risk_gate
  after insert or update on public.products
  for each row execute function public.tg_products_risk_gate();

-- ---------------------------------------------------------------------------
-- Yetkiler — taban kurallara uygun
-- ---------------------------------------------------------------------------
alter table public.product_risk_flags enable row level security;
alter table public.risk_thresholds    enable row level security;

-- Satıcı KENDİ ilanının neden tutulduğunu görebilmeli; göremezse düzeltemez.
create policy "risk_flags_vendor_read"
  on public.product_risk_flags for select
  using (public.owns_vendor(vendor_id) or public.is_admin());

create policy "risk_flags_admin_all"
  on public.product_risk_flags for all
  using (public.is_admin()) with check (public.is_admin());

create policy "risk_thresholds_admin"
  on public.risk_thresholds for all
  using (public.is_admin()) with check (public.is_admin());

revoke all on table public.product_risk_flags from public, anon, authenticated;
revoke all on table public.risk_thresholds    from public, anon, authenticated;
grant select on public.product_risk_flags to authenticated;

revoke execute on function public.assess_product_risk(uuid, uuid, bigint, bigint, uuid)
  from public, anon, authenticated;
revoke execute on function public.tg_products_risk_gate() from public, anon, authenticated;
grant execute on function public.assess_product_risk(uuid, uuid, bigint, bigint, uuid)
  to service_role;
