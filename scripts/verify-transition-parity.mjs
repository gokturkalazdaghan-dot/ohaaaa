#!/usr/bin/env node
/**
 * BAŞVURU DURUM GEÇİŞ TABLOSU İKİ YERDE — AYRIŞAMAZLAR
 *
 * NEDEN BU BETİK VAR
 *
 * Kapı veritabanında (`tg_programs_guard_application_state`) ve orası SON
 * kapı olarak kalmalı: kod atlanabilir, veritabanı atlanamaz. Ama motor da
 * veritabanının reddedeceği bir geçişi denememeli, yoksa her geçersiz geçiş
 * bir DATABASE_ERROR olarak kaydedilir ve gerçek veritabanı arızalarıyla
 * aynı kefeye girer -- asıl arıza görünmez olur.
 *
 * Yani tablo iki yerde duruyor ve ayrışmaları İKİ AYRI sessiz hataya yol
 * açar:
 *
 *   Kod daha GENİŞSE   motor boşuna dener; denetim izi sahte veritabanı
 *                      hatalarıyla dolar.
 *   Kod daha DARSA     motor serbest bir geçişi yasak sanar ve program
 *                      sonsuza kadar yerinde çakılı kalır. Bu daha kötü:
 *                      hiçbir hata düşmez, sadece hiçbir şey olmaz.
 *
 * Hiçbir birim testi bunu yakalamaz -- ikisi de kendi içinde tutarlıdır.
 * Yakalanabilecek tek yer, iki kaynağın karşılaştırıldığı bu betik.
 *
 * Kullanım: node scripts/verify-transition-parity.mjs
 */

import { readFileSync } from 'node:fs';

const TS_YOL = new URL('../packages/shared/src/providers/applicationTransitions.ts', import.meta.url);
const SQL_YOL = new URL('../supabase/migrations/20260907210000_program_applications.sql', import.meta.url);

const bulgular = [];

/** TypeScript tablosunu okur: `DURUM: ['A', 'B', ...],` */
function tsTablosu(kaynak) {
  const govde = kesitAl(
    kaynak,
    'export const APPLICATION_TRANSITIONS',
    '\n};',
    'TypeScript APPLICATION_TRANSITIONS bloğu bulunamadı',
  );
  if (govde === null) return null;

  const tablo = {};
  // `AD: [ ... ],` — köşeli parantez içi çok satırlı olabilir.
  const kalip = /^\s{2}([A-Z_]+):\s*\[([^\]]*)\]/gm;
  let eslesme;

  while ((eslesme = kalip.exec(govde)) !== null) {
    tablo[eslesme[1]] = tirnakliAdlar(eslesme[2]);
  }

  return tablo;
}

/** SQL CASE bloğunu okur: `when 'DURUM' then array['A','B',...]` */
function sqlTablosu(kaynak) {
  const govde = kesitAl(
    kaynak,
    'v_izinli := case old.application_state',
    'end::public.program_application_state[]',
    'SQL CASE bloğu bulunamadı',
  );
  if (govde === null) return null;

  const tablo = {};
  const kalip = /when\s+'([A-Z_]+)'\s+then\s+array\[([^\]]*)\]/g;
  let eslesme;

  while ((eslesme = kalip.exec(govde)) !== null) {
    tablo[eslesme[1]] = tirnakliAdlar(eslesme[2]);
  }

  return tablo;
}

/**
 * Kesiti alır; bulunamazsa BULGU üretir.
 *
 * Sessizce boş dönmüyor: bir yeniden adlandırma bu betiği "hiçbir şey
 * bulamadım, demek ki sorun yok" hâline getirirdi -- yani kontrolü
 * sessizce kapatırdı.
 */
function kesitAl(kaynak, bas, son, hata) {
  const i = kaynak.indexOf(bas);
  if (i === -1) {
    bulgular.push(`${hata} — kontrol çalışamadı.`);
    return null;
  }
  const j = kaynak.indexOf(son, i);
  if (j === -1) {
    bulgular.push(`${hata} (kapanış bulunamadı) — kontrol çalışamadı.`);
    return null;
  }
  return kaynak.slice(i, j);
}

/** `'A', 'B',\n 'C'` -> ['A','B','C'] — yorum satırları atılır. */
function tirnakliAdlar(ham) {
  return [...ham.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
}

const ts = tsTablosu(readFileSync(TS_YOL, 'utf8'));
const sql = sqlTablosu(readFileSync(SQL_YOL, 'utf8'));

if (ts && sql) {
  if (Object.keys(ts).length === 0 || Object.keys(sql).length === 0) {
    bulgular.push('Tablolardan biri BOŞ ayrıştırıldı — kontrol anlamsız olurdu.');
  }

  const durumlar = [...new Set([...Object.keys(ts), ...Object.keys(sql)])].sort();

  for (const durum of durumlar) {
    const a = ts[durum];
    const b = sql[durum];

    if (!a) {
      bulgular.push(`"${durum}" SQL'de var, TypeScript tablosunda YOK — motor bu durumdan hiç çıkamaz.`);
      continue;
    }
    if (!b) {
      bulgular.push(`"${durum}" TypeScript'te var, SQL'de YOK — kapı bu durumu hiç tanımıyor.`);
      continue;
    }

    const fazla = a.filter((x) => !b.includes(x));
    const eksik = b.filter((x) => !a.includes(x));

    if (fazla.length > 0) {
      bulgular.push(
        `"${durum}": TypeScript ${fazla.join(', ')} geçişine izin veriyor ama SQL vermiyor — ` +
          'motor boşuna dener, denetim izi sahte veritabanı hatalarıyla dolar.',
      );
    }
    if (eksik.length > 0) {
      bulgular.push(
        `"${durum}": SQL ${eksik.join(', ')} geçişine izin veriyor ama TypeScript vermiyor — ` +
          'motor serbest bir geçişi yasak sanar ve program yerinde çakılı kalır.',
      );
    }
  }

  // APPROVED tek yönlülüğü ayrıca kilitleniyor: bu satırın gevşemesi,
  // çalışan bir gelir hattının otomatik bir turla kopması demek.
  for (const [ad, tablo] of [['TypeScript', ts], ['SQL', sql]]) {
    const onay = tablo.APPROVED ?? [];
    if (onay.length !== 1 || onay[0] !== 'REJECTED') {
      bulgular.push(
        `${ad}: APPROVED yalnızca REJECTED'a gidebilmeli, bulunan: [${onay.join(', ')}]. ` +
          'Onayı geri alabilecek tek şey ağın kendisidir.',
      );
    }
  }
}

if (bulgular.length > 0) {
  console.error(`\n✗ ${bulgular.length} geçiş tablosu sorunu bulundu\n`);
  for (const b of bulgular) console.error(`  ${b}`);
  console.error('');
  process.exit(1);
}

const sayi = Object.keys(ts).length;
const gecis = Object.values(ts).reduce((s, v) => s + v.length, 0);
console.log(`✓ Geçiş tablosu tutarlı — ${sayi} durum, ${gecis} izinli geçiş (TypeScript = SQL)`);
