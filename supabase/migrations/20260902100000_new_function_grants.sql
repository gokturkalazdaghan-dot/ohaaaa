-- ============================================================================
-- YENİ FONKSİYONLARIN YETKİLERİ — aynı hatayı iki göç sonra tekrarladım
-- ----------------------------------------------------------------------------
-- 20260831120000_function_execute_baseline.sql tam olarak şunu anlatıyordu:
-- PostgreSQL yeni bir fonksiyonu PUBLIC'e EXECUTE ile açar; bir role `grant`
-- vermek o PUBLIC yetkisini KALDIRMAZ. Buna rağmen ihlal ve kargo göçlerinde
-- yalnızca `grant ... to authenticated, service_role` yazdım ve PUBLIC
-- yetkisini kaldırmadım.
--
-- Supabase danışmanı bunu yakaladı: `vendor_violation_score` ve
-- `vendor_violation_tier` anon rolüyle, yani OTURUM AÇMADAN çağrılabiliyordu
-- (`/rest/v1/rpc/vendor_violation_score?p_vendor_id=...`). İkisi de SECURITY
-- DEFINER olduğu için RLS devreye girmez. Yani herhangi biri, herhangi bir
-- satıcının ceza puanını ve askıya alınmaya ne kadar kaldığını okuyabilirdi.
-- Bu, satıcının ticari itibarına ilişkin bir veri ve kimseye açık değil.
--
-- NEDEN `authenticated` DA KALDIRILIYOR
-- Yalnızca anon'u kesmek yetmez: fonksiyonlar parametre olarak vendor_id
-- alıyor ve içeride sahiplik denetimi yok. Oturum açmış HERHANGİ bir
-- kullanıcı, BAŞKA bir satıcının puanını sorgulayabilirdi. Uygulamada bu
-- fonksiyonları çağıran hiçbir yer yok (arandı), dolayısıyla iç kullanıma
-- kapatmanın işlevsel bir bedeli yok. Panelde gösterilmesi gerektiğinde,
-- doğru çözüm bu fonksiyonları açmak değil, sahipliği doğrulayan bir sarmalayıcı
-- eklemektir.
--
-- `validate_tracking_number` sızıntı riski taşımıyor (kalıp denetimi yapar),
-- ama o da istemeden PUBLIC'e açılmış durumda ve satıcı panelinden değil,
-- tetikleyiciden çağrılıyor. Taban kural: açıkça gerekmedikçe kapalı.
-- ============================================================================

revoke execute on function public.vendor_violation_score(uuid)
  from public, anon, authenticated;
revoke execute on function public.vendor_violation_tier(uuid)
  from public, anon, authenticated;
revoke execute on function public.validate_tracking_number(text, text)
  from public, anon, authenticated;

grant execute on function public.vendor_violation_score(uuid) to service_role;
grant execute on function public.vendor_violation_tier(uuid)  to service_role;
grant execute on function public.validate_tracking_number(text, text) to service_role;

-- Göç sessizce geçmesin: yetki gerçekten kalkmış olmalı.
do $$
declare
  ad text;
  rol text;
begin
  foreach ad in array array['vendor_violation_score', 'vendor_violation_tier',
                            'validate_tracking_number'] loop
    if not exists (select 1 from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = ad) then
      raise exception 'Beklenen fonksiyon bulunamadi: public.%', ad;
    end if;

    foreach rol in array array['anon', 'authenticated'] loop
      if not exists (select 1 from pg_roles where rolname = rol) then continue; end if;
      if exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = ad
           and has_function_privilege(rol, p.oid, 'EXECUTE')
      ) then
        raise exception '% rolu hala public.% fonksiyonunu calistirabiliyor', rol, ad;
      end if;
    end loop;
  end loop;
end $$;
