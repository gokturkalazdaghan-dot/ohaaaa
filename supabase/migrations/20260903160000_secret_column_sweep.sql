-- ============================================================================
-- SIR SÜTUNLARI — tek seferlik yama değil, sistematik kapatma
-- ----------------------------------------------------------------------------
-- `merchants.postback_secret` açığı bulunduğunda yalnızca o sütun kapatıldı.
-- Ama bulunma şekli tesadüfîydi: biri bakmayı akıl etti. Aynı sınıfın geri
-- kalanı hâlâ açıksa, bir sonraki sızıntı da tesadüfe kalırdı.
--
-- Bu göç, şemadaki BÜTÜN sır adayı sütunları tarayarak bulunanları kapatır.
-- Eşlik eden test (72_secret_column_sweep_test.sql) taramayı KATALOG
-- ÜZERİNDEN her çalıştırmada tekrarlar: yarın eklenecek bir tablo da
-- kendiliğinden kapsama girer.
--
-- BULUNANLAR
--
-- 1) api_keys.key_hash — `authenticated` okuyabiliyordu.
--    Kırılabilir mi? Anahtarın gizli kısmı 48 onaltılık karakter (192 bit);
--    sha256 özetini kaba kuvvetle çözmek pratikte imkânsız. Yani ACİL bir
--    açık değil. Ama ölçüldü: bu sütunu okuyan tek yer `vendorAuth.ts` ve
--    orası `service_role` kullanıyor. İstemcinin okumasının HİÇBİR amacı
--    yok. En az yetki ilkesi, "kırılamıyor" gerekçesiyle geniş yetki
--    bırakmayı kabul etmez -- yarın özet algoritması ya da anahtar uzunluğu
--    değişirse, bugün verilmiş gereksiz yetki o değişikliği bekliyor olur.
--
-- 2) agent_decisions.session_hash — `authenticated` okuyabiliyordu.
--    RLS zaten yalnızca yöneticiye açıyor, yani satır sızmıyor. Ama sütun
--    yetkisi RLS'ten BAĞIMSIZ bir katman ve gereğinden geniş duruyordu.
--    Kapatmanın maliyeti sıfır.
--
-- KAPSAM DIŞI BIRAKILAN, GEREKÇESİYLE
--
--   product_groups.match_signature — adı kalıba uyuyor ama sır değil:
--   başlık/marka/GTIN'den türetilmiş eşleştirme imzası. Vitrinde
--   kullanılıyor ve gizlenmesi gereken bir bilgi taşımıyor.
--
--   risk_thresholds.key — eşik adı ("median_ratio_block"). Zaten istemciye
--   kapalı; kalıba adı yüzünden takılıyor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- api_keys — sütun listesi şemadan birebir, yalnızca key_hash dışarıda
-- ---------------------------------------------------------------------------
-- Satıcı kendi anahtarının ADINI, ÖNEKİNİ, son dört hanesini ve kullanım
-- istatistiğini görmeli (panel bunları gösteriyor); ÖZETİNİ değil.
revoke select on public.api_keys from anon, authenticated;

grant select (
  id, vendor_id, name, environment, key_prefix, last_four, scopes,
  rate_limit_per_minute, created_by, last_used_at, last_used_ip,
  request_count, expires_at, revoked_at, created_at
) on public.api_keys to authenticated;

-- anon'a hiç verilmiyordu, öyle kalıyor.

-- ---------------------------------------------------------------------------
-- agent_decisions — oturum özeti kapatılıyor
-- ---------------------------------------------------------------------------
revoke select on public.agent_decisions from anon, authenticated;

grant select (
  id, agent, model, prompt_version, input_digest, decision, confidence,
  evidence, expected_outcome, actual_outcome, measured_at, created_at
) on public.agent_decisions to authenticated;

-- ---------------------------------------------------------------------------
-- Kendi kendini doğrulayan kontrol
-- ---------------------------------------------------------------------------
do $$
begin
  if has_column_privilege('authenticated', 'public.api_keys', 'key_hash', 'select') then
    raise exception 'BAŞARISIZ: api_keys.key_hash hâlâ istemciye açık';
  end if;
  if has_column_privilege('authenticated', 'public.agent_decisions', 'session_hash', 'select') then
    raise exception 'BAŞARISIZ: agent_decisions.session_hash hâlâ istemciye açık';
  end if;

  -- Fazlasını kapatmadığımızın kanıtı: panel bu alanları gösteriyor.
  if not has_column_privilege('authenticated', 'public.api_keys', 'key_prefix', 'select') then
    raise exception 'BAŞARISIZ: satıcı kendi anahtar önekini göremiyor';
  end if;
  if not has_column_privilege('authenticated', 'public.api_keys', 'request_count', 'select') then
    raise exception 'BAŞARISIZ: satıcı kendi kullanım sayacını göremiyor';
  end if;

  -- Sunucu tarafı doğrulaması çalışmaya devam etmeli.
  if not has_column_privilege('service_role', 'public.api_keys', 'key_hash', 'select') then
    raise exception 'BAŞARISIZ: service_role anahtar özetini okuyamıyor — API kimlik doğrulaması çöker';
  end if;
end $$;
