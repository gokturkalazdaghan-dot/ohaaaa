-- ============================================================================
-- OHAAAA · 004 — API anahtarı kullanım telemetrisi
-- ----------------------------------------------------------------------------
-- Backend, her istekte tek satırlık UPDATE atmak yerine sayaçları bellekte
-- biriktirip periyodik olarak bu fonksiyonla yazar. Fonksiyon toplamsal
-- (additive) çalışır: `request_count = request_count + p_count`. Böylece iki
-- backend örneği aynı anda yazsa bile sayaç kaybolmaz — okuyup-yazma
-- (read-modify-write) yarışı oluşmaz.
-- ============================================================================

create or replace function public.touch_api_key(
  p_api_key_id   uuid,
  p_count        integer default 1,
  p_last_used_at timestamptz default now(),
  p_ip           text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.api_keys
     set request_count = request_count + greatest(p_count, 0),
         -- Saat kayması olan örneklerde sayaç geri gitmesin.
         last_used_at  = greatest(coalesce(last_used_at, p_last_used_at), p_last_used_at),
         last_used_ip  = coalesce(nullif(p_ip, '')::inet, last_used_ip)
   where id = p_api_key_id;
end;
$$;

comment on function public.touch_api_key(uuid, integer, timestamptz, text) is
  'API anahtarı kullanım sayacını toplamsal olarak günceller (backend toplu yazımı).';

-- Yalnızca backend (service_role) çağırır; istemcilere açılmaz.
revoke execute on function public.touch_api_key(uuid, integer, timestamptz, text)
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- log_api_request — taşeron panelindeki trafik grafiği için
-- ---------------------------------------------------------------------------
create or replace function public.log_api_request(
  p_api_key_id  uuid,
  p_vendor_id   uuid,
  p_method      text,
  p_path        text,
  p_status_code integer,
  p_duration_ms integer,
  p_ip          text default null,
  p_user_agent  text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.api_request_logs
    (api_key_id, vendor_id, method, path, status_code, duration_ms, ip, user_agent)
  values
    (p_api_key_id, p_vendor_id, p_method, left(p_path, 500), p_status_code,
     p_duration_ms, nullif(p_ip, '')::inet, left(p_user_agent, 500));
$$;

revoke execute on function
  public.log_api_request(uuid, uuid, text, text, integer, integer, text, text)
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Log saklama penceresi
-- ---------------------------------------------------------------------------
-- api_request_logs en hızlı büyüyen tablodur. 90 günden eskisi silinir;
-- panel grafikleri zaten 30 günlük pencereyle çalışır. Supabase'de bu
-- fonksiyon pg_cron ile günlük tetiklenir:
--   select cron.schedule('purge-api-logs', '0 4 * * *',
--                        $$select public.purge_old_api_logs()$$);
create or replace function public.purge_old_api_logs(p_keep_days integer default 90)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  delete from public.api_request_logs
   where created_at < now() - make_interval(days => greatest(p_keep_days, 1));

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_old_api_logs(integer) from anon, authenticated;
