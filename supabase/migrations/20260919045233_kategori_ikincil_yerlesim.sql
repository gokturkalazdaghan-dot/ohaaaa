-- ============================================================================
-- IKINCIL YERLESIM — bir kavram, tek kimlik, iki gezinme yolu
-- ============================================================================
-- Kanonik spec yedi adi IKI AYRI Seviye-1 altinda sayiyor ("Saat" hem Moda
-- hem Taki altinda, "Oyuncak" hem Oyuncak hem Anne & Bebek altinda...).
--
-- NEDEN IKINCI BIR SATIR ACILMADI
-- Acilsaydi kural 9 ihlal edilirdi (yinelenen kanonik kategori) ve daha
-- kotusu: ayni kavramin urunleri IKI KIMLIGE bolunurdu. Fiyat
-- karsilastirmasinin tek isi ayni urunu bir araya getirmek; kategoriyi
-- ikiye bolmek tam da bunu bozardi. Iki "Saat" sayfasi, her biri yarim
-- katalog demekti.
--
-- ONUN YERINE: kategori TEK bir kanonik evde kaliyor (kimlik ve slug sabit,
-- kural 10 ve 11), menude ikinci bir Seviye-1 altinda da GORUNUYOR.
--
-- ----------------------------------------------------------------------------
-- BU TABLO URUN TASIMAZ
-- ----------------------------------------------------------------------------
-- Yalnizca GEZINMEYI etkiler. Hicbir urunun category_id'si degismez, hicbir
-- teklif/fiyat/SEO iliskisi kurulmaz veya bozulmaz. `/kategori/<slug>` hala
-- tek bir sayfadir; yalnizca ona giden yol sayisi artar.
-- ============================================================================

create table if not exists public.category_secondary_parents (
  category_id uuid not null references public.categories (id) on delete cascade,
  parent_id   uuid not null references public.categories (id) on delete cascade,
  sort_order  int  not null default 100,
  note        text not null,
  created_at  timestamptz not null default now(),

  primary key (category_id, parent_id),

  -- Kendi kendinin cocugu olamaz.
  constraint category_secondary_parents_kendine_degil
    check (category_id <> parent_id),
  constraint category_secondary_parents_note_dolu
    check (length(btrim(note)) > 0)
);

comment on table public.category_secondary_parents is
  'Bir kategorinin IKINCIL gezinme yeri. Urun tasimaz, category_id degistirmez; '
  'yalnizca menude ikinci bir ust kategori altinda gorunmesini saglar. Ayni '
  'kavram icin ikinci bir kategori satiri acmaya alternatiftir.';

create index if not exists category_secondary_parents_parent_idx
  on public.category_secondary_parents (parent_id);

alter table public.category_secondary_parents enable row level security;

-- Menu herkese acik: anon okumali. Yazma yalnizca sunucuda.
drop policy if exists category_secondary_parents_okuma on public.category_secondary_parents;
create policy category_secondary_parents_okuma
  on public.category_secondary_parents for select
  to anon, authenticated using (true);

grant select on public.category_secondary_parents to anon, authenticated;
grant select, insert, update, delete on public.category_secondary_parents to service_role;

-- ----------------------------------------------------------------------------
-- KORUMA: ikincil ebeveyn BIRINCIL ebeveynin tekrari olamaz; ebeveyn KOK olmali
-- ----------------------------------------------------------------------------
-- Birincil ebeveynin tekrari, menude ayni kategoriyi ayni yerde IKI KEZ
-- gostermek olurdu. Kok olmayan bir ebeveyn ise ucuncu bir seviye acardi ve
-- menu iki seviye cizdigi icin kategori HIC gorunmezdi -- sessiz kayip.
create or replace function public.tg_ikincil_yerlesim_dogrula()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_birincil uuid;
  v_ebeveyn_ust uuid;
  v_ebeveyn_var boolean;
begin
  select parent_id into v_birincil from public.categories where id = new.category_id;
  if v_birincil is not distinct from new.parent_id then
    raise exception 'Ikincil ebeveyn birincil ile ayni olamaz (kategori %)', new.category_id;
  end if;

  select true, parent_id into v_ebeveyn_var, v_ebeveyn_ust
    from public.categories where id = new.parent_id;
  if not coalesce(v_ebeveyn_var, false) then
    raise exception 'Ikincil ebeveyn bulunamadi (%)', new.parent_id;
  end if;
  if v_ebeveyn_ust is not null then
    raise exception
      'Ikincil ebeveyn bir Seviye-1 kategori olmali; % bir alt kategori (menu iki seviye cizer, aksi halde kategori hic gorunmez)',
      new.parent_id;
  end if;

  return new;
end $$;

