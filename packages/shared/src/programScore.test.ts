import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SCORE_COMPONENTS,
  SCORE_SCALES,
  SCORE_WEIGHTS,
  ScoreError,
  scoreProgram,
  type ScoreInput,
} from './programScore.js';

/**
 * Bu dosyanın merkezindeki tehlike: eksik veriyi kötü veri saymak.
 *
 * Ölçüm noktası şu: komisyonu %10 olan ama başka HİÇBİR alanı bilinmeyen
 * bir program ile her alanı bilinen ortalama bir program karşılaştırıldığında
 * ilki dibe düşmemeli. Aşağıdaki testlerin çoğu bu tek kuralın farklı
 * yüzleri.
 */

const SIMDI = new Date('2026-09-06T00:00:00Z');

/** Hiçbir şeyin bilinmediği taban girdi. Her test yalnız ilgilendiği alanı doldurur. */
function bos(): ScoreInput {
  return {
    commissionRate: null,
    epcCents: null,
    aovCents: null,
    cookieWindowDays: null,
    feedAvailable: null,
    productCount: null,
    marketCode: null,
    countryCode: null,
    deeplinkSupported: null,
    applicationSupported: null,
    lastVerifiedAt: null,
  };
}

function puanla(patch: Partial<ScoreInput>, targetMarkets?: readonly string[]) {
  return scoreProgram({ ...bos(), ...patch }, { now: SIMDI, targetMarkets });
}

/** Girdiden `n` gün önce. */
function gunOnce(n: number): string {
  return new Date(SIMDI.getTime() - n * 86_400_000).toISOString();
}

// ===========================================================================
// 1 — TAM DOLU PROGRAM
// ===========================================================================
test('1) tam dolu program: her bileşen hesaba katılır, skor tam olarak kilitli', () => {
  const r = puanla(
    {
      commissionRate: 0.1, // 0.1/0.2  = 0.5  × 25 = 12.5
      epcCents: 100, // 100/200  = 0.5  × 20 = 10
      feedAvailable: true, //            1    × 15 = 15
      cookieWindowDays: 30, // 30/60   = 0.5  × 10 = 5
      marketCode: 'US', // hedefte    = 1    × 10 = 10
      productCount: 9999, // log10 tabanlı  × 7  = 5.599995…
      aovCents: 10_000, // 10000/20000 = 0.5 × 5 = 2.5
      deeplinkSupported: true, // 0.6         × 5  = 3
      applicationSupported: false,
      lastVerifiedAt: gunOnce(15), // 1-15/30 = 0.5 × 3 = 1.5
    },
    ['US'],
  );

  assert.equal(r.applicableWeight, 100, 'her bileşen bilindiğinde payda 100 olmalı');
  assert.equal(r.score, 65.1);
  assert.ok(
    r.breakdown.every((b) => b.applicable),
    'tam dolu girdide hesap dışı bileşen kalmamalı',
  );
});

// ===========================================================================
// 2 — TÜM ALANLAR NULL
// ===========================================================================
test('2) hiçbir şey bilinmiyorsa skor NULL — 0 DEĞİL', () => {
  const r = puanla({});

  assert.equal(r.score, null, '"puanlanamadı" ile "0 puan aldı" aynı şey değil');
  assert.equal(r.applicableWeight, 0);
  assert.equal(r.earnedWeight, 0);
  assert.ok(
    r.breakdown.every((b) => !b.applicable && b.normalized === null && b.contribution === 0),
    'bilinmeyen bileşen ne paya ne paydaya girmeli',
  );
});

// ===========================================================================
// 3-7 — TEK BİLEŞENLİ PROGRAMLAR: VERİ YOKLUĞU CEZA DEĞİL
// ===========================================================================
test('3) yalnız komisyon: bilinen tek alan üzerinden puanlanır, dibe düşmez', () => {
  const r = puanla({ commissionRate: 0.1 });

  assert.equal(r.applicableWeight, SCORE_WEIGHTS.commission);
  assert.equal(r.score, 50, '%10 komisyon tavanın yarısı — diğer alanlar eksik diye düşmemeli');
});

test('4) yalnız EPC', () => {
  const r = puanla({ epcCents: 50 }); // 50/200 = 0.25
  assert.equal(r.applicableWeight, SCORE_WEIGHTS.epc);
  assert.equal(r.score, 25);
});

test('5) yalnız AOV', () => {
  const r = puanla({ aovCents: 5_000 }); // 5000/20000 = 0.25
  assert.equal(r.applicableWeight, SCORE_WEIGHTS.aov);
  assert.equal(r.score, 25);
});

