/**
 * CSV / TSV ayrıştırıcısı (RFC 4180).
 *
 * Neden hazır bir kütüphane değil? Ortaklık feed'lerinde en sık karşılaşılan
 * bozukluklar tırnak içindeki virgüller ve satır sonlarıdır; bunları doğru
 * işleyen bir ayrıştırıcı ~80 satırdır. Bağımlılık eklemek, tek kişilik bir
 * operasyonda bakım yüzeyini genişletmekten başka işe yaramaz.
 *
 * Desteklenen:
 *   • Tırnaklı alanlar, alan içinde virgül ve satır sonu
 *   • "" ile kaçırılmış tırnak
 *   • CRLF ve LF
 *   • Ayırıcı otomatik tespiti (virgül / noktalı virgül / sekme)
 *   • BOM temizliği
 */

import type { AdapterResult, RawRecord } from '../types.js';

export function parseCsv(content: string, delimiter?: string): AdapterResult {
  // Excel'in ürettiği feed'lerde BOM sık görülür ve ilk kolon adını bozar.
  const text = content.replace(/^﻿/, '');
  const sep = delimiter ?? detectDelimiter(text);

  const rows = splitRows(text, sep);
  const warnings: string[] = [];

  if (rows.length === 0) {
    return { records: [], warnings: ['Dosya boş.'] };
  }

  const header = rows[0]!.map((cell) => cell.trim());
  const records: RawRecord[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;

    // Tamamen boş satırlar (dosya sonu) sessizce atlanır.
    if (row.length === 1 && row[0]!.trim() === '') continue;

    if (row.length !== header.length) {
      warnings.push(
        `Satır ${i + 1}: ${header.length} kolon bekleniyordu, ${row.length} bulundu — atlandı.`,
      );
      continue;
    }

    const record: RawRecord = {};
    for (let c = 0; c < header.length; c += 1) {
      record[header[c]!] = row[c]!;
    }
    records.push(record);
  }

  return { records, warnings };
}

/**
 * Ayırıcıyı ilk satıra bakarak tahmin eder.
 * Türkiye'deki feed'lerin çoğu noktalı virgül kullanır (Excel yerel ayarı),
 * bu yüzden sabit virgül varsaymak sık karşılaşılan bir hatadır.
 */
function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));

  const counts: Array<[string, number]> = [
    [',', occurrencesOutsideQuotes(firstLine, ',')],
    [';', occurrencesOutsideQuotes(firstLine, ';')],
    ['\t', occurrencesOutsideQuotes(firstLine, '\t')],
  ];

  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}

function occurrencesOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;

  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === char && !inQuotes) count += 1;
  }

  return count;
}

/** Durum makinesiyle satır ve alanlara böler. */
function splitRows(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        // "" → kaçırılmış tek tırnak
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === sep) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (char === '\r') {
      // CRLF: \n bir sonraki turda işlenir.
      i += 1;
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // Dosya satır sonu olmadan bitmiş olabilir.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
