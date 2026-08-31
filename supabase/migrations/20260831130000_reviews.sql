-- ============================================================================
-- DEĞERLENDİRMELER — ürün ve satıcı puanı, yalnızca satın almış kullanıcıdan
-- ----------------------------------------------------------------------------
-- İKİ AYRI PUAN, ÇÜNKÜ İKİ AYRI ŞEY
-- Bir alışverişte iki bağımsız deneyim vardır: ÜRÜN (beklediğim gibi miydi)
-- ve SATICI (zamanında mı geldi, ambalaj, iletişim, sorun çıkınca ne oldu).
-- Tek puana sıkıştırmak ikisini de bozar: kargosu geciken iyi bir ürün
-- 2 yıldız alır ve sonraki alıcı ürünü kötü sanır.
--
-- Bu ayrım bu pazar yerinde ayrıca önemli: satıştan sonraki her şey —
-- teslimat, iade, ayıplı ürün — SATICININ sorumluluğunda. Satıcı puanı,
-- alıcının o sorumluluğu görebildiği tek yer.
--
-- YALNIZCA SATIN ALMIŞ KULLANICI
-- Yorum hakkı `order_items` satırına bağlıdır ve o satır BENZERSİZDİR:
-- bir kalemi yalnızca bir kez değerlendirebilirsiniz. Sahte yorum,
-- moderasyonla değil YAPISAL olarak engellenir — yorum yazmak için önce
-- gerçekten sipariş verip teslim almış olmak gerekir.
--
-- Bunun bedeli var ve kabul ediliyor: ORTAK MAĞAZA (affiliate) tekliflerinde
-- satış bizim sistemimizde tamamlanmaz, dolayısıyla `order_items` satırı hiç
-- oluşmaz ve o alışverişler değerlendirilemez. Alternatif "herkes yorum
-- yazabilsin" olurdu; o da sahte yorum kapısını açardı. Doğrulanamayan bir
-- yorumu göstermek, hiç göstermemekten kötüdür.
--
-- TESLİM EDİLMİŞ OLMA ŞARTI
-- Değerlendirme `vendor_orders.status = 'delivered'` şartına bağlı. Eline
-- geçmemiş bir ürün hakkında yazılan yorum, ürün hakkında bilgi taşımaz.
-- ============================================================================

create type public.review_status as enum ('published', 'hidden');

