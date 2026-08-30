import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { crawlDelayFor, isAllowed, parseRobotsTxt, selectGroup } from './robots.js';

const SAMPLE = `
# Örnek robots.txt
User-agent: *
Disallow: /admin
Disallow: /sepet
Allow: /admin/genel
Crawl-delay: 5

User-agent: OhaaaaBot
User-agent: OtherBot
Disallow: /ozel
Crawl-delay: 10

Sitemap: https://ornek.example/sitemap.xml
`;

test('gruplar ve sitemap ayrıştırılır', () => {
  const robots = parseRobotsTxt(SAMPLE);

  assert.equal(robots.groups.length, 2);
  assert.deepEqual(robots.sitemaps, ['https://ornek.example/sitemap.xml']);

  // Ardışık User-agent satırları tek grubu paylaşır.
  assert.deepEqual(robots.groups[1]?.userAgents, ['ohaaaabot', 'otherbot']);
});

test('en spesifik user-agent grubu seçilir', () => {
  const robots = parseRobotsTxt(SAMPLE);

  const ours = selectGroup(robots, 'OhaaaaBot/1.0 (+https://ohaaaa.com/bot)');
  assert.deepEqual(ours?.userAgents, ['ohaaaabot', 'otherbot']);

  // Bize özel kural yoksa '*' grubuna düşülür.
  const generic = selectGroup(robots, 'SomeoneElse/2.0');
  assert.deepEqual(generic?.userAgents, ['*']);
});

test('bize özel grup varsa yıldız grubu UYGULANMAZ', () => {
  const robots = parseRobotsTxt(SAMPLE);

  // '*' grubunda /sepet yasak, bizim grubumuzda değil.
  assert.equal(isAllowed(robots, 'OhaaaaBot', '/sepet'), true);
  assert.equal(isAllowed(robots, 'RandomBot', '/sepet'), false);

  // Bizim grubumuzun kendi yasağı geçerli.
  assert.equal(isAllowed(robots, 'OhaaaaBot', '/ozel/x'), false);
});

test('en uzun kalıp kazanır, eşitlikte Allow', () => {
  const robots = parseRobotsTxt(SAMPLE);

  assert.equal(isAllowed(robots, 'RandomBot', '/admin'), false);
  assert.equal(isAllowed(robots, 'RandomBot', '/admin/gizli'), false);
  // "/admin/genel" (12) > "/admin" (6) → Allow kazanır.
  assert.equal(isAllowed(robots, 'RandomBot', '/admin/genel'), true);
  assert.equal(isAllowed(robots, 'RandomBot', '/urun/123'), true);
});

test('Disallow kalıbı ön ek olarak uygulanır', () => {
  const robots = parseRobotsTxt('User-agent: *\nDisallow: /adm');
  assert.equal(isAllowed(robots, 'x', '/administrator'), false);
  assert.equal(isAllowed(robots, 'x', '/ad'), true);
});

test('joker karakterler * ve $ desteklenir', () => {
  const robots = parseRobotsTxt(`
User-agent: *
Disallow: /*.json$
Disallow: /ara/*/gizli
Allow: /veri/acik.json$
`);

  assert.equal(isAllowed(robots, 'x', '/veri/rapor.json'), false);
  assert.equal(isAllowed(robots, 'x', '/veri/rapor.json?x=1'), true, '$ sonu bağlar');
  assert.equal(isAllowed(robots, 'x', '/ara/abc/gizli'), false);
  assert.equal(isAllowed(robots, 'x', '/ara/abc/acik'), true);

  // Daha uzun Allow kalıbı, daha kısa Disallow'u yener.
  assert.equal(isAllowed(robots, 'x', '/veri/acik.json'), true);
});

test('boş Disallow "her şey serbest" demektir', () => {
  const robots = parseRobotsTxt('User-agent: *\nDisallow:');
  assert.equal(isAllowed(robots, 'x', '/herhangi/yol'), true);
});

test('kök yasağı her şeyi kapatır', () => {
  const robots = parseRobotsTxt('User-agent: *\nDisallow: /');
  assert.equal(isAllowed(robots, 'x', '/'), false);
  assert.equal(isAllowed(robots, 'x', '/urun/1'), false);
});

test('yorumlar ve satır içi # yok sayılır', () => {
  const robots = parseRobotsTxt(`
# tam satır yorumu
User-agent: *   # satır içi
Disallow: /gizli  # burası yasak
`);
  assert.equal(isAllowed(robots, 'x', '/gizli/x'), false);
  assert.equal(isAllowed(robots, 'x', '/acik'), true);
});

test('crawl-delay gruba göre okunur', () => {
  const robots = parseRobotsTxt(SAMPLE);
  assert.equal(crawlDelayFor(robots, 'OhaaaaBot'), 10);
  assert.equal(crawlDelayFor(robots, 'RandomBot'), 5);
});

test('boş dosya her şeye izin verir', () => {
  assert.equal(isAllowed(parseRobotsTxt(''), 'x', '/herhangi'), true);
});

test('gruba ait olmayan kurallar yok sayılır', () => {
  // User-agent satırından ÖNCE gelen Disallow geçersizdir.
  const robots = parseRobotsTxt('Disallow: /x\nUser-agent: *\nAllow: /');
  assert.equal(isAllowed(robots, 'x', '/x'), true);
});
