import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { classifyIngestError } from '../errors.js';
import {
  ResponseTooLargeError,
  TooManyRedirectsError,
  UnsafeUrlError,
  assertFetchable,
  ipYasakSebebi,
} from './guard.js';

/**
 * ADRES KAPISI TESTLERİ.
 *
 * İki yönlü sınanıyor. Yalnızca "şunu reddediyor" demek yetmez: her adresi
 * reddeden bir kapı da o testleri geçerdi ve alım hattını tamamen
 * öldürürdü. Bu yüzden her reddin yanında bir KABUL iddiası var.
 */

/** Ad çözümünü test içinde belirlemek için sahte çözücü üreticisi. */
function cozucu(esleme: Record<string, string[]>) {
  return async (host: string) => {
    const sonuc = esleme[host];
    if (!sonuc) throw new Error(`cozulemedi: ${host}`);
    return sonuc;
  };
}

const GENEL = cozucu({ 'feed.ornek.test': ['93.184.216.34'] });

// ---------------------------------------------------------------------------
// IP blokları — doğrudan yazılmış adresler
// ---------------------------------------------------------------------------

test('özel IPv4 blokları reddedilir', () => {
  for (const adres of ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1']) {
    assert.notEqual(ipYasakSebebi(adres), null, `${adres} reddedilmeliydi`);
  }
});

test('geri döngü (loopback) reddedilir', () => {
  assert.notEqual(ipYasakSebebi('127.0.0.1'), null);
  assert.notEqual(ipYasakSebebi('127.1.2.3'), null);
  assert.notEqual(ipYasakSebebi('::1'), null);
});

test('link-local ve bulut metadata adresi reddedilir', () => {
  /*
   * 169.254.169.254 bu listedeki en önemli tek adres: AWS/GCP/Azure kimlik
   * ucu. Bir feed adresi buraya yönlendirilirse yanıt hata kaydına düşerek
   * dışarı sızabilir.
   */
  assert.notEqual(ipYasakSebebi('169.254.169.254'), null);
  assert.notEqual(ipYasakSebebi('169.254.0.1'), null);
  assert.notEqual(ipYasakSebebi('fe80::1'), null);
});

test('operatör NAT, çoklu yayın ve ayrılmış bloklar reddedilir', () => {
  assert.notEqual(ipYasakSebebi('100.64.0.1'), null, 'CGNAT');
  assert.notEqual(ipYasakSebebi('224.0.0.1'), null, 'multicast');
  assert.notEqual(ipYasakSebebi('255.255.255.255'), null, 'ayrılmış');
  assert.notEqual(ipYasakSebebi('0.0.0.0'), null, 'bu ağ');
});

test('IPv6 içine GÖMÜLÜ IPv4 de çözülür', () => {
  /*
   * Bu, kapıyı tamamen anlamsız kılabilecek kaçak. `::ffff:169.254.169.254`
   * bir IPv6 adresidir ama gerçekte link-local IPv4'e gider; yalnızca IPv6
   * öneklerine bakan bir denetim onu geçirirdi.
   */
  assert.notEqual(ipYasakSebebi('::ffff:169.254.169.254'), null, 'IPv4-mapped metadata');
  assert.notEqual(ipYasakSebebi('::ffff:127.0.0.1'), null, 'IPv4-mapped loopback');
  assert.notEqual(ipYasakSebebi('::ffff:10.0.0.1'), null, 'IPv4-mapped özel ağ');
});

test('IPv6 benzersiz yerel ve çoklu yayın reddedilir', () => {
  assert.notEqual(ipYasakSebebi('fc00::1'), null);
  assert.notEqual(ipYasakSebebi('fd12:3456::1'), null);
  assert.notEqual(ipYasakSebebi('ff02::1'), null);
});

test('GENEL adresler KABUL EDİLİR — kapı her şeyi reddetmiyor', () => {
  /*
   * Ters yön kanıtı. Bu iddia olmadan, "return 'yasak'" yazan bozuk bir
   * kapı yukarıdaki testlerin hepsini geçerdi.
   */
  assert.equal(ipYasakSebebi('93.184.216.34'), null, 'example.com');
  assert.equal(ipYasakSebebi('1.1.1.1'), null, 'Cloudflare');
  assert.equal(ipYasakSebebi('2606:4700:4700::1111'), null, 'genel IPv6');
});

// ---------------------------------------------------------------------------
// assertFetchable — uçtan uca
// ---------------------------------------------------------------------------

