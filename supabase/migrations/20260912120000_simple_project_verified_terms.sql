-- ===========================================================================
-- Simple Project: dogrulanmis sartlar + yayina alma
--
-- Operatör, Awin panosundan dogruladi (12/09/2026): komisyon orani %10.
-- Program "simpleprojectus", reklamveren/MID 99013, yayinci 3074081.
--
-- SIRA ONEMLI VE KISIT BYPASS EDILMIYOR.
-- merchants_active_needs_verified_terms su: (status <> 'active' or
-- terms_verified_at is not null). Once sartlar yazilir, SONRA yayina alinir;
-- boylece kisit DOGAL OLARAK gecilir. Ters sirada yazilsaydi kisit dogru
-- davranip reddederdi -- ve onu gevsetmek, "dogrulanmamis sartla yayina
-- alma" kapisini herkese acmak olurdu.
--
-- Bu goc YALNIZCA sart/aktiflik isidir. Kaynak BILEREK etkinlestirilmiyor;
-- alim ayri bir asama.
-- ===========================================================================

update public.merchants
   set default_commission_rate = 0.1000,  -- %10
       -- Ilk dogrulama ani KORUNUR: goc tekrar calisirsa tarih tazelenmez.
       terms_verified_at = coalesce(terms_verified_at, now()),
       notes = coalesce(notes, '') ||
         ' | SARTLAR DOGRULANDI (12/09/2026): komisyon %10, operatör '
         'tarafindan Awin panosundan okundu. MID 99013, yayinci 3074081, '
         'feed 2281.'
 where slug = 'simple-project';

-- AYRI IFADE ve bu kasitli: sartlar yukarida yazildigi icin kisit artik
-- dogal olarak gecilir. Kisita dokunulmadi.
update public.merchants
   set status = 'active'
 where slug = 'simple-project'
   and terms_verified_at is not null;

do $$
declare m record; s record; v_bto record;
begin
  select * into m from public.merchants where slug = 'simple-project';

  if m.terms_verified_at is null then
    raise exception 'DOGRULAMA 1: terms_verified_at hala bos.';
  end if;
  if m.default_commission_rate <> 0.1000 then
    raise exception 'DOGRULAMA 2: komisyon %%10 olmaliydi, bulunan %.',
      m.default_commission_rate;
  end if;
  if m.status <> 'active' then
    raise exception 'DOGRULAMA 3: magaza aktif degil -> %.', m.status;
  end if;
  -- Stage 1'de duzeltilen kimlikler bozulmadi mi.
  if m.network_advertiser_id <> '99013' then
    raise exception 'DOGRULAMA 4: MID degismis -> %.', m.network_advertiser_id;
  end if;
  if position('awinmid=99013' in coalesce(m.deeplink_template, '')) = 0 then
    raise exception 'DOGRULAMA 5: deeplink sablonu 99013 tasimiyor.';
  end if;

  -- KAYNAK BU ASAMADA ETKINLESTIRILMEZ.
  select * into s from public.sources where slug = 'simple-project-awin-f2281';
  if s.is_enabled then
    raise exception 'DOGRULAMA 6: kaynak etkinlesmis -- bu goc yalnizca sart isi.';
  end if;
  if s.feed_id <> '2281' or s.expected_advertiser_id <> '99013' then
    raise exception 'DOGRULAMA 7: kaynak bagi bozulmus (feed=%, mid=%).',
      s.feed_id, s.expected_advertiser_id;
  end if;

  -- BTO / MID 61655 DEGISMEDI.
  select * into v_bto from public.merchants where slug = 'back-to-the-office';
  if v_bto.network_advertiser_id is distinct from '61655'
     or v_bto.status::text <> 'prospect'
     or v_bto.terms_verified_at is not null then
    raise exception 'DOGRULAMA 8: BTO kaydi degismis (mid=%, durum=%, sart=%).',
      v_bto.network_advertiser_id, v_bto.status, v_bto.terms_verified_at;
  end if;

  raise notice
    'Simple Project sartlari dogrulandi (%%10) ve magaza yayina alindi. '
    'Kaynak HALA ETKIN DEGIL -- alim ayri asama. BTO/61655 degismedi.';
end $$;
