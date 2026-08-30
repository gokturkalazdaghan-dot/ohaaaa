#!/usr/bin/env node
/**
 * Uygulamanın Supabase'e attığı sorguları ŞEMAYLA karşılaştırır.
 *
 * NEDEN GEREKLİ
 * Supabase kod yolu demo modunda hiç çalışmaz. Bir tablo adı, bir sütun adı
 * ya da bir fonksiyon imzası şemayla uyuşmuyorsa bu, ancak gerçek veritabanı
 * bağlandığı an ortaya çıkar — yani canlıda, ilk ziyaretçide. Derleme ve
 * birim testleri bunu yakalamaz, çünkü sorgular sadece metin.
 *
 * Bu betik metinleri çıkarır ve migration'ları uygulanmış GERÇEK bir
 * PostgreSQL'e sorarak doğrular.
 *
 * KULLANIM
 *   DATABASE_URL=postgres://... node scripts/verify-supabase-queries.mjs
 *
 * Şema hazır bir veritabanı gerekir (scripts/verify-sql.sh bunu kurar).
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL tanımlı olmalı.');
  process.exit(2);
}

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
/*
 * Taranan kaynaklar.
 *
 * `packages/shared/src` ve `packages/ingest/src` sonradan eklendi: kanonik
 * eşleştirme (productSync) ile besleme deposu oradan veritabanına sorgu atıyor
 * ama taramanın dışındaydı. Yani o dosyalardaki bir tablo/sütun adı hatası
 * ancak canlıda, ilk beslemede ortaya çıkardı.
 */
const SCAN = [
  'apps/web/src',
  'packages/backend/src',
  'packages/shared/src',
  'packages/ingest/src',
];

function psql(sql) {
  return execFileSync('psql', [DB, '-tAc', sql], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// --- Şemadan gerçekleri oku ------------------------------------------------
const relations = new Set(
  psql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r','v','m','f','p')`),
);
const routines = new Set(
  psql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'`),
);
const columnsOf = new Map();
for (const row of psql(
  `select table_name || '|' || column_name from information_schema.columns
    where table_schema = 'public'`,
)) {
  const [t, c] = row.split('|');
  if (!columnsOf.has(t)) columnsOf.set(t, new Set());
  columnsOf.get(t).add(c);
}

// --- Kaynaktaki çağrıları çıkar --------------------------------------------
const files = SCAN.flatMap((d) => {
  const abs = path.join(ROOT, d);
  try {
    return walk(abs);
  } catch {
    return [];
  }
});

const problems = [];
let checkedTables = 0;
let checkedRoutines = 0;
let checkedColumns = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);

  for (const m of src.matchAll(/\.from\('([a-z_]+)'\)/g)) {
    checkedTables += 1;
    if (!relations.has(m[1])) {
      problems.push(`${rel}: .from('${m[1]}') — şemada böyle bir tablo/görünüm yok`);
    }
  }

  for (const m of src.matchAll(/\.rpc\('([a-z_]+)'/g)) {
    checkedRoutines += 1;
    if (!routines.has(m[1])) {
      problems.push(`${rel}: .rpc('${m[1]}') — şemada böyle bir fonksiyon yok`);
    }
  }

  /*
   * .from('t').select('a, b, rel(x)') kalıbında düz sütunları doğrula.
   * Gömülü ilişkiler (parantezli), yıldız ve takma adlar atlanır: onların
   * doğrulaması PostgREST'in ilişki çözümlemesine bağlıdır ve burada
   * güvenilir biçimde yapılamaz. Yanlış alarm vermektense kapsamı dar tutmak
   * daha iyidir — kontrolün kendisine güvenilmezse kimse çalıştırmaz.
   */
  for (const m of src.matchAll(/\.from\('([a-z_]+)'\)\s*\n?\s*\.select\(\s*`([^`]+)`|\.from\('([a-z_]+)'\)\s*\n?\s*\.select\(\s*'([^']+)'/g)) {
    const table = m[1] ?? m[3];
    const sel = m[2] ?? m[4];
    const cols = columnsOf.get(table);
    if (!cols) continue;

    let depth = 0;
    let token = '';
    const top = [];
    for (const ch of sel) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ',' && depth === 0) { top.push(token); token = ''; continue; }
      if (depth === 0 && ch !== '(' && ch !== ')') token += ch;
    }
    top.push(token);

    for (const raw of top) {
      const name = raw.trim();
      if (!name || name === '*' || name.includes(':') || name.includes('!')) continue;
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) continue;
      checkedColumns += 1;
      if (!cols.has(name)) {
        problems.push(`${rel}: ${table}.${name} — şemada böyle bir sütun yok`);
      }
    }
  }
}

console.log(`▸ ${files.length} dosya tarandı`);
console.log(`  ${checkedTables} tablo referansı, ${checkedRoutines} fonksiyon, ${checkedColumns} sütun denetlendi`);

if (problems.length === 0) {
  console.log('✓ Tüm Supabase sorguları şemayla uyuşuyor');
  process.exit(0);
}

console.error(`\n✗ ${problems.length} uyuşmazlık:`);
for (const p of problems) console.error('  ' + p);
process.exit(1);
