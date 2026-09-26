import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { parseCsv, truncateCsvRecords } from './csv.js';
import { parseJson } from './json.js';
import { parseXml } from './xml.js';

// --- CSV --------------------------------------------------------------------

test('CSV: tırnaklı alan içindeki virgül ve satır sonu korunur', () => {
  const csv = [
    'id,title,price',
    '1,"Kulaklık, kablosuz",1199.90',
    '2,"Çok satırlı\nbaşlık",99',
  ].join('\n');

  const { records } = parseCsv(csv);

  assert.equal(records.length, 2);
  assert.equal(records[0]?.title, 'Kulaklık, kablosuz');
  assert.equal(records[1]?.title, 'Çok satırlı\nbaşlık');
});

test('CSV: kaçırılmış tırnak ("") çözülür', () => {
  const { records } = parseCsv('id,title\n1,"15"" ekran"');
  assert.equal(records[0]?.title, '15" ekran');
});

test('CSV: noktalı virgül ayırıcı kendiliğinden bulunur', () => {
  // Türkiye'de Excel'den çıkan feed'lerin varsayılanı budur.
  const { records } = parseCsv('id;title;price\n1;Ürün;1.299,90');
  assert.equal(records[0]?.title, 'Ürün');
  assert.equal(records[0]?.price, '1.299,90');
});

test('CSV: sekme ayırıcı desteklenir', () => {
  const { records } = parseCsv('id\ttitle\n1\tÜrün');
  assert.equal(records[0]?.title, 'Ürün');
});

test('CSV: BOM ilk kolon adını bozmaz', () => {
  const { records } = parseCsv('﻿id,title\n1,Ürün');
  assert.equal(records[0]?.id, '1', 'BOM temizlenmeliydi');
});

test('CSV: kolon sayısı uyuşmayan satır atlanır ve raporlanır', () => {
  const { records, warnings } = parseCsv('id,title,price\n1,Ürün\n2,Ürün2,50');

  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, '2');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /Satır 2/);
});

test('CSV: CRLF ve son satırda eksik satır sonu', () => {
  const { records } = parseCsv('id,title\r\n1,A\r\n2,B');
  assert.equal(records.length, 2);
  assert.equal(records[1]?.title, 'B');
});

// --- XML --------------------------------------------------------------------

const GOOGLE_FEED = `<?xml version="1.0"?>
<rss xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <item>
      <g:id>SKU-1</g:id>
      <g:title><![CDATA[Kulaklık & Mikrofon]]></g:title>
      <g:price currency="TRY">1199.90</g:price>
      <g:link>https://magaza.example/p/1</g:link>
      <g:image_link>https://cdn.example/1a.jpg</g:image_link>
      <g:image_link>https://cdn.example/1b.jpg</g:image_link>
      <g:availability>in stock</g:availability>
    </item>
    <item>
      <g:id>SKU-2</g:id>
      <g:title>15&quot; Dizüstü</g:title>
      <g:price currency="TRY">21999.00</g:price>
      <g:link>https://magaza.example/p/2</g:link>
    </item>
  </channel>
</rss>`;

test('XML: item öğeleri ve ad alanı önekli alanlar okunur', () => {
  const { records } = parseXml(GOOGLE_FEED);

  assert.equal(records.length, 2);
  assert.equal(records[0]?.['g:id'], 'SKU-1');
  assert.equal(records[1]?.['g:link'], 'https://magaza.example/p/2');
});

test('XML: CDATA açılır ve varlıklar çözülür', () => {
  const { records } = parseXml(GOOGLE_FEED);

  assert.equal(records[0]?.['g:title'], 'Kulaklık & Mikrofon');
  assert.equal(records[1]?.['g:title'], '15" Dizüstü');
});

test('XML: &amp; en son çözülür (çift çözme hatası olmamalı)', () => {
  const { records } = parseXml(
    '<item><title>A &amp;lt; B</title></item><item><title>x</title></item>',
  );
  // "&amp;lt;" → "&lt;" olmalı, "<" DEĞİL.
  assert.equal(records[0]?.title, 'A &lt; B');
});

test('XML: tekrar eden etiketler | ile birleşir', () => {
  const { records } = parseXml(GOOGLE_FEED);
  assert.equal(
    records[0]?.['g:image_link'],
    'https://cdn.example/1a.jpg|https://cdn.example/1b.jpg',
  );
});

test('XML: öznitelikler etiket@ad anahtarıyla erişilebilir', () => {
  const { records } = parseXml(GOOGLE_FEED);
  assert.equal(records[0]?.['g:price@currency'], 'TRY');
});

test('XML: ürün öğesi yoksa boş sonuç ve uyarı döner', () => {
  const { records, warnings } = parseXml('<html><body>merhaba</body></html>');
  assert.equal(records.length, 0);
  assert.equal(warnings.length, 1);
});

// --- JSON -------------------------------------------------------------------

