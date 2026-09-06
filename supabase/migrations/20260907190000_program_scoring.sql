-- ===========================================================================
-- programs: puanlama girdileri ve kalıcı skor
-- ===========================================================================
--
-- İKİ AYRI ŞEY EKLENİYOR VE KARIŞTIRILMAMALI:
--
--   GİRDİ   epc_cents, aov_cents -- ağın yayınladığı performans verisi.
--           `programs`ın geri kalanı gibi: bilinmiyorsa NULL.
--
--   ÇIKTI   score, score_breakdown, scored_at -- BİZİM hesabımız.
--           Ağdan gelmez; her puanlama turunda yeniden yazılır.
--
-- Girdiyi çıktıyla aynı tabloda tutmak bilinçli: puan, satırın kendisine
-- ait türetilmiş bir alan ve ayrı tabloya koymak her okumada bir JOIN
-- getirirdi. Ama isimlendirme ayrımı korunuyor -- `score*` öneki, bu üç
-- sütunun ağdan DEĞİL bizden geldiğini söylüyor.
--
-- ---------------------------------------------------------------------------
-- PARA KURUŞ (tam sayı)
-- ---------------------------------------------------------------------------
-- EPC ve AOV `numeric` değil `bigint` kuruş. Kayan noktalı para hesabı
-- yapılmıyor: 0.1 + 0.2 ikilik tabanda 0.30000000000000004'tür ve bu fark
-- puanlamaya girdiğinde aynı programın iki farklı turda farklı puan
-- alması demek olurdu -- determinizm sözü kırılırdı.
--
-- ---------------------------------------------------------------------------
-- score NEDEN NULLABLE
-- ---------------------------------------------------------------------------
-- Henüz puanlanmamış program ile puanı 0 olan program AYNI ŞEY DEĞİL.
-- NOT NULL + varsayılan 0 olsaydı, keşfedilmiş ama hiç puanlanmamış her
-- program "en kötü" görünür ve sıralamanın dibinde kaybolurdu.
--
-- ---------------------------------------------------------------------------
-- score_breakdown: HESABIN KENDİSİ DENETLENEBİLİR
-- ---------------------------------------------------------------------------
-- Yalnızca sonucu saklamak, "bu program neden 72 aldı" sorusunu
-- cevapsız bırakır ve ağırlıklar değiştiğinde eski puanların neye göre
-- verildiği kaybolur. Breakdown her bileşenin ham değerini,
-- normalize edilmiş değerini, ağırlığını ve katkısını taşır.
-- ===========================================================================

alter table public.programs
  -- Ağın yayınladığı performans verisi. NULL = yayınlamamış.
  add column epc_cents        bigint,
  add column aov_cents        bigint,

  -- BİZİM hesabımız. NULL = henüz puanlanmadı ( puanı 0 olan DEĞİL ).
  add column score            numeric(5, 2),
  add column score_breakdown  jsonb,
  add column scored_at        timestamptz;

alter table public.programs
  add constraint programs_epc_non_negative
    check (epc_cents is null or epc_cents >= 0),
  add constraint programs_aov_non_negative
    check (aov_cents is null or aov_cents >= 0),

  -- Skor 0-100 dışına ÇIKAMAZ. Kod tarafında da sınırlanıyor; bu kısıt
  -- kodun sınırlamayı unutması ihtimaline karşı son kapı. Sınırsız bir
  -- skor, sıralamayı tek bir bozuk satırın ele geçirmesi demekti.
  add constraint programs_score_range
    check (score is null or (score >= 0 and score <= 100)),

  -- Skor varsa ne zaman hesaplandığı da olmalı: tarihsiz bir skor,
  -- bayatlığı ölçülemeyen bir skordur.
  add constraint programs_score_needs_timestamp
    check ((score is null) = (scored_at is null)),

  -- Skor varsa dökümü de olmalı: dökümsüz skor denetlenemez.
  add constraint programs_score_needs_breakdown
    check ((score is null) = (score_breakdown is null));

comment on column public.programs.epc_cents is
  'Agin yayinladigi tiklama basina kazanc, KURUS. NULL = yayinlanmamis.';
comment on column public.programs.score is
  'BIZIM hesabimiz, 0-100. NULL = henuz puanlanmadi -- puani 0 olan DEGIL.';
comment on column public.programs.score_breakdown is
  'Her bilesenin ham/normalize/agirlik/katki degeri. Skorun neden o oldugu '
  'buradan denetlenir.';

-- Sıralama sorgusu: en yüksek puanlı, puanlanmış programlar.
-- Kısmi indeks çünkü puanlanmamış satırlar bu sorguya hiç girmiyor.
create index programs_score_idx
  on public.programs (score desc nulls last)
  where score is not null;

-- ---------------------------------------------------------------------------
-- GÖÇ KENDİNİ DOĞRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  -- 1) Beş sütun da eklendi ve HEPSİ nullable.
  if (select count(*) from information_schema.columns
       where table_schema='public' and table_name='programs'
         and column_name in ('epc_cents','aov_cents','score','score_breakdown','scored_at')
         and is_nullable='YES') <> 5 then
    raise exception 'DOGRULAMA 1: bes puanlama sutunu nullable olarak eklenmedi.';
  end if;

  -- 2) Skor sınırı GERÇEKTEN tutuyor.
  insert into public.programs (network, network_program_id, merchant_name, last_verified_at)
       values ('awin', 'GOC-DOGRULAMA', 'Goc Dogrulama', now())
    returning id into v_id;

  begin
    update public.programs set score = 101, scored_at = now(), score_breakdown = '{}'::jsonb
     where id = v_id;
    raise exception 'DOGRULAMA 2: 100 ustu skor kabul edildi -- siniri tek bozuk satir ele gecirebilirdi.';
  exception
    when check_violation then null;  -- beklenen
  end;

  -- 3) Tarihsiz skor kabul edilmiyor.
  begin
    update public.programs set score = 50 where id = v_id;
    raise exception 'DOGRULAMA 3: tarihsiz skor kabul edildi -- bayatligi olculemezdi.';
  exception
    when check_violation then null;  -- beklenen
  end;

  -- 4) Dökümsüz skor kabul edilmiyor.
  begin
    update public.programs set score = 50, scored_at = now() where id = v_id;
    raise exception 'DOGRULAMA 4: dokumsuz skor kabul edildi -- denetlenemezdi.';
  exception
    when check_violation then null;  -- beklenen
  end;

  -- 5) Gecerli skor yazilabiliyor -- kapatma fazla kapatmamis.
  update public.programs
     set score = 72.50, scored_at = now(), score_breakdown = '{"commission":1}'::jsonb
   where id = v_id;

  delete from public.programs where id = v_id;

  raise notice
    'programs puanlama sutunlari eklendi: score 0-100 sinirli, tarihsiz ve '
    'dokumsuz skor reddediliyor, puanlanmamis program NULL kaliyor.';
end $$;
