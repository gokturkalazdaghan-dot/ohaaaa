-- ===========================================================================
-- D1 + D2 — Atıf bütünlüğü ve dönüşüm durum korumaları
-- ---------------------------------------------------------------------------
-- Bu migration `record_conversion`'daki iki açığı kapatır. İkisi de PARA
-- yolundadır ve ilk gerçek ortaklık dönüşümü gelmeden kapatılmalıdır.
--
-- D1 — ATIF, MAĞAZA KONTROLÜ OLMADAN KURULUYORDU
--   Önceki hâl:  select id into v_click_id from clicks where subid = p_subid;
--   `merchant_id` karşılaştırması yoktu ve zaman penceresi hiç uygulanmıyordu.
--   Kimliği doğrulanmış bir mağaza, BAŞKA bir mağazanın tıklamasına ait
--   subid'yi bildirerek dönüşümü o tıklamaya bağlayabiliyordu. Ayrıca
--   `merchants.cookie_window_days` yazılıyor ama hiçbir yerde okunmuyordu:
--   iki yıl önceki bir tıklama da eşleşiyordu.
--
-- D2 — DURUM GEÇİŞİ KORUMASIZDI
--   Önceki hâl:  on conflict ... do update set status = excluded.status
--   Koşulsuzdu. Yakalanmış geçerli bir gövde+imza yeniden gönderilerek
--   `rejected` olmuş bir satış tekrar `approved`'a döndürülebiliyordu.
--   (`status_changed_at` bu kapsamda DEGILDI: onu `conversions_stamp_status`
--   trigger'i zaten dogru yaziyor; dokunulmadi.)
--
-- NE DEĞİŞMİYOR: fonksiyon imzası ve dönüş tipi aynı (çağıran route
-- değişmeden çalışır), `(merchant_id, network_order_id)` idempotentliği
-- aynı, imza doğrulama katmanına dokunulmadı.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Durum geçiş tablosu — AYRI ve SAF bir fonksiyon
--
-- Kural motorunu `record_conversion` içine gömmek yerine dışarı almak
-- bilinçlidir: geçiş kuralları tek başına sınanabilir olmalı. pgTAP testi
-- 16 kombinasyonun her birini doğrudan çağırıyor.
-- ---------------------------------------------------------------------------
create or replace function public.conversion_transition_allowed(
  p_from public.conversion_status,
  p_to   public.conversion_status
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    -- Aynı duruma tekrar bildirim: geçiş değil, tekrar. İzinli (idempotent).
    when p_from = p_to then true

    -- pending henüz kesinleşmemiştir; her yöne açılabilir.
    when p_from = 'pending' and p_to in ('approved', 'rejected', 'paid') then true

    -- Onaylanmış satışın ödenmesi ileri yöndür.
    when p_from = 'approved' and p_to = 'paid' then true

    -- Geri kalan HER ŞEY geriye dönüştür:
    --   approved -> pending   (onay geri alınıyor)
    --   approved -> rejected  (talimatta açıkça engellenecek denildi)
    --   rejected -> *         (rejected terminaldir)
    --   paid     -> *         (paid terminaldir)
    else false
  end;
$$;

comment on function public.conversion_transition_allowed is
  'Dönüşüm durum geçişinin ileri yönlü olup olmadığı. Geriye dönüşler '
  'engellidir: kesinleşmiş bir satış eski/replay postback ile çevrilemez.';

-- ---------------------------------------------------------------------------
-- record_conversion — atıf ve durum korumalı hâli
-- ---------------------------------------------------------------------------
create or replace function public.record_conversion(
  p_merchant_id       uuid,
  p_network_order_id  text,
  p_subid             text,
  p_status            public.conversion_status,
  p_order_total_cents bigint,
  p_commission_cents  bigint,
  p_currency          char(3) default 'TRY',
  p_occurred_at       timestamptz default now(),
  p_raw               jsonb default '{}'::jsonb
)
returns public.conversions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_click_id     uuid;
  v_click_owner  uuid;
  v_click_at     timestamptz;
  v_window_days  integer;
  v_row          public.conversions;
begin
  -- Mağazanın atıf penceresi. Mağaza yoksa postback zaten route katmanında
  -- 404 ile durur; yine de burada da sessiz geçilmez.
  select cookie_window_days into v_window_days
  from public.merchants
  where id = p_merchant_id;

  if v_window_days is null then
    raise exception 'Mağaza bulunamadı: %', p_merchant_id
      using errcode = 'OH404';
  end if;

  -- =========================================================================
  -- D1 — ATIF
  -- =========================================================================
  if p_subid is not null and p_subid <> '' then
    select id, merchant_id, created_at
      into v_click_id, v_click_owner, v_click_at
    from public.clicks
    where subid = p_subid;   -- clicks.subid UNIQUE

    if v_click_owner is not null and v_click_owner <> p_merchant_id then
      /*
       * BAŞKA MAĞAZANIN TIKLAMASI.
       *
       * Bu bir yapılandırma hatası değil, bir sahiplenme denemesidir:
       * subid tahmin edilemez (192 bit) olduğundan, bir mağazanın başka
       * mağazaya ait subid'yi "kazara" bildirmesi beklenmez.
       *
       * Dönüşüm HİÇ oluşturulmaz -- atıfsız kaydetmek bile, sahte bir
       * siparişi ciro tablosuna sokmak demekti.
       *
       * Ayrı bir SQLSTATE veriliyor: route bunu 409 ile yanıtlayıp ağın
       * sonsuza kadar yeniden denemesini engelliyor (5xx tekrar tetikler).
       */
      raise exception
        'subid baska bir magazaya ait; donusum reddedildi'
        using errcode = 'OH409';
    end if;

    if v_click_id is not null then
      /*
       * PENCERE.
       *
       * Pencere dışındaki tıklama için dönüşüm KAYDEDİLİR ama ATFEDİLMEZ:
       * ciro gerçektir, o tıklamadan geldiği iddiası değildir. Kaydı tümden
       * atmak, gerçekleşmiş bir satışı defterden silmek olurdu.
       */
      if p_occurred_at > v_click_at + make_interval(days => v_window_days) then
        v_click_id := null;
      end if;
    end if;
  end if;

  -- =========================================================================
  -- Yeni kayıt
  -- =========================================================================
  insert into public.conversions (
    click_id, subid, merchant_id, network_order_id, status,
    currency, order_total_cents, commission_cents, occurred_at, raw
  )
  values (
    v_click_id, p_subid, p_merchant_id, p_network_order_id, p_status,
    p_currency, p_order_total_cents, p_commission_cents, p_occurred_at, p_raw
  )
  on conflict (merchant_id, network_order_id) do nothing
  returning * into v_row;

  if found then
    -- İlk kayıt: bu bir DURUM DEĞİŞİMİ değil, doğuş. status_changed_at boş
    -- kalır; aksi halde "hiç değişmemiş" ile "az önce değişti" ayırt edilemez.
    return v_row;
  end if;

  -- =========================================================================
  -- D2 — MEVCUT KAYIT: geçiş ve tazelik kontrolü
  -- =========================================================================
  select * into v_row
  from public.conversions
  where merchant_id = p_merchant_id
    and network_order_id = p_network_order_id
  for update;

  /*
   * İKİ AYRI KORUMA, İKİSİ DE GEREKLİ:
   *
   *   GEÇİŞ    Durum geriye gidemez (approved -> rejected engellidir).
   *   TAZELİK  Daha ESKİ bir bildirim, daha yenisinin üzerine yazamaz.
   *
   * Yalnızca geçiş kontrolü konsaydı, aynı durumdaki eski bir postback
   * (approved -> approved) düzeltilmiş komisyonu eski değerine döndürürdü.
   * Yalnızca tazelik konsaydı, ağın yanlışlıkla gönderdiği yeni tarihli bir
   * "rejected" onaylanmış satışı iptal ederdi.
   */
  if not public.conversion_transition_allowed(v_row.status, p_status)
     or p_occurred_at < v_row.occurred_at
  then
    /*
     * Finansal alanların HİÇBİRİ değişmez. Yalnızca "ağdan ses geldi"
     * bilgisi tazelenir; raw da korunur, çünkü eski gövdeyi yazmak
     * mutabakatta yanıltır.
     *
     * Hata FIRLATILMAZ: ağ geçerli bir bildirim gönderdi, kabul ettiğimizi
     * 200 ile söylemeliyiz. 5xx dönmek sonsuz yeniden denemeye yol açardı.
     */
    raise warning 'Donusum guncellemesi yok sayildi (merchant=% order=% % -> %)',
      p_merchant_id, p_network_order_id, v_row.status, p_status;

    update public.conversions
       set reported_at = now()
     where id = v_row.id
    returning * into v_row;

    return v_row;
  end if;

  update public.conversions
     set status            = p_status,
         /*
          * status_changed_at BURADA YAZILMAZ.
          *
          * `conversions_stamp_status` trigger'i bunu zaten yapiyor ve
          * dogru yapiyor (status is distinct from old.status). Ayni mantigi
          * ikinci kez buraya yazmak, iki kopyanin zamanla ayrisma riskini
          * yaratirdi; trigger tek sahip kalir.
          */
         order_total_cents = p_order_total_cents,
         commission_cents  = p_commission_cents,
         currency          = p_currency,
         occurred_at       = p_occurred_at,
         -- Tıklama bağı bir kez kurulduysa korunur: sonraki postback'te
         -- subid gelmeyebilir, atfı kaybetmemeliyiz.
         click_id          = coalesce(v_row.click_id, v_click_id),
         reported_at       = now(),
         raw               = p_raw
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.record_conversion is
  'Ortaklik agi postback kaydi. Atif yalnizca AYNI magazanin ve atif '
  'penceresi icindeki tiklamasina kurulur; durum geriye donduruemez.';

-- Yetkiler önceki migration'daki gibi: yalnızca sunucu (service_role).
revoke all on function public.record_conversion(uuid, text, text, public.conversion_status, bigint, bigint, char, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.record_conversion(uuid, text, text, public.conversion_status, bigint, bigint, char, timestamptz, jsonb) to service_role;

revoke all on function public.conversion_transition_allowed(public.conversion_status, public.conversion_status) from public, anon, authenticated;
grant execute on function public.conversion_transition_allowed(public.conversion_status, public.conversion_status) to service_role;