test('JSON: sarmalanmış ürün dizisi bulunur', () => {
  const { records } = parseJson(
    JSON.stringify({
      meta: { count: 2 },
      data: { items: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }] },
    }),
  );

  assert.equal(records.length, 2);
  assert.equal(records[1]?.title, 'B');
});

test('JSON: iç içe alanlar nokta yoluna düzleştirilir', () => {
  const { records } = parseJson(
    JSON.stringify([{ id: '1', pricing: { current: 129.9, list: 199 } }]),
  );

  assert.equal(records[0]?.['pricing.current'], '129.9');
  assert.equal(records[0]?.['pricing.list'], '199');
});

test('JSON: diziler | ile birleşir', () => {
  const { records } = parseJson(
    JSON.stringify([{ id: '1', images: ['a.jpg', 'b.jpg'] }]),
  );
  assert.equal(records[0]?.images, 'a.jpg|b.jpg');
});

test('JSON: bozuk gövde çökmez, uyarı döner', () => {
  const { records, warnings } = parseJson('{ bozuk');
  assert.equal(records.length, 0);
  assert.match(warnings[0]!, /ayrıştırılamadı/);
});

// ===========================================================================
// AYRIŞTIRMADAN ÖNCE KIRPMA — ölçülmüş bir OOM'un düzeltmesi
// ===========================================================================

test('truncateCsvRecords: tavanin altindaki metin degismez', () => {
  const metin = 'a,b\n1,2\n3,4';
  const sonuc = truncateCsvRecords(metin, 50);
  assert.equal(sonuc.text, metin);
  assert.equal(sonuc.truncated, false);
});

test('truncateCsvRecords: tavan kadar VERI satiri kalir, baslik ayrica korunur', () => {
  const metin = 'a,b\n1,1\n2,2\n3,3\n4,4';
  const sonuc = truncateCsvRecords(metin, 2);
  assert.equal(sonuc.truncated, true);
  // Başlık + 2 veri satırı.
  assert.equal(sonuc.text, 'a,b\n1,1\n2,2');

  // Kalan metin kendi başına geçerli bir CSV olmalı.
  const { records } = parseCsv(sonuc.text);
  assert.equal(records.length, 2);
  assert.equal(records[0]!.a, '1');
});

test('truncateCsvRecords: TIRNAK ICINDEKI satir sonu kaydi bolmez', () => {
  /*
   * Ham `\n` sayan bir kırpma burada ikinci kaydın ORTASINDAN keserdi ve
   * kalan yarım satır "kolonları kaymış bozuk kayıt" olarak görünürdü --
   * yani kendi kırpmamızla ürettiğimiz bir hatayı satıcının feed'ine
   * yazmış olurduk.
   */
  const metin = 'ad,aciklama\nUrun1,"iki\nsatirli aciklama"\nUrun2,tek satir\nUrun3,x';
  const sonuc = truncateCsvRecords(metin, 2);

  assert.equal(sonuc.truncated, true);
  const { records } = parseCsv(sonuc.text);
  assert.equal(records.length, 2);
  assert.equal(records[0]!.ad, 'Urun1');
  // Açıklama bütün hâlde kalmalı: kesme noktası kaydın ortası değil sonu.
  assert.equal(records[0]!.aciklama, 'iki\nsatirli aciklama');
  assert.equal(records[1]!.ad, 'Urun2');
});

test('truncateCsvRecords: kacirilmis tirnak ("") durumu bozmaz', () => {
  // `""` iki kez geçiş yapar, net etkisi yok.
  const metin = 'ad,not\nA,"12"" ekran"\nB,y\nC,z';
  const sonuc = truncateCsvRecords(metin, 2);
  const { records } = parseCsv(sonuc.text);
  assert.equal(records.length, 2);
  assert.equal(records[0]!.not, '12" ekran');
});

test('truncateCsvRecords: CRLF satir sonlariyla da calisir', () => {
  const metin = 'a,b\r\n1,1\r\n2,2\r\n3,3';
  const sonuc = truncateCsvRecords(metin, 2);
  assert.equal(sonuc.truncated, true);
  const { records } = parseCsv(sonuc.text);
  assert.equal(records.length, 2);
  assert.equal(records[1]!.a, '2');
});

test('truncateCsvRecords: tavan 0 ise yalnizca baslik kalir', () => {
  const sonuc = truncateCsvRecords('a,b\n1,2\n3,4', 0);
  assert.equal(sonuc.text, 'a,b');
  assert.equal(sonuc.truncated, true);
});

test('truncateCsvRecords: son satirda satir sonu varsa kirpilmis SAYILMAZ', () => {
  // `a,b\n1,2\n` = başlık + 1 veri satırı. Tavan 1 ile kırpılmamalı.
  const sonuc = truncateCsvRecords('a,b\n1,2\n', 1);
  assert.equal(sonuc.truncated, false);
});