create table public.reviews (
  id                uuid primary key default gen_random_uuid(),

  -- Yorum hakkının KAYNAĞI. Benzersiz: bir satın alınan kalem = bir yorum.
  -- Sipariş silinirse yorum da gider; dayanağı kalmayan bir yorum duramaz.
  order_item_id     uuid not null unique
                    references public.order_items (id) on delete cascade,

  -- Yazarın kimliği. Misafir siparişinde orders.user_id boştur; o alışveriş
  -- bir hesaba bağlanmadığı için değerlendirilemez (bkz. RLS politikası).
  user_id           uuid not null references public.users (id) on delete cascade,

  -- Değerlendirilen iki taraf. Kanonik ÜRÜN GRUBU puanlanır, tek bir satıcı
  -- teklifi değil: aynı ürünü beş mağaza satıyorsa yorumlar tek sayfada
  -- toplanmalı, yoksa her teklif kendi boş yorum listesiyle kalır.
  group_id          uuid not null references public.product_groups (id) on delete cascade,
  vendor_id         uuid not null references public.vendors (id) on delete cascade,

  product_rating    smallint not null check (product_rating between 1 and 5),
  vendor_rating     smallint not null check (vendor_rating between 1 and 5),

  title             text check (title is null or length(trim(title)) between 3 and 120),
  body              text check (body is null or length(trim(body)) between 10 and 4000),

  -- Varsayılan YAYINDA. Yorumu önce onaya almak, "kötü yorumu saklıyorlar"
  -- şüphesini besler ve bu sitenin tek sermayesi güvendir. Kötüye kullanım
  -- için `hidden` durumu ve yönetici yetkisi var; sansür için değil.
  status            public.review_status not null default 'published',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.reviews is
  'Dogrulanmis alima bagli urun ve satici degerlendirmesi. order_item_id benzersizdir: bir kalem, bir yorum.';

create index reviews_group_idx  on public.reviews (group_id)  where status = 'published';
create index reviews_vendor_idx on public.reviews (vendor_id) where status = 'published';
create index reviews_user_idx   on public.reviews (user_id);

create trigger reviews_touch
  before update on public.reviews
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Ortalama puanlar — UYGULAMA DEĞİL, VERİTABANI hesaplar
-- ---------------------------------------------------------------------------
-- Ortalamayı uygulama yazsaydı, yorumu silen/gizleyen her yol ortalamayı
-- güncellemeyi unutabilirdi ve puan sessizce bayatlardı. Tetikleyici, yorum
-- hangi yoldan değişirse değişsin doğru kalmasını sağlar.
alter table public.product_groups
  add column if not exists rating numeric(3, 2) not null default 0
      check (rating >= 0 and rating <= 5),
  add column if not exists rating_count integer not null default 0
      check (rating_count >= 0);

comment on column public.product_groups.rating is
  'Yayindaki yorumlarin urun puani ortalamasi. Tetikleyici ile beslenir.';

create or replace function public.refresh_review_aggregates(
  p_group_id uuid,
  p_vendor_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_group_id is not null then
    update public.product_groups g
       set rating = coalesce(round(sub.avg_rating, 2), 0),
           rating_count = coalesce(sub.n, 0)
      from (
        select avg(product_rating)::numeric as avg_rating, count(*) as n
          from public.reviews
         where group_id = p_group_id and status = 'published'
      ) sub
     where g.id = p_group_id;
  end if;

  if p_vendor_id is not null then
    update public.vendors v
       set rating = coalesce(round(sub.avg_rating, 2), 0),
           rating_count = coalesce(sub.n, 0)
      from (
        select avg(vendor_rating)::numeric as avg_rating, count(*) as n
          from public.reviews
         where vendor_id = p_vendor_id and status = 'published'
      ) sub
     where v.id = p_vendor_id;
  end if;
end;
$$;

create or replace function public.tg_reviews_refresh_aggregates()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Silmede ve güncellemede ESKİ satırın hedefleri de tazelenir: yorum bir
  -- üründen diğerine taşınmasa bile, gizlenen bir yorum eski ortalamayı
  -- bozuk bırakırdı.
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_review_aggregates(old.group_id, old.vendor_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_review_aggregates(new.group_id, new.vendor_id);
  end if;
  return null;
end;
$$;

create trigger reviews_sync_aggregates
  after insert or update or delete on public.reviews
  for each row execute function public.tg_reviews_refresh_aggregates();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.reviews enable row level security;

-- Okuma: yayındaki yorumları herkes görür. Yazar kendi gizlenmiş yorumunu da
-- görür — yoksa yorumu kaybolmuş sanır.
create policy "reviews_read_published"
  on public.reviews for select
  using (status = 'published' or user_id = auth.uid() or public.is_admin());

-- Yazma: SATIN ALMA DOĞRULAMASI burada yapılır.
-- Üç şart birden: kalem gerçekten bu kullanıcının siparişinde olacak,
-- sipariş TESLİM EDİLMİŞ olacak, ve yazılan grup/satıcı o kalemin
-- gerçek grubu/satıcısı olacak. Sonuncusu olmadan kullanıcı, aldığı bir
-- kalemi dayanak gösterip BAŞKA bir ürüne puan verebilirdi.
create policy "reviews_insert_verified_purchase"
  on public.reviews for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.order_items oi
      join public.orders o        on o.id = oi.order_id
      join public.vendor_orders vo on vo.id = oi.vendor_order_id
      join public.products p       on p.id = oi.product_id
      where oi.id = reviews.order_item_id
        and o.user_id = auth.uid()
        and vo.status = 'delivered'
        and p.group_id = reviews.group_id
        and oi.vendor_id = reviews.vendor_id
    )
  );

-- Düzenleme: yalnızca kendi yorumu. Durumu değiştiremez (aşağıdaki
-- tetikleyici korur); yalnızca yönetici gizleyebilir.
create policy "reviews_update_own"
  on public.reviews for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "reviews_delete_own"
  on public.reviews for delete
  using (user_id = auth.uid() or public.is_admin());

create policy "reviews_admin_all"
  on public.reviews for all
  using (public.is_admin())
  with check (public.is_admin());

-- Yazar kendi yorumunu düzenlerken `status`'u değiştiremesin: aksi hâlde
-- yönetici tarafından gizlenen bir yorum, yazarı tarafından geri
-- yayınlanabilirdi.
create or replace function public.tg_reviews_protect_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  /*
   * Durum değişikliği yalnızca İSTEMCİ rollerinden engellenir.
   *
   * İlk yazışta koşul sadece `not is_admin()` idi ve bu SESSİZ bir hataydı:
   * `is_admin()` oturum kullanıcısına bakar, dolayısıyla sunucu tarafı
   * (service_role) ve bakım işleri için de false döner. Yani arka uçtan
   * yapılan bir moderasyon işlemi hata vermeden GERİ ALINIYORDU — testte
   * "gizlenen yorum ortalamada kaldı" diye ortaya çıktı.
   *
   * Sessizce hiçbir şey yapmayan bir koruma, korumasızlıktan kötüdür:
   * yönetici yorumu gizlediğini sanır, yorum yayında kalır.
   */
  if new.status is distinct from old.status
     and current_user in ('anon', 'authenticated')
     and not public.is_admin() then
    new.status := old.status;
  end if;
  -- Dayanak da değiştirilemez: yorumun bağlı olduğu satın alma sabittir.
  new.order_item_id := old.order_item_id;
  new.user_id       := old.user_id;
  new.group_id      := old.group_id;
  new.vendor_id     := old.vendor_id;
  return new;
end;
$$;

create trigger reviews_protect_status
  before update on public.reviews
  for each row execute function public.tg_reviews_protect_status();

-- ---------------------------------------------------------------------------
-- Yetkiler — yeni taban kurallarına uygun
-- ---------------------------------------------------------------------------
-- TRUNCATE verilmez. Tetikleyici ve iç fonksiyonlar PUBLIC'e açılmaz.
revoke all on table public.reviews from public, anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;

revoke execute on function public.refresh_review_aggregates(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.tg_reviews_refresh_aggregates()
  from public, anon, authenticated;
revoke execute on function public.tg_reviews_protect_status()
  from public, anon, authenticated;