test('genel HTTPS adresi geçer', async () => {
  await assertFetchable('https://feed.ornek.test/urunler.csv', { resolveHost: GENEL });
});

test('HTTP de geçer — zorunlu HTTPS bu fazın kapsamı değil', async () => {
  await assertFetchable('http://feed.ornek.test/urunler.csv', { resolveHost: GENEL });
});

test('HTTP/HTTPS dışındaki şemalar reddedilir', async () => {
  for (const adres of [
    'file:///etc/passwd',
    'ftp://ornek.test/feed.csv',
    'gopher://ornek.test/1',
    'data:text/csv,a%2Cb',
  ]) {
    await assert.rejects(
      () => assertFetchable(adres, { resolveHost: GENEL }),
      (e: unknown) => e instanceof UnsafeUrlError,
      `${adres} reddedilmeliydi`,
    );
  }
});

test('özel adrese ÇÖZÜLEN bir ad reddedilir', async () => {
  /*
   * Saldırının pratikteki hâli: ad genel görünür, çözümü özeldir. Yalnızca
   * dizgeye bakan bir denetim bunu göremez.
   */
  const icAg = cozucu({ 'feed.ornek.test': ['10.0.0.7'] });
  await assert.rejects(
    () => assertFetchable('https://feed.ornek.test/f.csv', { resolveHost: icAg }),
    (e: unknown) => e instanceof UnsafeUrlError,
  );
});

test('ÇIKAN ADRESLERİN HEPSİ denetlenir, yalnızca ilki değil', async () => {
  const karisik = cozucu({ 'feed.ornek.test': ['93.184.216.34', '169.254.169.254'] });
  await assert.rejects(
    () => assertFetchable('https://feed.ornek.test/f.csv', { resolveHost: karisik }),
    (e: unknown) => e instanceof UnsafeUrlError,
  );
});

test('çözülemeyen ad KAPALI sayılır (fail closed)', async () => {
  await assert.rejects(
    () => assertFetchable('https://yok.ornek.test/f.csv', { resolveHost: GENEL }),
    (e: unknown) => e instanceof UnsafeUrlError,
  );
});

test('metadata ana makine ADI, çözümünden bağımsız reddedilir', async () => {
  const yanlisCozum = cozucu({ 'metadata.google.internal': ['93.184.216.34'] });
  await assert.rejects(
    () => assertFetchable('http://metadata.google.internal/x', { resolveHost: yanlisCozum }),
    (e: unknown) => e instanceof UnsafeUrlError,
  );
});

test('doğrudan yazılmış özel IP için DNS cozumune hic cikilmaz', async () => {
  let cagrildi = false;
  const izleyen = async () => {
    cagrildi = true;
    return ['93.184.216.34'];
  };

  await assert.rejects(
    () => assertFetchable('http://169.254.169.254/latest/meta-data/', { resolveHost: izleyen }),
    (e: unknown) => e instanceof UnsafeUrlError,
  );
  assert.equal(cagrildi, false, 'IP zaten yazılıysa ad çözümü gereksizdir');
});

// ---------------------------------------------------------------------------
// Hata sınıflandırması
// ---------------------------------------------------------------------------

test('güvenlik hataları SECURITY_ERROR ve KALICI', () => {
  /*
   * KALICILIK BURADA ÖNEMLİ. Bir SSRF denemesini yeniden denemek sonucu
   * değiştirmez; kuyruğu meşgul eder ve kayıtları kirletir. Kuyruk bunu
   * `permanent` bayrağından öğreniyor.
   */
  for (const hata of [
    new UnsafeUrlError('özel ağ', 'http://10.0.0.1/f.csv'),
    new TooManyRedirectsError('https://a.test/f.csv', 5),
    new ResponseTooLargeError('https://a.test/f.csv', 1024),
  ]) {
    const sonuc = classifyIngestError(hata);
    assert.equal(sonuc.errorClass, 'SECURITY_ERROR', hata.name);
    assert.equal(sonuc.permanent, true, hata.name);
  }
});

test('güvenlik hatası mesajında adres MASKELENİR', () => {
  /*
   * Bu mesaj `ingest_runs.error` ve `sources.last_error` sütunlarına
   * yazılıyor. Sorgu dizesinde jeton taşıyan bir feed adresi maskesiz
   * yazılsaydı jetonu üç ayrı yere kopyalardı.
   */
  const hata = new UnsafeUrlError('özel ağ', 'https://feed.test/f.csv?api_key=gizli-jeton-123');
  assert.ok(!hata.message.includes('gizli-jeton-123'), 'jeton mesaja girmemeli');
});
