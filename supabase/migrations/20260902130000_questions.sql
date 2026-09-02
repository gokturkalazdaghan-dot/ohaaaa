-- ============================================================================
-- ÜRÜN SORU-CEVAP
-- ----------------------------------------------------------------------------
-- Alıcının satın almadan önce sorduğu soru ("kutuda şarj aleti var mı",
-- "kaç metre kablo") büyük pazar yerlerinde satışın kendisi kadar önemli bir
-- yerdedir ve burada hiç yoktu. Yorum bunun yerini tutmaz: yorum satın
-- ALDIKTAN sonra yazılır, soru ise almadan ÖNCE sorulur.
--
-- YORUMDAN AYRI BİR ŞEY
-- Yorum yazmak için teslim almış olmak şart; soru sormak için değil. Şartı
-- soruya da koymak, özelliğin var olma sebebini yok ederdi: soru soran kişi
-- henüz almamış olandır.
--
-- KİM CEVAPLAR
-- Yalnızca o ürünü satan bir mağazanın sahibi ya da yönetici. Herkese açık
-- bir cevap alanı, "satıcıdan bilgi" görüntüsü altında yanlış bilgi yazmanın
-- yolu olurdu -- ve bu sitede satıcı, cevabından sözleşmeyle sorumlu.
--
-- SORU DA GRUBA BAĞLANIR
-- Yorum gibi: aynı ürünü beş mağaza satıyorsa soru tek sayfada toplanmalı.
-- Tek bir teklife bağlasaydık, o teklif kalktığında soru da yok olurdu.
-- ============================================================================

create table public.product_questions (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.product_groups (id) on delete cascade,
  user_id      uuid not null references public.users (id) on delete cascade,

  body         text not null check (length(trim(body)) between 10 and 500),

  answer       text check (answer is null or length(trim(answer)) between 2 and 2000),
  answered_by  uuid references public.users (id) on delete set null,
  answered_at  timestamptz,
  -- Cevabı yazan mağaza: alıcı, cevabın kimden geldiğini görebilmeli.
  answer_vendor_id uuid references public.vendors (id) on delete set null,

  -- Kötüye kullanım için gizlenebilir; varsayılan yayında. Soruyu önce onaya
  -- almak, cevapsız kalan her soruyu görünmez yapar ve sayfayı ölü gösterir.
  is_hidden    boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.product_questions is
  'Urun grubuna sorulan sorular ve saticinin cevabi. Soru sormak icin satin almis olmak GEREKMEZ.';

create index product_questions_group_idx
  on public.product_questions (group_id, created_at desc) where not is_hidden;
create index product_questions_user_idx on public.product_questions (user_id);
-- Satıcının "cevap bekleyen sorular" listesi bu dizinden okunur.
create index product_questions_unanswered_idx
  on public.product_questions (group_id) where answer is null and not is_hidden;

create trigger product_questions_set_updated_at
  before update on public.product_questions
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Cevaplama yetkisi — SATICI OLMAK YETMEZ, O ÜRÜNÜ SATIYOR OLMAK GEREKİR
-- ---------------------------------------------------------------------------
create or replace function public.can_answer_question(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_admin()
      or exists (
        select 1
          from public.products p
          join public.vendors v on v.id = p.vendor_id
         where p.group_id = p_group_id
           and v.owner_id = auth.uid()
           and v.status = 'approved'
      );
$$;

comment on function public.can_answer_question is
  'O urun grubunda onayli bir magazasi olan satici (ya da yonetici) cevaplayabilir.';

-- ---------------------------------------------------------------------------
-- Cevap alanları yalnızca yetkili eliyle değişir
-- ---------------------------------------------------------------------------
-- RLS satır seviyesinde karar verir; hangi SÜTUNA dokunulabildiğine karar
-- veremez. Bu tetikleyici olmasaydı, soruyu yazan kişi kendi sorusunu
-- düzenlerken kendi "satıcı cevabını" da yazabilirdi -- yani satıcı ağzından
-- konuşabilirdi.
create or replace function public.tg_questions_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  /*
   * YETKİ, ROL ADIYLA DEĞİL `auth.uid()` İLE ANLAŞILIR.
   *
   * İlk yazışta koşul `current_user in ('anon','authenticated')` idi ve bu
   * SESSİZ bir hataydı: SECURITY DEFINER bir fonksiyonun içinde
   * `current_user` ÇAĞIRAN değil FONKSİYONUN SAHİBİDİR (postgres). Yani
   * koşul hiçbir zaman doğru olmuyor, koruma hiç çalışmıyordu -- testte
   * "soruyu soran kendi satıcı cevabını yazabildi" diye ortaya çıktı.
   *
   * Doğru ayrım şu: oturum açmış bir kullanıcı mı yazıyor (auth.uid() dolu),
   * yoksa sunucu tarafı bir bakım işi mi (service_role, auth.uid() boş).
   * İstemci yazıyorsa ve cevaplamaya yetkili değilse cevap alanları geri
   * alınır.
   */
  if auth.uid() is not null
     and not public.can_answer_question(new.group_id) then
    new.answer           := old.answer;
    new.answered_by      := old.answered_by;
    new.answered_at      := old.answered_at;
    new.answer_vendor_id := old.answer_vendor_id;
    new.is_hidden        := old.is_hidden;
  end if;

  -- Soru metni ve sahibi de sabittir: cevaplanmış bir sorunun metnini
  -- değiştirmek, cevabı başka bir soruya ait gösterir.
  new.group_id := old.group_id;
  new.user_id  := old.user_id;
  if old.answer is not null then
    new.body := old.body;
  end if;

  -- Cevap yazıldıysa zamanı SUNUCU koyar.
  if new.answer is distinct from old.answer and new.answer is not null then
    new.answered_at := now();
  end if;

  return new;
end;
$$;

create trigger product_questions_guard
  before update on public.product_questions
  for each row execute function public.tg_questions_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.product_questions enable row level security;

create policy "questions_read"
  on public.product_questions for select
  using (not is_hidden or user_id = auth.uid() or public.is_admin());

create policy "questions_insert_own"
  on public.product_questions for insert
  with check (user_id = auth.uid());

-- Güncelleme iki gruba açık: soruyu yazan (henüz cevaplanmamışken metnini
-- düzeltebilsin) ve cevaplamaya yetkili olan. Hangi SÜTUNU
-- değiştirebildiklerini yukarıdaki tetikleyici ayırıyor.
create policy "questions_update_owner_or_answerer"
  on public.product_questions for update
  using (user_id = auth.uid() or public.can_answer_question(group_id))
  with check (user_id = auth.uid() or public.can_answer_question(group_id));

create policy "questions_delete_own"
  on public.product_questions for delete
  using (user_id = auth.uid() or public.is_admin());

revoke all on table public.product_questions from public, anon, authenticated;
grant select on public.product_questions to anon, authenticated;
grant insert, update, delete on public.product_questions to authenticated;

revoke execute on function public.tg_questions_guard() from public, anon, authenticated;
revoke execute on function public.can_answer_question(uuid) from public, anon;
grant execute on function public.can_answer_question(uuid) to authenticated, service_role;
