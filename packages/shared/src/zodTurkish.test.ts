/**
 * Doğrulama mesajlarının Türkçe olduğunun kanıtı.
 *
 * Bu testin asıl işi bir REGRESYONU sabitlemek: taşeron başvuru formunda
 * kullanıcı "String must contain at least 3 character(s)" görüyordu.
 * Şemadaki bazı doğrulayıcıların özel mesajı vardı, bazılarının yoktu ve
 * mesajsız olanlar Zod'un İngilizce varsayılanına düşüyordu.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { z } from 'zod';

import { vendorApplicationSchema } from './schemas.js';

/** Şema modülü içe aktarıldığında harita kurulmuş olmalı. */
function ilkHata(schema: z.ZodTypeAny, value: unknown): string {
  const result = schema.safeParse(value);
  assert.equal(result.success, false, 'bu girdi reddedilmeliydi');
  const first = result.success ? undefined : result.error.issues[0];
  assert.ok(first, 'en az bir hata bekleniyordu');
  return first.message;
}

/*
 * Ingilizce tespiti, Zod'un KENDI varsayilan kaliplariyla yapilir.
 *
 * Ilk denemede "iki uzun ASCII kelime yan yana" gibi genel bir kural
 * yazmistim; "karakter olmali" da ona uyuyordu ve test butun Turkce
 * mesajlari Ingilizce sandi. Genel bir dil sezgisi yerine, aranan seyin
 * TAM METNI aranir.
 */
const INGILIZCE_KALIPLAR = [
  'String must',
  'Number must',
  'Array must',
  'must contain',
  'at least',
  'at most',
  'Expected',
  'Required',
  'Invalid',
  'characters',
  'element(s)',
];

const ingilizceMi = (message: string): boolean =>
  INGILIZCE_KALIPLAR.some((kalip) => message.includes(kalip));

test('kisa metin hatasi Turkce', () => {
  const m = ilkHata(z.string().min(3), 'ab');
  assert.equal(m, 'En az 3 karakter olmalı');
});

test('bos birakilamaz hatasi Turkce', () => {
  assert.equal(ilkHata(z.string().min(1), ''), 'Bu alan boş bırakılamaz');
});

test('uzun metin hatasi Turkce', () => {
  assert.equal(ilkHata(z.string().max(2), 'abcd'), 'En fazla 2 karakter olabilir');
});

test('sayi sinirlari Turkce', () => {
  assert.equal(ilkHata(z.number().min(5), 3), 'En az 5 olmalı');
  assert.equal(ilkHata(z.number().max(5), 9), 'En fazla 5 olabilir');
});

test('eksik alan hatasi Turkce', () => {
  assert.equal(ilkHata(z.object({ a: z.string() }), {}), 'Bu alan zorunlu');
});

test('bicim hatalari Turkce', () => {
  assert.equal(ilkHata(z.string().email(), 'x'), 'Geçerli bir e-posta girin');
  assert.equal(ilkHata(z.string().url(), 'x'), 'Geçerli bir adres girin');
  assert.equal(ilkHata(z.string().regex(/^\d+$/), 'abc'), 'Biçim uygun değil');
});

test('liste birimi "oge" olarak yaziliyor', () => {
  assert.equal(ilkHata(z.array(z.string()).min(2), ['a']), 'En az 2 öğe olmalı');
});

test('OZEL mesajlar korunuyor -- harita onlari EZMEZ', () => {
  const m = ilkHata(z.string().min(20, 'En az 20 karakterlik bir tanıtım yazın'), 'kısa');
  assert.equal(m, 'En az 20 karakterlik bir tanıtım yazın');
});

/*
 * Asil regresyon: basvuru formunun gercek alanlari. Daha once slug ve
 * tax_id icin Ingilizce donuyordu.
 */
test('basvuru formunun hicbir alani Ingilizce mesaj dondurmuyor', () => {
  const result = vendorApplicationSchema.safeParse({
    display_name: 'T',
    slug: 'ab',
    legal_name: 'X',
    tax_id: 'ABC',
    support_email: 'gecersiz',
    description: 'kisa',
    website_url: 'adres-degil',
  });

  assert.equal(result.success, false);
  if (result.success) return;
  const ingilizceOlanlar = result.error.issues
    .filter((issue) => ingilizceMi(issue.message))
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`);

  assert.deepEqual(
    ingilizceOlanlar,
    [],
    `Ingilizce mesaj kalmis: ${ingilizceOlanlar.join(' | ')}`,
  );
  assert.ok(result.error.issues.length >= 6, 'her gecersiz alan raporlanmali');
});
