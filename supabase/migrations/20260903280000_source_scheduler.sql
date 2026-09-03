-- ===========================================================================
-- ZAMANLAYICI — due kaynakları SOURCE_SYNC kuyruğuna alır
-- ---------------------------------------------------------------------------
-- YENİ KUYRUK YA DA YENİ DURUM MAKİNESİ YOK.
-- Mevcut `jobs` tablosu, `enqueue_job` ve `claim_jobs` kullanılıyor.
-- Zamanlayıcının tek işi şu soruyu yanıtlamak: "hangi kaynak artık
-- çalışmalı?" Ne çalıştıracağına worker, bir sonraki ne zaman
-- çalışacağına uyarlanabilir yoklama karar veriyor.
-- ===========================================================================

/**
 * Çalışması gereken kaynaklar.
 *
 * NULL `next_refresh_at` DE DUE SAYILIR.
 *
 * Henüz planı olmayan bir kaynak, hiç çalışmamış demektir -- ve hiç
 * çalışmamış bir kaynağı beklemek, onu hiç çalıştırmamaktır. İlk turdan
 * sonra planı oluşur ve normal döngüye girer.
 */
create or replace function public.due_sources(p_limit integer default 100)
returns table (
  source_id       uuid,
  slug            text,
  market          public.market,
  next_refresh_at timestamptz,
  reason          text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.slug::text,
    s.market,
    s.next_refresh_at,
    case when s.next_refresh_at is null then 'plan_yok_ilk_calisma'
         else 'plan_zamani_geldi' end
  from public.sources s
  where s.is_enabled
    and (s.next_refresh_at is null or s.next_refresh_at <= now())
    /*
     * DEVRE AÇIKSA KAYNAK ADAY DEĞİL.
     *
     * `breaker_allows()` çağrılmıyor çünkü o fonksiyon DURUM DEĞİŞTİRİYOR
     * (açık → yarı açık). Bir seçim sorgusunun yan etkisi olmamalı: aynı
     * sorgu iki kez çalıştığında farklı sonuç verirdi. Geçişi worker
     * yapıyor; burada yalnızca okunuyor.
     */
    and not exists (
      select 1 from public.source_breakers b
       where b.source_id = s.id
         and b.state = 'acik'
         and (b.half_open_at is null or b.half_open_at > now())
    )
  order by
    -- Hiç çalışmamışlar önce: onların gecikmesi en görünür olan.
    (s.next_refresh_at is null) desc,
    s.next_refresh_at nulls first
  limit greatest(1, least(p_limit, 500));
$$;

comment on function public.due_sources is
  'Calismasi gereken kaynaklar. NULL next_refresh_at de due sayilir: hic '
  'calismamis bir kaynagi beklemek onu hic calistirmamaktir.';

/**
 * Due kaynaklar için SOURCE_SYNC işi açar.
 *
 * İKİ KATMANLI TEKRAR KORUMASI:
 *
 * 1) İDEMPOTENCY ANAHTARI `next_refresh_at` İÇERİR.
 *    Anahtar yalnızca kaynak kimliği olsaydı, iş tamamlandıktan sonra da
 *    kayıtta kalır ve o kaynak BİR DAHA hiç kuyruğa alınamazdı. Plan
 *    zamanını anahtara katmak, aynı pencerede tekrarı engellerken bir
 *    sonraki döngüye izin veriyor.
 *
 * 2) AÇIK BİR İŞ VARSA YENİSİ AÇILMAZ.
 *    Zamanlayıcı, elle tetikleme ve yeniden deneme aynı kaynağı aynı anda
 *    çalıştırmaya kalkabilir. Bekleyen ya da çalışan bir SOURCE_SYNC
 *    varsa yeni iş üretilmiyor -- aynı feed'e eşzamanlı iki alım, aynı
 *    satırları iki kez yazmak ve delta'yı anlamsızlaştırmak demek.
 */
create or replace function public.schedule_due_sources(p_limit integer default 100)
returns table (source_id uuid, job_id uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_job uuid;
begin
  for v in select * from public.due_sources(p_limit) loop
    -- Açık bir iş varsa atla.
    if exists (
      select 1 from public.jobs j
       where j.kind = 'SOURCE_SYNC'
         and j.source_id = v.source_id
         and j.status in ('bekliyor', 'yeniden', 'calisiyor')
    ) then
      continue;
    end if;

    v_job := public.enqueue_job(
      'SOURCE_SYNC',
      'normal',
      jsonb_build_object('source_id', v.source_id),
      -- Anahtar plan zamanını içerir; gerekçesi yukarıda.
      'source_sync:' || v.source_id::text || ':' ||
        coalesce(v.next_refresh_at::text, 'ilk'),
      v.market,
      v.source_id
    );

    if v_job is not null then
      source_id := v.source_id;
      job_id := v_job;
      reason := v.reason;
      return next;
    end if;
  end loop;
end;
$$;

comment on function public.schedule_due_sources is
  'Due kaynaklar icin SOURCE_SYNC isi acar. Ayni kaynak icin acik bir is '
  'varsa yenisi acilmaz; idempotency anahtari plan zamanini icerir.';

-- --- Erişim ----------------------------------------------------------------
revoke all on function public.due_sources(integer) from public;
revoke all on function public.schedule_due_sources(integer) from public;
grant execute on function public.due_sources(integer) to service_role;
grant execute on function public.schedule_due_sources(integer) to service_role;