test('6) yalnız feed: var = 100, yok = 0 — ikisi de BİLİNEN', () => {
  const varsa = puanla({ feedAvailable: true });
  const yoksa = puanla({ feedAvailable: false });

  assert.equal(varsa.applicableWeight, SCORE_WEIGHTS.feed);
  assert.equal(varsa.score, 100);

  assert.equal(yoksa.applicableWeight, SCORE_WEIGHTS.feed, 'feed=false BİLİNEN bir gerçek');
  assert.equal(yoksa.score, 0);
});

test('7) yalnız ürün sayısı: logaritmik normalizasyon', () => {
  const r = puanla({ productCount: 9_999 }); // log10(10000)/log10(100001) ≈ 0.7999993
  assert.equal(r.applicableWeight, SCORE_WEIGHTS.productCount);
  assert.equal(r.score, 80);

  // Doğrusal olsaydı 9 999 ürün tavanın onda biri kadar puan alırdı.
  const dogrusalOlsaydi = (9_999 / SCORE_SCALES.productCountFull) * 100;
  assert.ok(
    r.score !== null && r.score > dogrusalOlsaydi,
    'katalog derinliğinin faydası doğrusal değil',
  );
});

// ===========================================================================
// 8-9 — SINIR DEĞERLER
// ===========================================================================
test('8) minimum değerler: her bileşen bilinen en kötü hâlde → 0', () => {
  const r = puanla(
    {
      commissionRate: 0,
      epcCents: 0,
      aovCents: 0,
      cookieWindowDays: 0,
      feedAvailable: false,
      productCount: 0,
      marketCode: 'TR',
      deeplinkSupported: false,
      applicationSupported: false,
      lastVerifiedAt: gunOnce(365),
    },
    ['US'],
  );

  assert.equal(r.applicableWeight, 100, 'hepsi bilinen: payda tam');
  assert.equal(r.score, 0);
  assert.notEqual(r.score, null, '0 puan ile puansızlık ayrı');
});

test('9) maksimum değerler: tavan ve üstü tam puan → 100', () => {
  const r = puanla(
    {
      commissionRate: 0.95, // tavanın çok üstü
      epcCents: 100_000,
      aovCents: 10_000_000,
      cookieWindowDays: 365,
      feedAvailable: true,
      productCount: 5_000_000,
      marketCode: 'US',
      deeplinkSupported: true,
      applicationSupported: true,
      lastVerifiedAt: SIMDI.toISOString(),
    },
    ['US'],
  );

  assert.equal(r.score, 100);
  assert.equal(r.applicableWeight, 100);
});

// ===========================================================================
// 10-11 — GERÇEK 0 İLE NULL AYRIMI
// ===========================================================================
test('10) gerçek 0 değerleri bilinen kabul edilir ve PAYDAYA girer', () => {
  const r = puanla({ commissionRate: 0, epcCents: 0, cookieWindowDays: 0, productCount: 0 });

  assert.equal(
    r.applicableWeight,
    SCORE_WEIGHTS.commission + SCORE_WEIGHTS.epc + SCORE_WEIGHTS.cookie + SCORE_WEIGHTS.productCount,
  );
  assert.equal(r.score, 0);

  for (const c of ['commission', 'epc', 'cookie', 'productCount'] as const) {
    const b = r.breakdown.find((x) => x.component === c)!;
    assert.equal(b.applicable, true, `${c}: gerçek 0 hesaba katılmalı`);
    assert.equal(b.normalized, 0);
  }
});

test('11) NULL ile 0 KESİNLİKLE farklı sonuç üretir', () => {
  const sifirKomisyon = puanla({ commissionRate: 0, epcCents: 200 });
  const bilinmeyenKomisyon = puanla({ commissionRate: null, epcCents: 200 });

  // Aynı EPC, tek fark komisyonun bilinip bilinmemesi.
  assert.equal(sifirKomisyon.applicableWeight, SCORE_WEIGHTS.commission + SCORE_WEIGHTS.epc);
  assert.equal(bilinmeyenKomisyon.applicableWeight, SCORE_WEIGHTS.epc);

  assert.equal(sifirKomisyon.score, 44.44, '0 komisyon puanı AŞAĞI çeker');
  assert.equal(bilinmeyenKomisyon.score, 100, 'bilinmeyen komisyon puanı ETKİLEMEZ');

  assert.notEqual(
    sifirKomisyon.score,
    bilinmeyenKomisyon.score,
    'ikisi aynı çıkarsa bilinmeyen kötü ilan edilmiş demektir',
  );
});

