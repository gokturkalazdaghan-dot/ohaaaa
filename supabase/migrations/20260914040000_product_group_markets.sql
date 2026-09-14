-- ============================================================================
-- PAZAR BAZLI GRUP TOPLAMLARI
--
-- ⚠️  BU GÖÇ ÜRETİMDE ÇALIŞTIRILMADI. Hazırlandı ve incelemeye bırakıldı.
--
-- NEDEN GEREKİYOR
-- `product_groups` üzerindeki denormalize önbellek -- `offer_count`,
-- `min_price_cents`, `max_price_cents`, `best_offer_id` -- BÜTÜN pazarlar
-- üzerinden hesaplanıyor (`tg_refresh_group_offer_cache`, göç
-- 20260829090100, satır 140-146: `where p.group_id = ... and status = 'active'`
-- -- pazar süzgeci YOK).
--
-- Sonuç: listeleme sorgusuna pazar filtresi eklemek TEK BAŞINA yetmez.
-- Grubu "bu pazarda teklifi var" diye süzsek bile gösterilen FİYAT ve
-- TEKLİF SAYISI küresel değerler olurdu; Türkiye'deki ziyaretçi sterlinden
-- türetilmiş bir "en düşük fiyat" görürdü. Yani filtre, önlemeye çalıştığı
-- zararı bir katman aşağı taşırdı.
--
-- ÖLÇÜLEN DURUM (14 Eylül 2026): aktif tekliflerin %100'ü market_code='UK'
-- (35.742 satır; başka pazarda sıfır). Bu yüzden göç uygulanmadan filtre
-- açmak TR/EU/GCC ziyaretçisine boş katalog gösterirdi.
--
-- NE YAPIYOR
-- Grup × pazar kırılımında aynı dört değeri tutan bir tablo ve onu besleyen
-- fonksiyon. `product_groups` üzerindeki mevcut sütunlar DEĞİŞMİYOR ve
-- kaldırılmıyor: pazar bağlamı olmayan çağrılar bugünkü davranışı aynen
-- sürdürür. Bu, geri alınabilir ve eklemeli bir göç.
-- ============================================================================

create table if not exists public.product_group_markets (
  group_id        uuid not null references public.product_groups (id) on delete cascade,
  market_code     text not null references public.markets (code)      on delete restrict,

  offer_count     integer not null default 0 check (offer_count >= 0),
  min_price_cents bigint,
  max_price_cents bigint,
  best_offer_id   uuid references public.products (id) on delete set null,

  updated_at      timestamptz not null default now(),

  primary key (group_id, market_code)
);

comment on table public.product_group_markets is
  'Grup x pazar kirilimasinda teklif ozeti. product_groups uzerindeki ayni '
  'sutunlarin PAZAR BAZLI karsiligi; onlari degistirmez, yaninda durur.';

alter table public.product_group_markets enable row level security;

-- Katalog herkese açık okunur; product_groups ile aynı kural.
drop policy if exists product_group_markets_public_read on public.product_group_markets;
create policy product_group_markets_public_read
  on public.product_group_markets for select
  using (true);

grant select on public.product_group_markets to anon, authenticated;

/*
 * LİSTELEME İÇİN İNDEKS.
 *
 * Sıralama yönleri, bugün `product_groups` üzerinde kullanılan indekslerle
 * BİREBİR aynı: `offer_count desc nulls last, ...`. DESC'in varsayılanı
 * NULLS FIRST olduğu için açıkça yazılıyor -- eşleşmezse planner indeksi
 * sıralama için kullanamaz.
 */
create index if not exists product_group_markets_listing_idx
  on public.product_group_markets (market_code, offer_count desc nulls last, group_id)
  where offer_count > 0;

create index if not exists product_group_markets_price_idx
  on public.product_group_markets (market_code, min_price_cents)
  where offer_count > 0;


-- ---------------------------------------------------------------------------
-- Besleme: mevcut fonksiyonun pazar bazlı ikizi
-- ---------------------------------------------------------------------------
create or replace function public.refresh_group_market_cache(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_group_id is null then
    return;
  end if;

  /*
   * MARKET_CODE'U NULL OLAN TEKLİF ATLANIR, "bilinmeyen" diye bir pazara
   * yazılmaz. Uydurma bir kova, operatörün fark etmeyeceği yanlış bir
   * toplam üretirdi; eksik satır ise sessiz değil -- o pazar listede hiç
   * çıkmaz ve bu görülebilir bir durumdur.
   */
  delete from public.product_group_markets where group_id = p_group_id;

  insert into public.product_group_markets
        (group_id, market_code, offer_count, min_price_cents, max_price_cents, best_offer_id)
  select p.group_id,
         p.market_code,
         count(*),
         min(p.price_cents),
         max(p.price_cents),
         (select ip.id
            from public.products ip
           where ip.group_id = p.group_id
             and ip.market_code = p.market_code
             and ip.status = 'active'
             and ip.stock > 0
           order by (ip.price_cents + ip.shipping_fee_cents) asc,
                    ip.estimated_delivery_days asc,
                    ip.created_at asc
           limit 1)
    from public.products p
   where p.group_id = p_group_id
     and p.status = 'active'
     and p.stock > 0
     and p.market_code is not null
   group by p.group_id, p.market_code;
end;
$$;

comment on function public.refresh_group_market_cache(uuid) is
  'Bir grubun pazar bazli teklif ozetini yeniden hesaplar. '
  'tg_refresh_group_offer_cache ile AYNI kurallari kullanir; tek farki '
  'market_code kirilimasi.';


-- ---------------------------------------------------------------------------
-- GERİ ALMA
-- ---------------------------------------------------------------------------
-- drop function if exists public.refresh_group_market_cache(uuid);
-- drop table if exists public.product_group_markets;
--
-- product_groups'a dokunulmadigi icin sistem bu gocten onceki haline
-- birebir doner.
