#!/usr/bin/env node
/**
 * GERÇEK AJAN ÇALIŞTIRICISI — sözleşme doğrulaması.
 *
 * İkinci dikey dilim. Zincir birincisiyle aynı ama araç farklı: burada
 * gerçek ALT SÜREÇLER çalışıyor.
 *
 * DOĞRULAYICI NEDEN BAĞIMSIZ
 * Ajanın raporunu kabul etmiyor. İzin listesindeki kontrolleri KENDİSİ
 * yeniden çalıştırıyor ve çıkış kodlarını ajanınkiyle karşılaştırıyor.
 * Bir alt sürecin çıktısı bu sistemin en az güvenilen girdisi; tek bir
 * okumaya dayanmak, "araç çıktısı güvenilir değildir" kuralını kâğıt
 * üstünde bırakırdı.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  BellekteDenetimDeposu, SupremeAuditor, SupremeOrchestrator, dogrula,
} from '@ohaaaa/shared';
import {
  CALISTIRILAN, SOZLESME_YETENEGI, kontrolDokumu, uretimDefteriniKur,
} from '@ohaaaa/shared/agents';
import { aracCalistir } from '@ohaaaa/shared/tools';

const kok = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATOR_ID = 'contract-verification-validator';
const GOREV = 'contract-verify';

const yaz = (s, msg, ek = {}) => console.log(JSON.stringify({ level: s, msg, ...ek }));

const { registry, araclar } = uretimDefteriniKur({ kokDizin: kok });

yaz('info', 'kayit defteri', {
  kayitliAjan: registry.all().map((a) => a.id),
  uygulananAraclar: araclar.uygulananlar(),
  uygulanmayanArac: araclar.uygulanmayanlar().length,
  izinListesi: kontrolDokumu().map((k) => k.kimlik),
});

/* Süpervizör yönlendirmesi: bu görev engineering alanına ait olmalı. */
const ajanTanimi = registry.resolve(SOZLESME_YETENEGI, 'TR');
yaz('info', 'supervisor routing', {
  yetenek: SOZLESME_YETENEGI, ajan: ajanTanimi.id, supervisor: ajanTanimi.supervisor,
  araclar: [...ajanTanimi.allowedTools],
});

const depo = new BellekteDenetimDeposu();
const orchestrator = new SupremeOrchestrator(registry, { denetim: depo });
const auditor = new SupremeAuditor();

const baslangic = Date.now();
const { onUcus, sonuc } = await orchestrator.calistir(
  'TR', [{ id: GOREV, capability: SOZLESME_YETENEGI }],
);

if (!onUcus.gecti || !sonuc) {
  yaz('error', 'on ucus gecmedi', { engeller: onUcus.engeller });
  process.exit(1);
}

const adim = sonuc.steps.find((s) => s.taskId === GOREV);
if (!adim || adim.status !== 'tamamlandi') {
  yaz('error', 'ajan tamamlanmadi', { adim });
  process.exit(1);
}

const cikti = sonuc.outputs[GOREV];
const agentId = adim.agentId ?? 'bilinmiyor';
const bitis = Date.now();

yaz('info', 'ajan calisti', {
  ajan: agentId, baslangic, bitis, sureMs: adim.durationMs,
  guven: adim.confidence, cikti,
});

// --- Validator: kontrolleri BAĞIMSIZ olarak yeniden çalıştır -------------
const kontrolAraci = araclar.get('run_check');
const vctx = {
  agentId: VALIDATOR_ID,
  izinliAraclar: new Set(['run_check']),
  guvenliMod: false,
  kalanMs: 300_000,
  log: () => {},
};

const bagimsiz = [];
for (const kontrol of CALISTIRILAN) {
  const r = await aracCalistir(kontrolAraci, { kontrol }, vctx);
  bagimsiz.push({ kontrol: r.kontrol, cikisKodu: r.cikisKodu, gecti: r.gecti });
}

