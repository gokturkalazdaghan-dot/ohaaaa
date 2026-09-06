import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APPLICATION_STATES,
  APPLICATION_TRANSITIONS,
  canTransition,
  isApprovalFinal,
} from './applicationTransitions.js';
import type { ApplicationState } from './types.js';

/* =========================================================================
 * BAŞVURU DURUM GEÇİŞ TABLOSU
 * -------------------------------------------------------------------------
 * Kovalanan tehlike tek ve sessiz: onaylı bir programın otomatik bir turla
 * geri çekilmesi. O program yeniden başvuru kuyruğuna girer, merchant bağı
 * anlamsızlaşır ve çalışan gelir hattı kopar -- hiçbir hata düşmeden.
 * ========================================================================= */

test('1) ONAY TEK YÖNLÜ: APPROVED yalnızca REJECTED a gidebilir', () => {
  assert.deepEqual(APPLICATION_TRANSITIONS.APPROVED, ['REJECTED']);

  for (const hedef of APPLICATION_STATES) {
    if (hedef === 'APPROVED' || hedef === 'REJECTED') continue;
    assert.equal(
      canTransition('APPROVED', hedef),
      false,
      `APPROVED -> ${hedef} serbest kalmış: çalışan gelir hattı koparılabilirdi`,
    );
  }

  assert.equal(canTransition('APPROVED', 'REJECTED'), true, 'ağ onayı geri alabilmeli');
  assert.equal(isApprovalFinal('APPROVED'), true);
});

test('2) açıkça istenen iki yasak: APPROVED -> DISCOVERED ve APPROVED -> PENDING', () => {
  assert.equal(canTransition('APPROVED', 'DISCOVERED'), false);
  assert.equal(canTransition('APPROVED', 'PENDING'), false);
  assert.equal(canTransition('APPROVED', 'APPLIED'), false);
});

test('3) aynı duruma geçiş serbest — "değişiklik yok" bir geçiş değildir', () => {
  // Yoklama turları çoğu zaman aynı durumu görür; onu geçersiz saymak her
  // turu hata üretir hâle getirirdi.
  for (const durum of APPLICATION_STATES) {
    assert.equal(canTransition(durum, durum), true, `${durum} -> ${durum} serbest olmalı`);
  }
});

test('4) tablo İZİN LİSTESİ: her durum tanımlı, kendini içermiyor', () => {
  assert.equal(Object.keys(APPLICATION_TRANSITIONS).length, APPLICATION_STATES.length);

  for (const durum of APPLICATION_STATES) {
    const izinli = APPLICATION_TRANSITIONS[durum];
    assert.ok(izinli, `${durum} için izin listesi yok — varsayılan REDDET olmalı ama tanımsız`);
    assert.ok(
      !izinli.includes(durum),
      `${durum} kendini içeriyor; aynı duruma geçiş canTransition ile ele alınıyor`,
    );

    for (const hedef of izinli) {
      assert.ok(
        (APPLICATION_STATES as readonly string[]).includes(hedef),
        `${durum} -> ${hedef}: tanımsız durum`,
      );
    }
  }
});

test('5) geriye "hiç görülmemiş"e dönüş yok', () => {
  // DISCOVERED başlangıç durumu. Başvurusu gönderilmiş ya da sonuçlanmış
  // bir programı oraya çekmek geçmişi silmek olurdu.
  for (const durum of ['APPLIED', 'PENDING', 'APPROVED', 'REJECTED'] as ApplicationState[]) {
    assert.equal(canTransition(durum, 'DISCOVERED'), false, `${durum} -> DISCOVERED yasak olmalı`);
  }
});

test('6) UNAVAILABLE ve NOT_IMPLEMENTED ÇIKMAZ SOKAK DEĞİL', () => {
  // Sözleşme yarın doğrulanabilir, eksik kod yarın yazılabilir. Bu iki
  // durum programı sonsuza kadar gömseydi, doğrulanan her sözleşme elle
  // temizlik gerektirirdi.
  for (const durum of ['UNAVAILABLE', 'NOT_IMPLEMENTED'] as ApplicationState[]) {
    assert.equal(canTransition(durum, 'APPLICATION_READY'), true);
    assert.equal(canTransition(durum, 'DISCOVERED'), true);
    assert.ok(APPLICATION_TRANSITIONS[durum].length >= 8, `${durum} çıkmaz sokak olmamalı`);
  }
});

test('7) ret kalıcı değil ama geçmiş silinmiyor', () => {
  assert.equal(canTransition('REJECTED', 'APPLICATION_READY'), true, 'şartlar değişince yeniden başvurulabilir');
  assert.equal(canTransition('REJECTED', 'APPLIED'), true);
  assert.equal(canTransition('REJECTED', 'DISCOVERED'), false, 'geçmiş silinemez');
});

test('8) MANUAL_REQUIRED bir hata değil: operatör sonucu girebilir', () => {
  assert.equal(canTransition('MANUAL_REQUIRED', 'APPROVED'), true);
  assert.equal(canTransition('MANUAL_REQUIRED', 'REJECTED'), true);
  assert.equal(canTransition('MANUAL_REQUIRED', 'APPLIED'), true);
});

test('9) tam matris sayımı — tablonun sessizce genişlemesi testi düşürür', () => {
  const toplam = APPLICATION_STATES.reduce(
    (s, d) => s + APPLICATION_TRANSITIONS[d].length,
    0,
  );
  assert.equal(toplam, 65, 'izinli geçiş sayısı değiştiyse bu bilinçli olmalı');

  // 10 durum × 10 hedef = 100 çift; 65 izinli + 10 kendine + 25 yasak.
  let yasak = 0;
  for (const a of APPLICATION_STATES) {
    for (const b of APPLICATION_STATES) {
      if (!canTransition(a, b)) yasak += 1;
    }
  }
  assert.equal(yasak, 25);
});
