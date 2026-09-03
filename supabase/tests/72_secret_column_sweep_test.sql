-- ============================================================================
-- SIR SÜTUNU TARAMASI — bir dahaki sızıntı tesadüfe kalmasın
-- ----------------------------------------------------------------------------
-- 69_secret_columns_test.sql, ADINI BİLDİĞİMİZ sütunları sınar. İyi bir test
-- ama bir eksiği var: yalnızca birinin bakmayı akıl ettiği sütunları korur.
-- `merchants.postback_secret` tam da bu yüzden aylarca açık kaldı.
--
-- Bu dosya tersini yapar: KATALOĞU tarar. Adı sır çağrıştıran her sütunu
-- bulur ve istemci rollerine kapalı olduğunu iddia eder. Yarın eklenecek bir
-- tablo, kimse bu dosyaya dokunmadan kapsama girer.
--
-- KAPSAM DIŞI LİSTESİ GEREKÇE İSTER.
-- Bir sütunu listeden çıkarmak, "bu sır değil" demektir ve bu bir karardır;
-- kararın yazılı gerekçesi olmadan liste zamanla "testi susturma listesi"ne
-- dönüşür.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

do $$
declare
  r record;
  n int := 0;
  taranan int := 0;
  /*
   * KAPSAM DIŞI — her satır: tablo, sütun, GEREKÇE.
   * Gerekçe yazmadan buraya satır eklemek yasak; okuyan kişi neden güvenli
   * olduğunu görebilmeli.
   */
  muaf text[][] := array[
    ['product_groups', 'match_signature',
     'Baslik/marka/GTIN''den turetilmis eslestirme imzasi. Vitrinde kullaniliyor, gizli bilgi tasimiyor.'],
    ['risk_thresholds', 'key',
     'Esik adi (ornek: median_ratio_block). Zaten istemciye kapali; kalibla adi yuzunden esleşiyor.']
  ];
  muaf_mi boolean;
begin
  for r in
    select c.relname as tablo, a.attname as sutun
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where c.relkind = 'r'
       /*
        * Kalıp KASITLI olarak geniş: yanlış alarm ucuz (bir satır muafiyet),
        * kaçırma pahalı (bir sızıntı). "hash" da dahil -- tuzlanmış bir özet
        * bile kişiyi tekilleştirmeye yarar ve istemcinin işi değildir.
        */
       and a.attname ~* '(secret|token|passw|_key$|^key$|hash|credential|private|salt|signature)'
     order by c.relname, a.attname
  loop
    taranan := taranan + 1;

    muaf_mi := false;
    for i in 1 .. coalesce(array_length(muaf, 1), 0) loop
      if muaf[i][1] = r.tablo and muaf[i][2] = r.sutun then
        muaf_mi := true;
        exit;
      end if;
    end loop;

    if muaf_mi then continue; end if;

    if has_column_privilege('anon', format('public.%I', r.tablo), r.sutun, 'select') then
      raise exception
        'BAŞARISIZ: anon %.% okuyabiliyor. Sır değilse muafiyet listesine GEREKÇESİYLE ekleyin.',
        r.tablo, r.sutun;
    end if;

    if has_column_privilege('authenticated', format('public.%I', r.tablo), r.sutun, 'select') then
      raise exception
        'BAŞARISIZ: authenticated %.% okuyabiliyor. Sır değilse muafiyet listesine GEREKÇESİYLE ekleyin.',
        r.tablo, r.sutun;
    end if;

    n := n + 1;
  end loop;

  if taranan = 0 then
    -- Kalıp hiçbir şey bulmadıysa test bir şey ölçmüyor demektir.
    raise exception 'BAŞARISIZ: tarama hicbir sutun bulamadi — kalip bozulmus olabilir';
  end if;

  raise notice '✓ sir adayi % sutun tarandi, %''si istemciye kapali, % muaf (gerekceli)',
    taranan, n, taranan - n;
end $$;

-- ---------------------------------------------------------------------------
-- SUNUCU TARAFI ERİŞİMİ BOZULMADI MI?
-- ---------------------------------------------------------------------------
-- Yukarıdaki tarama "hepsini kapat" diyerek de geçerdi ve API kimlik
-- doğrulamasını sessizce çökertirdi. Bu blok, sunucunun ihtiyaç duyduğu
-- sırlara erişiminin durduğunu kanıtlar.
do $$
declare
  gerekli text[][] := array[
    ['api_keys', 'key_hash'],            -- API anahtarı doğrulaması
    ['merchants', 'postback_secret'],    -- dönüşüm imzası doğrulaması
    ['merchants', 'deeplink_template'],  -- yönlendirme linki üretimi
    ['merchants', 'tracking_id']
  ];
begin
  for i in 1 .. array_length(gerekli, 1) loop
    if not has_column_privilege('service_role', format('public.%I', gerekli[i][1]),
                                gerekli[i][2], 'select') then
      raise exception 'BAŞARISIZ: service_role %.% okuyamiyor — sunucu akisi coker',
        gerekli[i][1], gerekli[i][2];
    end if;
  end loop;
  raise notice '✓ sunucu tarafi gerekli sirlara erisebiliyor';
end $$;

-- ---------------------------------------------------------------------------
-- SATICI PANELİ ÇALIŞMAYA DEVAM EDİYOR MU?
-- ---------------------------------------------------------------------------
do $$
declare
  panel text[][] := array[
    ['api_keys', 'key_prefix'], ['api_keys', 'last_four'], ['api_keys', 'name'],
    ['api_keys', 'request_count'], ['api_keys', 'last_used_at'], ['api_keys', 'scopes']
  ];
begin
  for i in 1 .. array_length(panel, 1) loop
    if not has_column_privilege('authenticated', format('public.%I', panel[i][1]),
                                panel[i][2], 'select') then
      raise exception 'BAŞARISIZ: satici paneli %.% okuyamiyor', panel[i][1], panel[i][2];
    end if;
  end loop;
  raise notice '✓ satici paneli kendi anahtar bilgilerini okuyabiliyor';
end $$;

rollback;