// ===========================================================================
// 12 — BELİRLENİMCİLİK
// ===========================================================================
test('12) aynı girdi her zaman aynı skoru üretir', () => {
  const girdi: ScoreInput = {
    ...bos(),
    commissionRate: 0.073,
    epcCents: 137,
    aovCents: 8_642,
    cookieWindowDays: 45,
    feedAvailable: true,
    productCount: 12_345,
    marketCode: 'US',
    countryCode: 'US',
    deeplinkSupported: true,
    applicationSupported: false,
    lastVerifiedAt: gunOnce(7),
  };

  const ilk = scoreProgram(girdi, { now: SIMDI, targetMarkets: ['US'] });

  for (let i = 0; i < 200; i += 1) {
    const tekrar = scoreProgram({ ...girdi }, { now: new Date(SIMDI), targetMarkets: ['US'] });
    assert.equal(tekrar.score, ilk.score);
    assert.deepEqual(tekrar.breakdown, ilk.breakdown);
  }
});

test('12b) skor gizli bir saate bağlı değil — "now" zorunlu ve etkisi görünür', () => {
  const girdi = { ...bos(), lastVerifiedAt: gunOnce(10) };

  const bugun = scoreProgram(girdi, { now: SIMDI });
  const onGunSonra = scoreProgram(girdi, {
    now: new Date(SIMDI.getTime() + 10 * 86_400_000),
  });

  assert.equal(bugun.score, 66.67); // 1 - 10/30
  assert.equal(onGunSonra.score, 33.33); // 1 - 20/30
});

// ===========================================================================
// 13-14 — AĞ KİMLİĞİ SKORA GİRMEZ
// ===========================================================================
test('13) farklı ağ + aynı program kimliği: puanlama ağ-bağımsız', () => {
  // Puanlayıcı ağ ya da program kimliği ALMAZ; alsaydı bir ağ diğerine
  // yapısal olarak üstün olurdu. Sözleşmenin kendisi bunu kanıtlıyor.
  const girdiAnahtarlari = Object.keys(bos());
  assert.ok(!girdiAnahtarlari.includes('network'), 'ScoreInput ağ taşımamalı');
  assert.ok(
    !girdiAnahtarlari.some((k) => k.toLowerCase().includes('programid')),
    'ScoreInput program kimliği taşımamalı',
  );

  const olculer = { commissionRate: 0.12, feedAvailable: true, cookieWindowDays: 30 };
  const awinGibi = puanla(olculer);
  const digerAgGibi = puanla(olculer);

  assert.equal(awinGibi.score, digerAgGibi.score, 'aynı ölçüler aynı puanı almalı');
});

test('14) aynı program iki kez puanlanınca ikinci sonuç birinciden farksız', () => {
  const girdi = { ...bos(), commissionRate: 0.15, epcCents: 90, feedAvailable: false };

  const birinci = scoreProgram(girdi, { now: SIMDI });
  const ikinci = scoreProgram(girdi, { now: SIMDI });

  assert.deepEqual(ikinci, birinci, 'puanlama biriktirmiyor — saf fonksiyon');
});

// ===========================================================================
// 15-17 — KAPALI BAŞARISIZ: NaN / Infinity / TAŞMA
// ===========================================================================
test('15) NaN skor üretmez, hata fırlatır', () => {
  const alanlar: (keyof ScoreInput)[] = [
    'commissionRate',
    'epcCents',
    'aovCents',
    'cookieWindowDays',
    'productCount',
  ];

  for (const alan of alanlar) {
    assert.throws(
      () => puanla({ [alan]: Number.NaN } as Partial<ScoreInput>),
      ScoreError,
      `${alan}: NaN sessizce geçmemeli`,
    );
  }

  assert.throws(() => puanla({ lastVerifiedAt: 'gecersiz-tarih' }), ScoreError);
  assert.throws(
    () => scoreProgram(bos(), { now: new Date('gecersiz') }),
    ScoreError,
    'geçersiz "now" skoru sessizce bozmamalı',
  );
});

test('16) Infinity skor üretmez, hata fırlatır', () => {
  for (const deger of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => puanla({ commissionRate: deger }), ScoreError);
    assert.throws(() => puanla({ epcCents: deger }), ScoreError);
    assert.throws(() => puanla({ productCount: deger }), ScoreError);
  }
});