comment on function public.tg_ikincil_yerlesim_dogrula is
  'Ikincil yerlesimin birincil ebeveynle cakismadigini ve ebeveynin Seviye-1 '
  'oldugunu dogrular.';

drop trigger if exists category_secondary_parents_dogrula on public.category_secondary_parents;
create trigger category_secondary_parents_dogrula
  before insert or update on public.category_secondary_parents
  for each row execute function public.tg_ikincil_yerlesim_dogrula();

-- ----------------------------------------------------------------------------
-- SPEC'IN ISTEDIGI DOKUZ YERLESIM
-- ----------------------------------------------------------------------------
-- Her satir spec'te ADIYLA gecen bir eslesmedir; hicbiri tahmin degil.
insert into public.category_secondary_parents (category_id, parent_id, sort_order, note)
select k.id, e.id, v.sira, v.aciklama
  from (values
    ('mutfak-gerecleri',    'ev-yasam',           10, 'Spec: Mutfak Gerecleri hem Ev & Yasam hem Beyaz Esya altinda. Kanonik ev: Beyaz Esya & Mutfak.'),
    ('petshop',             'supermarket',        20, 'Spec: Evcil Hayvan Urunleri hem Ev & Yasam hem Supermarket altinda. Kanonik ev: Ev & Yasam.'),
    ('saat',                'giyim-ayakkabi',     30, 'Spec: Saat hem Moda & Giyim hem Altin/Taki altinda. Kanonik ev: Altin, Taki & Mucevher.'),
    ('spor-giyim-aksesuar', 'giyim-ayakkabi',     40, 'Spec: Spor Giyim hem Moda & Giyim hem Spor & Outdoor altinda. Kanonik ev: Spor & Outdoor.'),
    ('bebek-giyim',         'anne-bebek',         50, 'Spec: Bebek Giyim hem Moda & Giyim hem Anne & Bebek altinda. Kanonik ev: Moda & Giyim.'),
    ('oyuncak',             'anne-bebek',         60, 'Spec: Oyuncak hem Oyuncak/Muzik/Film hem Anne & Bebek altinda. Kanonik ev: Oyuncak, Muzik, Film & Oyun.'),
    ('oyuncu-ozel',         'oyuncak-muzik-film', 70, 'Spec: Gaming Aksesuarlari hem Bilgisayar hem Oyuncak altinda. Kanonik ev: Bilgisayar & Tablet.'),
    ('oyun-konsollari',     'ev-elektronigi',     80, 'Spec: Oyun Konsollari Ev Elektronigi altinda da isteniyor. Kanonik ev: Oyuncak, Muzik, Film & Oyun.'),
    ('akilli-ev',           'ev-elektronigi',     90, 'Spec: Akilli Ev Cihazlari Ev Elektronigi altinda da isteniyor. Kanonik ev: Elektrik & Elektronik.')
  ) as v(kategori, ebeveyn, sira, aciklama)
  join public.categories k on k.slug = v.kategori::citext
  join public.categories e on e.slug = v.ebeveyn::citext
on conflict (category_id, parent_id) do update
  set sort_order = excluded.sort_order, note = excluded.note;

do $$
declare
  n int;
  v_hata boolean := false;
begin
  select count(*) into n from public.category_secondary_parents;
  if n <> 9 then
    raise exception 'BASARISIZ: 9 ikincil yerlesim bekleniyordu, % var', n;
  end if;

  -- Hicbir urun tasinmadi: kategori sayisi ve birincil ebeveynler degismedi.
  select count(*) into n from public.categories where parent_id is null;
  if n <> 18 then
    raise exception 'BASARISIZ: Seviye-1 sayisi % oldu', n;
  end if;

  -- Korumanin GERCEKTEN calistigini kanitla: birincil ebeveyn tekrari dusmeli.
  begin
    insert into public.category_secondary_parents (category_id, parent_id, note)
    select c.id, c.parent_id, 'negatif test'
      from public.categories c where c.slug = 'saat';
    v_hata := true;
  exception when others then null;
  end;
  if v_hata then
    raise exception 'BASARISIZ: birincil ebeveyn ikincil olarak eklenebildi';
  end if;

  -- Alt kategoriyi ikincil ebeveyn yapmak da dusmeli.
  v_hata := false;
  begin
    insert into public.category_secondary_parents (category_id, parent_id, note)
    select k.id, e.id, 'negatif test'
      from public.categories k, public.categories e
     where k.slug = 'saat' and e.slug = 'kulaklik';
    v_hata := true;
  exception when others then null;
  end;
  if v_hata then
    raise exception 'BASARISIZ: alt kategori ikincil ebeveyn yapilabildi';
  end if;

  raise notice '9 ikincil yerlesim kuruldu; korumalar dogrulandi';
end $$;