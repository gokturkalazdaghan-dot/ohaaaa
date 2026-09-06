import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

import { classifyPayload, decodeFeedPayload } from './payload.js';
import { IngestError } from '../errors.js';

/* =========================================================================
 * AŞAMA 10 — FEED GÖVDE BİÇİMİ
 * -------------------------------------------------------------------------
 * Kovalanan tehlikeler:
 *   • `urunler.csv.gz` dosyasının metin sanılması -> "başarılı, 0 ürün"
 *   • sıkıştırma bombası: 1 MB gzip 10 GB'a açılır
 *   • arşiv açmanın getirdiği dizin geçişi ve çok girdili bomba yüzeyi
 * ========================================================================= */

const metin = (s: string) => new TextEncoder().encode(s);

test('1) düz metin olduğu gibi çözülüyor', () => {
  const govde = 'id,baslik,fiyat\n1,Telefon,1000\n';
  assert.equal(classifyPayload(metin(govde)), 'plain');
  assert.equal(decodeFeedPayload(metin(govde)), govde);
});

test('2) GZIP DOSYA açılıyor — fetch bunu açmaz', () => {
  // `Content-Encoding: gzip` taşıma katmanıdır ve fetch onu açar. Ama
  // `urunler.csv.gz` bir DOSYADIR: açılmazsa CSV ayrıştırıcısı ikili
  // veriyi metin sanar, hata düşmez ve tur "0 ürün" der.
  const govde = 'id,baslik\n1,Telefon\n';
  const sikistirilmis = new Uint8Array(gzipSync(Buffer.from(govde)));

  assert.equal(classifyPayload(sikistirilmis), 'gzip');
  assert.equal(decodeFeedPayload(sikistirilmis), govde);
});

test('3) biçim SİHİRLİ BAYTTAN okunuyor, Content-Type dan değil', () => {
  // Sunucular bu başlığı sık sık yanlış gönderir; baytlar yalan söylemez.
  const sikistirilmis = new Uint8Array(gzipSync(Buffer.from('merhaba')));
  // Hiçbir content-type verilmiyor ve yine de doğru çözülüyor.
  assert.equal(decodeFeedPayload(sikistirilmis), 'merhaba');
});

test('4) SIKIŞTIRMA BOMBASI tavanda kesiliyor', () => {
  // 10 MB sıfır, gzip'te birkaç KB. Tavan 1 KB: açma tamamlanmadan durmalı.
  const bomba = new Uint8Array(gzipSync(Buffer.alloc(10 * 1024 * 1024, 0)));
  assert.ok(bomba.length < 64 * 1024, 'sıkıştırılmış hâli küçük olmalı');

  assert.throws(
    () => decodeFeedPayload(bomba, { maxDecompressedBytes: 1024 }),
    (e: unknown) =>
      e instanceof IngestError && e.errorClass === 'SECURITY_ERROR' && e.permanent,
  );
});

test('5) tavanın altındaki gzip geçiyor — kapatma fazla kapatmamış', () => {
  const govde = 'x'.repeat(5000);
  const g = new Uint8Array(gzipSync(Buffer.from(govde)));
  assert.equal(decodeFeedPayload(g, { maxDecompressedBytes: 10_000 }), govde);
});

test('6) ARŞİVLER kapalı başarısız: zip, 7z, rar, tar', () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  const sevenz = new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0]);
  const rar = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0, 0]);

  const tar = new Uint8Array(512);
  for (const [i, b] of [0x75, 0x73, 0x74, 0x61, 0x72].entries()) tar[257 + i] = b;

  assert.equal(classifyPayload(zip), 'zip');
  assert.equal(classifyPayload(sevenz), 'other_archive');
  assert.equal(classifyPayload(rar), 'other_archive');
  assert.equal(classifyPayload(tar), 'other_archive');

  for (const a of [zip, sevenz, rar, tar]) {
    assert.throws(
      () => decodeFeedPayload(a),
      (e: unknown) =>
        e instanceof IngestError && e.errorClass === 'SECURITY_ERROR' && e.permanent,
      'arşiv sessizce yanlış ayrıştırılmak yerine AÇIKÇA reddedilmeli',
    );
  }
});

test('7) bozuk gzip KALICI hata — yeniden denemek kaynağı yorar', () => {
  const bozuk = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0xff]);

  assert.throws(
    () => decodeFeedPayload(bozuk),
    (e: unknown) => e instanceof IngestError && e.permanent,
  );
});

test('8) hata mesajı adresi MASKELENMİŞ hâliyle taşıyor', () => {
  // Adres jetonu sorgu dizisinde taşıyabilir; ham hâli günlüğe ve
  // `sources.last_error`a kopyalanırdı.
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  try {
    decodeFeedPayload(zip, { url: 'https://ornek.example/feed?key=***' });
    assert.fail('reddedilmeliydi');
  } catch (e) {
    assert.ok(e instanceof IngestError);
    assert.ok(!e.message.includes('gizli'));
    assert.match(e.message, /ornek\.example/);
  }
});

test('9) boş gövde düz metin sayılıyor', () => {
  assert.equal(classifyPayload(new Uint8Array(0)), 'plain');
  assert.equal(decodeFeedPayload(new Uint8Array(0)), '');
});
