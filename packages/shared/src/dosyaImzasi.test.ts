import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  IMZA_ICIN_GEREKEN_BAYT,
  bicimiCoz,
  yuklemeTuruGecerli,
} from './dosyaImzasi.js';

/* =========================================================================
 * §50 — YÜKLENEN DOSYANIN GERÇEK TÜRÜ
 * -------------------------------------------------------------------------
 * Kovaladığımız tehlike tek: BEYANA GÜVENMEK. `File.type` istemciden gelir
 * ve `curl -F 'file=@x.html;type=application/pdf'` yazan biri için o alan
 * ne derse odur.
 *
 * Testler bu yüzden "geçerli PDF geçiyor mu"dan çok, YANLIŞ BEYANIN
 * yakalanıp yakalanmadığına bakıyor.
 * ========================================================================= */

/** Baytları okunaklı yazmak için küçük yardımcı. */
function bayt(...n: number[]): Uint8Array {
  return Uint8Array.from(n);
}

const PDF = bayt(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
const PNG = bayt(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const JPEG = bayt(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);

test('gercek imzalar dogru bicime cozuluyor', () => {
  assert.equal(bicimiCoz(PDF), 'application/pdf');
  assert.equal(bicimiCoz(PNG), 'image/png');
  assert.equal(bicimiCoz(JPEG), 'image/jpeg');
});

// ASIL SALDIRI: HTML dosyasini PDF diye beyan etmek.
test('PDF diye beyan edilen HTML REDDEDILIYOR', () => {
  const html = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>');

  assert.equal(bicimiCoz(html), null, 'HTML taninan bir bicim olmamali');
  assert.equal(
    yuklemeTuruGecerli('application/pdf', html),
    false,
    'beyan PDF olsa da baytlar HTML: reddedilmeli',
  );
});

// Beyan ile gercek AYRISIRSA reddedilmeli: depolanan contentType beyandan
// geliyor, yani ayrisma denetimi atlatmanin ta kendisi olurdu.
test('gercek bir PNG, PDF diye beyan edilirse reddediliyor', () => {
  assert.equal(bicimiCoz(PNG), 'image/png');
  assert.equal(yuklemeTuruGecerli('application/pdf', PNG), false);
  assert.equal(yuklemeTuruGecerli('image/png', PNG), true);
});

test('taninmayan bicim null doner (allowlist, blocklist degil)', () => {
  const gzip = bayt(0x1f, 0x8b, 0x08, 0x00);
  const elf = bayt(0x7f, 0x45, 0x4c, 0x46);
  const bos = bayt();

  assert.equal(bicimiCoz(gzip), null);
  assert.equal(bicimiCoz(elf), null);
  assert.equal(bicimiCoz(bos), null);
  assert.equal(yuklemeTuruGecerli('image/png', bos), false);
});

// PNG imzasinin sekiz baytinin TAMAMI denetlenmeli. Ilk dort bayt
// (89 P N G) ayni kalip sonraki satir-sonu baytlari bozulmussa dosya
// gecerli bir PNG degildir -- imzanin var olus sebebi tam olarak budur.
test('PNG imzasinin tamami denetleniyor, ilk dort bayt yetmiyor', () => {
  const yarim = bayt(0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00);
  assert.equal(bicimiCoz(yarim), null);
});

// Imza sinirinda kesilen dosya "gecerli" sayilmamali.
test('imzadan kisa govde eslesme sayilmiyor', () => {
  assert.equal(bicimiCoz(bayt(0x25, 0x50)), null, 'yarim PDF imzasi');
  assert.equal(bicimiCoz(bayt(0xff, 0xd8)), null, 'yarim JPEG imzasi');
});

test('okunmasi gereken bayt sayisi en uzun imzayi kapsiyor', () => {
  assert.equal(IMZA_ICIN_GEREKEN_BAYT, 8, 'en uzun imza PNG (8 bayt)');
});