test('17) taşma: devasa değerler tavanla kırpılır, skor sonlu kalır', () => {
  const r = puanla({
    commissionRate: Number.MAX_VALUE,
    epcCents: Number.MAX_SAFE_INTEGER,
    aovCents: Number.MAX_SAFE_INTEGER,
    cookieWindowDays: Number.MAX_SAFE_INTEGER,
    productCount: Number.MAX_SAFE_INTEGER,
  });

  assert.ok(Number.isFinite(r.score!), 'taşma NaN/Infinity üretmemeli');
  assert.equal(r.score, 100);

  // Negatif girdi bir ölçüm hatasıdır; sessizce 0'a çevirmek onu gizlerdi.
  assert.throws(() => puanla({ commissionRate: -0.5 }), ScoreError);
  assert.throws(() => puanla({ epcCents: -1 }), ScoreError);
  assert.throws(() => puanla({ cookieWindowDays: -1 }), ScoreError);
  assert.throws(() => puanla({ productCount: -1 }), ScoreError);
  assert.throws(() => puanla({ aovCents: -1 }), ScoreError);
});

// ===========================================================================
// 18 — SKOR SINIRLARI
// ===========================================================================
test('18) skor hiçbir girdi bileşiminde 0-100 dışına çıkmaz', () => {
  const degerler = [null, 0, 1, -0, 0.5, 1_000, Number.MAX_SAFE_INTEGER];
  let sayac = 0;

  for (const komisyon of degerler) {
    for (const epc of degerler) {
      for (const urun of degerler) {
        for (const feed of [null, true, false]) {
          for (const cerez of degerler) {
            const r = puanla({
              commissionRate: komisyon,
              epcCents: epc,
              productCount: urun,
              feedAvailable: feed,
              cookieWindowDays: cerez,
            });
            sayac += 1;

            if (r.score === null) {
              assert.equal(r.applicableWeight, 0, 'NULL skor yalnız hiçbir şey bilinmiyorken');
              continue;
            }
            assert.ok(Number.isFinite(r.score), 'skor sonlu olmalı');
            assert.ok(r.score >= 0 && r.score <= 100, `skor sınır dışı: ${r.score}`);
          }
        }
      }
    }
  }

  assert.equal(sayac, degerler.length ** 4 * 3);
});

test('18b) ağırlık toplamı 100 — tavan sözleşmesinin dayanağı', () => {
  const toplam = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(toplam, 100);
  assert.equal(SCORE_COMPONENTS.length, Object.keys(SCORE_WEIGHTS).length);
});

// ===========================================================================
// 19 — DÖKÜM TOPLAMI HESABI AÇIKLIYOR
// ===========================================================================
test('19) döküm toplamı skorun kendisini yeniden üretir', () => {
  const r = puanla(
    {
      commissionRate: 0.08,
      epcCents: 160,
      aovCents: 4_000,
      cookieWindowDays: 68,
      feedAvailable: true,
      productCount: 23,
      marketCode: 'US',
      deeplinkSupported: true,
      applicationSupported: false,
      lastVerifiedAt: gunOnce(3),
    },
    ['US'],
  );

  const katkiToplami = r.breakdown.reduce((s, b) => s + b.contribution, 0);
  const paydaToplami = r.breakdown.filter((b) => b.applicable).reduce((s, b) => s + b.weight, 0);

  assert.equal(katkiToplami, r.earnedWeight);
  assert.equal(paydaToplami, r.applicableWeight);
  assert.equal(r.score, Math.round((r.earnedWeight / r.applicableWeight) * 100 * 100) / 100);

  // Her satır kendi içinde tutarlı: katkı = ağırlık × normalize.
  for (const b of r.breakdown) {
    assert.equal(b.weight, SCORE_WEIGHTS[b.component]);
    assert.equal(b.contribution, b.applicable ? b.weight * b.normalized! : 0);
    if (b.applicable) {
      assert.ok(b.normalized! >= 0 && b.normalized! <= 1, `${b.component}: normalize 0-1 dışında`);
    }
  }

  // Döküm her bileşeni tam bir kez taşır — eksik satır hesabı denetlenemez kılar.
  assert.deepEqual(
    r.breakdown.map((b) => b.component),
    SCORE_COMPONENTS,
  );
});

// ===========================================================================
// 20-21 — DURUM KORUMASI
// ===========================================================================
test('20) puanlama application_state gibi bir alanı ne okur ne yazar', () => {
  // Puanlayıcının sözleşmesinde onboarding durumu YOK: olmayan alanı
  // değiştiremez. Hem girdi hem çıktı tarafı kontrol ediliyor.
  assert.ok(!Object.keys(bos()).includes('application_state'));
  assert.ok(!Object.keys(bos()).includes('applicationState'));

  const r = puanla({ commissionRate: 0.1 });
  const cikti = new Set(Object.keys(r));
  for (const yasak of ['application_state', 'applicationState', 'status', 'state']) {
    assert.ok(!cikti.has(yasak), `çıktı ${yasak} taşımamalı`);
  }
});

