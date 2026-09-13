#!/usr/bin/env node
/**
 * GERÇEK AJAN ÇALIŞTIRICISI — yerelleştirme parite denetimi.
 *
 * Bu betik bir gösteri değil, üretim yüzeyi: CI'da çalışır ve sapma
 * bulursa sıfırdan farklı kodla çıkar. Zincirin tamamı burada:
 *
 *   Görev → SupremeOrchestrator (ön uçuş) → kayıtlı uzman ajan
 *         → gerçek araç (read_repo) → yapılandırılmış sonuç
 *         → Validator (bağımsız yeniden türetme) → Supreme Auditor
 *         → denetim izi + sağlık defteri
 *
 * VALIDATOR NEDEN BAĞIMSIZ
 * Ajanın çıktısını kabul etmiyor; aynı dosyaları KENDİSİ okuyup ölçümü
 * yeniden türetiyor ve iki sonucu karşılaştırıyor. "Ajan söyledi, doğru
 * kabul edildi" tam olarak bu adımla engelleniyor.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  BellekteDenetimDeposu, SupremeAuditor, SupremeOrchestrator, dogrula,
} from '@ohaaaa/shared';
import {
  EN_YOLU, TR_YOLU, YETENEK, pariteyiOlc, sozlukAyristir, uretimDefteriniKur,
} from '@ohaaaa/shared/agents';
import { aracCalistir } from '@ohaaaa/shared/tools';

const kok = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VALIDATOR_ID = 'localization-validator';
const GOREV = 'locale-parity';

function yaz(seviye, msg, ek = {}) {
  console.log(JSON.stringify({ level: seviye, msg, ...ek }));
}

const { registry, araclar } = uretimDefteriniKur({ kokDizin: kok });

yaz('info', 'ajan kayit defteri kuruldu', {
  kayitliAjan: registry.all().map((a) => a.id),
  uygulananAraclar: araclar.uygulananlar(),
  uygulanmayanArac: araclar.uygulanmayanlar().length,
});

const denetimDeposu = new BellekteDenetimDeposu();
const orchestrator = new SupremeOrchestrator(registry, { denetim: denetimDeposu });
const auditor = new SupremeAuditor();

const gorevler = [{ id: GOREV, capability: YETENEK }];

// --- 1) Ön uçuş + yürütme -------------------------------------------------
const { onUcus, sonuc } = await orchestrator.calistir('TR', gorevler);

if (!onUcus.gecti || !sonuc) {
  yaz('error', 'on ucus gecmedi; motor calistirilmadi', { engeller: onUcus.engeller });
  process.exit(1);
}

const adim = sonuc.steps.find((s) => s.taskId === GOREV);
if (!adim || adim.status !== 'tamamlandi') {
  yaz('error', 'ajan calismasi tamamlanmadi', { adim });
  process.exit(1);
}

const cikti = sonuc.outputs[GOREV];
const agentId = adim.agentId ?? 'bilinmiyor';

yaz('info', 'ajan calisti', {
  ajan: agentId, sureMs: adim.durationMs, guven: adim.confidence, cikti,
});

// --- 2) Validator: ölçümü BAĞIMSIZ olarak yeniden türet -------------------
const okuyucu = araclar.get('read_repo');
const vctx = {
  agentId: VALIDATOR_ID,
  izinliAraclar: new Set(['read_repo']),
  guvenliMod: false,
  kalanMs: 10_000,
  log: () => {},
};

const trHam = await aracCalistir(okuyucu, { yol: TR_YOLU }, vctx);
const enHam = await aracCalistir(okuyucu, { yol: EN_YOLU }, vctx);
const bagimsiz = pariteyiOlc(sozlukAyristir(trHam.icerik), sozlukAyristir(enHam.icerik));

const ayni = JSON.stringify(bagimsiz) === JSON.stringify(cikti);

const isCiktisi = {
  agentId,
  cikti,
  guven: adim.confidence ?? 0,
  kanitlar: (adim.evidence ?? []).map((g) => ({
    kaynak: 'read_repo', gozlem: g, at: Date.now(),
  })),
  etki: 'orta',
};

const validatorKarari = dogrula(isCiktisi, VALIDATOR_ID, {
  gecti: ayni,
  aciklama: ayni ? undefined : 'bagimsiz olcum ajan ciktisiyla ORTUSMUYOR',
});

yaz(validatorKarari.gecti ? 'info' : 'error', 'validator karari', {
  gecti: validatorKarari.gecti,
  bagimsizOlcumOrtusuyor: ayni,
  ...(validatorKarari.gecti ? {} : { redler: validatorKarari.redler }),
});

// --- 3) Denetim izi -------------------------------------------------------
await orchestrator.izeYaz({
  taskId: GOREV,
  agentId,
  at: Date.now(),
  araclar: ['read_repo'],
  eylem: 'tr/en sozluk yer tutucu paritesi olculdu',
  girdiOzeti: `${TR_YOLU}+${EN_YOLU}`,
  ciktiOzeti: `sapma=${bagimsiz.sapmalar.length} uyari=${bagimsiz.cevrilmemisAdaylari.length}`,
  guven: adim.confidence ?? 0,
  kanitlar: isCiktisi.kanitlar,
  dogrulayan: VALIDATOR_ID,
  denetleyen: auditor.id,
  onaylayan: null,
  durum: validatorKarari.gecti ? 'uygulandi' : 'dogrulama_reddi',
});

const iz = await denetimDeposu.gorevIzi(GOREV);

// --- 4) Supreme Auditor: bağımsız denetim ---------------------------------
const denetim = auditor.denetleIs(
  isCiktisi,
  [{ validatorId: VALIDATOR_ID, karar: validatorKarari, at: Date.now() }],
  iz,
);
const koordinasyonTutarli = auditor.denetleKoordinasyon(onUcus);

yaz(denetim.onaylandi ? 'info' : 'error', 'supreme auditor karari', {
  onaylandi: denetim.onaylandi,
  bulgular: denetim.bulgular,
  koordinasyonTutarli,
  izKaydi: iz.length,
});

// --- 5) Sağlık defteri ----------------------------------------------------
const saglik = orchestrator.ajanSagligi(agentId);
saglik.isle({
  basarili: adim.status === 'tamamlandi',
  dogrulamaReddi: !validatorKarari.gecti,
  guven: adim.confidence ?? 0,
  gercektenDogru: ayni,
  denemeler: adim.attempts,
  sureMs: adim.durationMs,
  maliyetKurus: 0,
});

yaz('info', 'saglik defteri', { ajan: agentId, durum: saglik.durum, ozet: saglik.ozet });

// --- 6) Bulgu raporu ------------------------------------------------------
const uretimOnayi = auditor.uretimOnayi(validatorKarari, denetim);
if (!uretimOnayi || !koordinasyonTutarli) {
  yaz('error', 'zincir gecmedi -- sonuc KABUL EDILMIYOR');
  process.exit(1);
}

yaz('info', 'parite raporu', {
  anahtar: bagimsiz.anahtar,
  yerTutuculu: bagimsiz.yerTutuculu,
  sapma: bagimsiz.sapmalar.length,
  cevrilmemisAdayi: bagimsiz.cevrilmemisAdaylari,
});

if (!bagimsiz.temiz) {
  yaz('error', 'YER TUTUCU SAPMASI', { sapmalar: bagimsiz.sapmalar });
  process.exit(1);
}

yaz('info', 'parite temiz');
