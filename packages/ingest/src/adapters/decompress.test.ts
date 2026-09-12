/**
 * Sıkıştırma açma testleri.
 *
 * En önemlisi "sıkıştırma bombası durdurulur": indirilen baytı sınırlamak
 * sıkıştırılmış bir gövdede yeterli DEĞİLDİR ve bu boşluk yalnızca burada
 * kapatılıyor.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { gzipSync, deflateSync } from 'node:zlib';

import { detectCompression, decompressToText } from './decompress.js';
import { IngestError } from '../errors.js';

const SINIR = { maxBytes: 8 * 1024 * 1024 };

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test('sıkıştırılmamış gövde olduğu gibi metne çevrilir', () => {
  const bytes = enc('id,title\n1,Kulaklık');
  assert.equal(detectCompression(bytes), 'none');
  assert.equal(decompressToText(bytes, SINIR), 'id,title\n1,Kulaklık');
});

test('gzip gövde sihirli bayttan tanınır ve açılır', () => {
  const ham = 'aw_product_id,product_name\n99,Türkçe ürün adı — ğüşıöç';
  const bytes = new Uint8Array(gzipSync(Buffer.from(ham, 'utf8')));

  assert.equal(detectCompression(bytes), 'gzip');
  assert.equal(decompressToText(bytes, SINIR), ham);
});

test('zlib/deflate gövde açılır', () => {
  const ham = 'id,price\n1,10.50';
  const bytes = new Uint8Array(deflateSync(Buffer.from(ham, 'utf8')));

  assert.equal(detectCompression(bytes), 'zlib');
  assert.equal(decompressToText(bytes, SINIR), ham);
});

test('biçim İÇERİKTEN anlaşılır — content-type yanlış olsa bile', () => {
  /*
   * Gerçek arıza biçimi: aynı '.gz' adresi kimi sunucuda 'text/csv'
   * döner. Başlığa güvenen bir sezgi burada gzip'i düz metin sanıp
   * bozuk veri üretirdi.
   */
  const bytes = new Uint8Array(gzipSync(Buffer.from('id\n1', 'utf8')));
  assert.equal(detectCompression(bytes), 'gzip');
});

test('ZIP arşivi AÇILMAZ, kalıcı yapılandırma hatası verir', () => {
  // 'PK\x03\x04' — zip yerel dosya başlığı.
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  assert.equal(detectCompression(bytes), 'zip');

  assert.throws(
    () => decompressToText(bytes, SINIR),
    (error: unknown) => {
      assert.ok(error instanceof IngestError);
      assert.equal(error.errorClass, 'CONFIG_ERROR');
      // KALICI: aynı adres her denemede aynı zip'i döndürür.
      assert.equal(error.permanent, true);
      return true;
    },
  );
});

test('SIKIŞTIRMA BOMBASI: açılmış boyut sınırı aşarsa durdurulur', () => {
  /*
   * 4 MB sıfır baytı ~4 KB'a sıkışır. İndirilen bayt sınırı (64 MB) bunu
   * hiç görmez; yakalayan tek şey AÇMA SIRASINDAKİ sınırdır.
   */
  const sisik = Buffer.alloc(4 * 1024 * 1024, 0);
  const bytes = new Uint8Array(gzipSync(sisik));

  assert.ok(bytes.byteLength < 64 * 1024, 'sıkıştırılmış hâli küçük olmalı');

  assert.throws(
    () => decompressToText(bytes, { maxBytes: 64 * 1024 }),
    (error: unknown) => {
      assert.ok(error instanceof IngestError);
      assert.equal(error.errorClass, 'CONFIG_ERROR');
      assert.equal(error.permanent, true);
      assert.match(error.message, /bomba/i);
      return true;
    },
  );
});

test('bozuk gzip GEÇİCİ ayrıştırma hatası verir', () => {
  // Doğru sihirli bayt, bozuk gövde: sağlayıcının yarım yazdığı dosya.
  const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0xff, 0xff]);

  assert.throws(
    () => decompressToText(bytes, SINIR),
    (error: unknown) => {
      assert.ok(error instanceof IngestError);
      assert.equal(error.errorClass, 'PARSER_ERROR');
      // GEÇİCİ: bir sonraki yayında düzelebilir.
      assert.equal(error.permanent, false);
      return true;
    },
  );
});

test('boş gövde sıkıştırılmamış sayılır', () => {
  assert.equal(detectCompression(new Uint8Array(0)), 'none');
  assert.equal(decompressToText(new Uint8Array(0), SINIR), '');
});