test('21) puanlama merchant_id ya da başka bir kimliği taşımaz ve girdiyi DEĞİŞTİRMEZ', () => {
  const girdi: ScoreInput = { ...bos(), commissionRate: 0.1, feedAvailable: true };
  const kopya = { ...girdi };

  // Donmuş nesne: fonksiyon yazmaya kalksa strict modda hata fırlardı.
  Object.freeze(girdi);
  const r = scoreProgram(girdi, { now: SIMDI });

  assert.deepEqual(girdi, kopya, 'girdi nesnesi değişmemeli');
  // 25×0.5 + 15×1 = 27.5, payda 40 → 68.75. Donmuş girdi hesabı bozmuyor.
  assert.equal(r.score, 68.75);

  for (const yasak of ['merchant_id', 'merchantId', 'id', 'network', 'network_program_id']) {
    assert.ok(!Object.keys(bos()).includes(yasak), `ScoreInput ${yasak} taşımamalı`);
    assert.ok(!Object.keys(r).includes(yasak), `ScoreResult ${yasak} taşımamalı`);
  }
});

// ===========================================================================
// 22 — GÜVENLİK REGRESYONU
// ===========================================================================
test('22a) puanlama HİÇBİR ağ çağrısı yapmaz', () => {
  const gercekFetch = globalThis.fetch;
  let cagrildi = false;
  // Kasten bozuk gövde: çağrılırsa hem bayrak kalkar hem test düşer.
  globalThis.fetch = (() => {
    cagrildi = true;
    throw new Error('puanlama ag cagrisi yapti');
  }) as unknown as typeof fetch;

  try {
    puanla({ commissionRate: 0.1, lastVerifiedAt: gunOnce(1), marketCode: 'US' }, ['US']);
  } finally {
    globalThis.fetch = gercekFetch;
  }

  assert.equal(cagrildi, false, 'saf puanlayıcı SSRF yüzeyi açamaz');
});

test('22b) döküm yalnız bilinen bileşenleri ve verilen ham değerleri taşır — sızıntı yok', () => {
  const gizliGibi = 'sk_live_ORNEK_SIR_DEGERI';

  const r = puanla({
    commissionRate: 0.1,
    // Ham değer olarak sızabilecek tek serbest metin alanları.
    marketCode: gizliGibi,
    lastVerifiedAt: gunOnce(1),
  });

  const dokum = JSON.stringify(r.breakdown);

  // Ham değer yalnız ait olduğu bileşende görünür; başka bileşene taşmaz.
  const pazar = r.breakdown.find((b) => b.component === 'marketFit')!;
  assert.equal(pazar.raw, gizliGibi);
  assert.equal(
    (dokum.match(new RegExp(gizliGibi, 'g')) ?? []).length,
    1,
    'ham değer birden çok bileşene kopyalanmamalı',
  );

  // Döküm satırları SABİT bir alan kümesine kapalı: yeni bir alan sessizce
  // eklenip içine veri sızdırılamaz.
  for (const b of r.breakdown) {
    assert.deepEqual(Object.keys(b).sort(), [
      'applicable',
      'component',
      'contribution',
      'normalized',
      'raw',
      'weight',
    ]);
    assert.ok(SCORE_COMPONENTS.includes(b.component));
  }
});

test('22c) bilinmeyen bileşen dökümde de bilinmeyen kalır — uydurulmuş değer yok', () => {
  const r = puanla({ commissionRate: 0.1 });

  for (const b of r.breakdown) {
    if (b.component === 'commission') continue;
    assert.equal(b.applicable, false);
    assert.equal(b.normalized, null, `${b.component}: bilinmeyen için 0 UYDURULMAMALI`);
    assert.equal(b.raw, null);
  }
});

// ===========================================================================
// EK — PAZAR UYUMU: KISMİ BİLGİ TAM PUAN DEĞİL
// ===========================================================================
test('pazar uyumu: hedef dışı 0, hedef içi 1, yalnız ülke bilinirse 0.5', () => {
  const hedefte = puanla({ marketCode: 'US' }, ['US', 'TR']);
  const hedefDisi = puanla({ marketCode: 'DE' }, ['US', 'TR']);
  const yalnizUlke = puanla({ countryCode: 'US' });
  const hedefYok = puanla({ marketCode: 'DE' });

  assert.equal(hedefte.score, 100);
  assert.equal(hedefDisi.score, 0);
  assert.equal(yalnizUlke.score, 50, 'ülke biliniyor ama pazar eşlemesi yok: kısmi bilgi');
  assert.equal(hedefYok.score, 100, 'hedef listesi verilmezse pazarın bilinmesi yeter');
});
