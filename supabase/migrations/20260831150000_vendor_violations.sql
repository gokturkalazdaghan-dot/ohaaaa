-- ============================================================================
-- SATICI İHLAL PUANI — sözleşmedeki tablo, çalışan hâliyle
-- ----------------------------------------------------------------------------
-- Satıcı sözleşmesinde bir ceza puanı tablosu ve üç kademe yazıyor. Sözleşmede
-- yazıp sistemde uygulamamak, uygulanamayan bir yaptırım demektir: satıcı
-- ihlal eder, hiçbir şey olmaz, sözleşme kâğıt üstünde kalır.
--
-- Sayılar sözleşmeyle BİREBİR aynı tutuldu. Ayrışırlarsa hangisinin geçerli
-- olduğu tartışma konusu olur ve bu tartışmayı platform kaybeder.
-- ============================================================================

create table public.violation_rules (
  code        text primary key,
  points      smallint not null check (points > 0 and points <= 100),
  label       text not null,
  penalty     text not null
);

insert into public.violation_rules (code, points, label, penalty) values
  ('kargo_gecikmesi',   5,   'Kargo süresinin aşılması',            'Sipariş bedelinin %5''i'),
  ('stok_iptali',       10,  'Stok yokluğu nedeniyle iptal',        'Sipariş bedelinin %10''u'),
  ('ambalaj_ihlali',    10,  'Ambalaj / marka şartına aykırılık',   'Sabit tutar'),
  ('iade_reddi',        25,  'Gerekçesiz iade reddi',               'Sipariş bedelinin %25''i'),
  ('sahte_takip',       50,  'Sahte / başka gönderiye ait takip no', 'Sipariş bedelinin %50''si'),
  ('farkli_urun',       50,  'İlandan farklı ürün gönderilmesi',    'Sipariş bedelinin %100''ü'),
  ('taklit_urun',       100, 'Taklit / sahte ürün satışı',          'Sipariş bedelinin %100''ü + fesih');

create table public.vendor_violations (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references public.vendors (id) on delete cascade,
  rule_code    text not null references public.violation_rules (code),
  points       smallint not null,
  order_id     uuid references public.orders (id) on delete set null,
  detail       jsonb not null default '{}'::jsonb,

  created_at   timestamptz not null default now(),
  -- Puan 12 ay sonra düşer (sözleşme md. 7.2). Süre tarihe yazılır, işe
  -- bırakılmaz: zamanlanmış bir görev çalışmazsa puan sonsuza kadar kalırdı.
  expires_at   timestamptz not null default now() + interval '12 months',

  -- İtiraz kabul edilirse puan SİLİNMEZ, kaldırılır: kaydın kendisi ve
  -- kaldırılma gerekçesi denetim izi olarak durur.
  waived_at    timestamptz,
  waived_by    uuid references public.users (id) on delete set null,
  waive_reason text
);

create index vendor_violations_active_idx
  on public.vendor_violations (vendor_id) where waived_at is null;

-- ---------------------------------------------------------------------------
-- Yürürlükteki puan ve kademe
-- ---------------------------------------------------------------------------
create or replace function public.vendor_violation_score(p_vendor_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(points), 0)::integer
    from public.vendor_violations
   where vendor_id = p_vendor_id
     and waived_at is null
     and expires_at > now();
$$;

-- Kademeler sözleşme md. 7.2 ile aynı: 50 / 75 / 100.
create or replace function public.vendor_violation_tier(p_vendor_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when public.vendor_violation_score(p_vendor_id) >= 100 then 'kapali'
    when public.vendor_violation_score(p_vendor_id) >= 75  then 'siparis_durduruldu'
    when public.vendor_violation_score(p_vendor_id) >= 50  then 'siralamada_geride'
    else 'normal'
  end;
$$;

-- ---------------------------------------------------------------------------
-- İhlal kaydı — puanı kuraldan OKUR
-- ---------------------------------------------------------------------------
-- Puanı çağıran taraf gönderseydi, aynı ihlal iki farklı yerden iki farklı
-- puanla işlenebilirdi ve sözleşmeden sapardı.
create or replace function public.record_violation(
  p_vendor_id uuid,
  p_rule_code text,
  p_order_id  uuid default null,
  p_detail    jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_points smallint;
  v_score  integer;
  v_tier   text;
begin
  select points into v_points from public.violation_rules where code = p_rule_code;
  if v_points is null then
    raise exception 'OHAAAA_UNKNOWN_RULE: tanimsiz ihlal kodu %', p_rule_code
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.vendor_violations (vendor_id, rule_code, points, order_id, detail)
  values (p_vendor_id, p_rule_code, v_points, p_order_id, coalesce(p_detail, '{}'::jsonb));

  v_score := public.vendor_violation_score(p_vendor_id);
  v_tier  := public.vendor_violation_tier(p_vendor_id);

  -- 100 puan: mağaza kapanır. Kapatma OTOMATİK; sözleşme md. 7.2 bunu
  -- taahhüt ediyor ve elle yapılmaya bırakılırsa taahhüt tutulmaz.
  if v_tier = 'kapali' then
    update public.vendors set status = 'suspended' where id = p_vendor_id;
    -- Vitrindeki ürünler de iner: kapalı bir mağazanın ürünü satılamaz.
    update public.products set status = 'draft'
     where vendor_id = p_vendor_id and status = 'active';
  end if;

  return jsonb_build_object('points', v_points, 'score', v_score, 'tier', v_tier);
end;
$$;

-- ---------------------------------------------------------------------------
-- Yetkiler
-- ---------------------------------------------------------------------------
alter table public.vendor_violations enable row level security;
alter table public.violation_rules   enable row level security;

-- Satıcı kendi ihlallerini görebilmeli; göremezse itiraz edemez
-- (sözleşme md. 8.3).
create policy "violations_vendor_read" on public.vendor_violations for select
  using (public.owns_vendor(vendor_id) or public.is_admin());
create policy "violations_admin_all" on public.vendor_violations for all
  using (public.is_admin()) with check (public.is_admin());

-- Kural tablosu herkese açık okunur: satıcı hangi ihlalin kaç puan
-- olduğunu bilmeden kurala uyamaz.
create policy "violation_rules_read" on public.violation_rules for select using (true);

revoke all on table public.vendor_violations from public, anon, authenticated;
revoke all on table public.violation_rules   from public, anon, authenticated;
grant select on public.vendor_violations to authenticated;
grant select on public.violation_rules to anon, authenticated;

revoke execute on function public.record_violation(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_violation(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.vendor_violation_score(uuid) to authenticated, service_role;
grant execute on function public.vendor_violation_tier(uuid)  to authenticated, service_role;