const ajanKodlari = cikti.sonuclar.map((r) => `${r.kontrol}:${r.cikisKodu}`).join(',');
const validatorKodlari = bagimsiz.map((r) => `${r.kontrol}:${r.cikisKodu}`).join(',');
const ortusuyor = ajanKodlari === validatorKodlari;
const hepsiGecti = bagimsiz.every((r) => r.gecti);

const isCiktisi = {
  agentId, cikti, guven: adim.confidence ?? 0,
  kanitlar: (adim.evidence ?? []).map((g) => ({
    kaynak: 'run_check', gozlem: g, at: Date.now(),
  })),
  etki: 'orta',
};

const validatorKarari = dogrula(isCiktisi, VALIDATOR_ID, {
  gecti: ortusuyor && hepsiGecti,
  aciklama: !ortusuyor
    ? `bagimsiz cikis kodlari ORTUSMUYOR: ajan=${ajanKodlari} validator=${validatorKodlari}`
    : !hepsiGecti ? 'en az bir kontrol sifirdan farkli cikis verdi' : undefined,
});

yaz(validatorKarari.gecti ? 'info' : 'error', 'validator karari', {
  gecti: validatorKarari.gecti, ortusuyor, hepsiGecti,
  bagimsizKodlar: bagimsiz,
  ...(validatorKarari.gecti ? {} : { redler: validatorKarari.redler }),
});

// --- Denetim izi ---------------------------------------------------------
await orchestrator.izeYaz({
  taskId: GOREV, agentId, at: Date.now(),
  araclar: ['run_check'],
  eylem: `izin listesindeki ${CALISTIRILAN.length} kontrol calistirildi`,
  girdiOzeti: CALISTIRILAN.join('+'),
  ciktiOzeti: `gecen=${cikti.gecen}/${cikti.calistirilan} kodlar=${ajanKodlari}`,
  guven: adim.confidence ?? 0,
  kanitlar: isCiktisi.kanitlar,
  dogrulayan: VALIDATOR_ID,
  denetleyen: auditor.id,
  onaylayan: null,
  durum: validatorKarari.gecti ? 'uygulandi' : 'dogrulama_reddi',
});
const iz = await depo.gorevIzi(GOREV);

// --- Supreme Auditor -----------------------------------------------------
const denetim = auditor.denetleIs(
  isCiktisi,
  [{ validatorId: VALIDATOR_ID, karar: validatorKarari, at: Date.now() }],
  iz,
);
const koordinasyonTutarli = auditor.denetleKoordinasyon(onUcus);

yaz(denetim.onaylandi ? 'info' : 'error', 'supreme auditor karari', {
  onaylandi: denetim.onaylandi, bulgular: denetim.bulgular,
  koordinasyonTutarli, izKaydi: iz.length,
});

// --- Sağlık --------------------------------------------------------------
const saglik = orchestrator.ajanSagligi(agentId);
saglik.isle({
  basarili: adim.status === 'tamamlandi',
  dogrulamaReddi: !validatorKarari.gecti,
  guven: adim.confidence ?? 0,
  gercektenDogru: ortusuyor,
  denemeler: adim.attempts, sureMs: adim.durationMs, maliyetKurus: 0,
});
yaz('info', 'saglik defteri', { ajan: agentId, durum: saglik.durum, ozet: saglik.ozet });

// --- Sonuç ---------------------------------------------------------------
if (!auditor.uretimOnayi(validatorKarari, denetim) || !koordinasyonTutarli) {
  yaz('error', 'zincir gecmedi -- sonuc KABUL EDILMIYOR');
  process.exit(1);
}
if (!cikti.temiz) {
  yaz('error', 'DOGRULAMA BASARISIZ', { kalan: cikti.kalan });
  process.exit(1);
}
yaz('info', 'sozlesme dogrulamasi temiz', { gecen: cikti.gecen });
