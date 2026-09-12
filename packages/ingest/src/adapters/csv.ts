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

/** Bir turda bellekte tutulacak en fazla kalem. */
export const DEFAULT_BATCH_SIZE = 2_000;

/**
 * Bir beslemeyi PARÇA PARÇA çözümler.
 *
 * Çağıran her parçayı işleyip bıraktığında bellek sabit kalır: aynı anda
 * yalnızca `batchSize` kadar kayıt yaşar. 116 417 satırlık gerçek bir Awin
 * beslemesinde eski yol 643 MB heap bırakıyordu; burada tavan parçanın
 * kendisidir.
 *
 * UYARI -- METNİN KENDİSİ HÂLÂ BELLEKTE. Girdi bir `string` olduğu için
 * çözümlenmiş gövde (ör. 30 MB) çağıranın elinde duruyor. Sınırlanan şey
 * AYRIŞTIRMA ÇIKTISI: satır dizileri ve kayıt nesneleri. Gövdeyi de akıtmak
 * `Fetcher` sözleşmesini değiştirmeyi gerektirir ve gövde/gzip-bomba
 * sınırları oradadır -- bu yüzden bu turda dokunulmadı.
 */
export function* streamCsvBatches(
  content: string,
  options: { batchSize?: number; delimiter?: string } = {},
): Generator<AdapterResult> {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);

  // Excel'in ürettiği feed'lerde BOM sık görülür ve ilk kolon adını bozar.
  const text = content.replace(/^﻿/, '');
  const sep = options.delimiter ?? detectDelimiter(text);

  const satirlar = iterateRows(text, sep);

  const ilk = satirlar.next();
  if (ilk.done) {
    yield { records: [], warnings: ['Dosya boş.'] };
    return;
  }

  const header = ilk.value.map((cell) => cell.trim());

  let records: RawRecord[] = [];
  let warnings: string[] = [];
  let satirNo = 1;

  for (const row of satirlar) {
    satirNo += 1;

    // Tamamen boş satırlar (dosya sonu) sessizce atlanır.
    if (row.length === 1 && row[0]!.trim() === '') continue;

    if (row.length !== header.length) {
      warnings.push(
        `Satır ${satirNo}: ${header.length} kolon bekleniyordu, ${row.length} bulundu — atlandı.`,
      );
      continue;
    }

    const record: RawRecord = {};
    for (let c = 0; c < header.length; c += 1) {
      record[header[c]!] = row[c]!;
    }
    records.push(record);

    if (records.length >= batchSize) {
      yield { records, warnings };
      // YENİ diziler: `yield` edilenleri temizlemek çağıranın elindeki
      // parçayı da boşaltırdı.
      records = [];
      warnings = [];
    }
  }

  if (records.length > 0 || warnings.length > 0) {
    yield { records, warnings };
  }
}

/**
 * Beslemenin TAMAMINI tek seferde çözümler.
 *
 * Küçük beslemeler, testler ve `--dry-run` için. Büyük beslemelerde
 * `streamCsvBatches` kullanılır; ikisi AYNI çözümleyiciyi paylaşır, yani
 * "akan yol" ile "toplu yol" davranış olarak ayrışamaz.
 */
export function parseCsv(content: string, delimiter?: string): AdapterResult {
  const records: RawRecord[] = [];
  const warnings: string[] = [];

  for (const batch of streamCsvBatches(content, { delimiter })) {
    for (const r of batch.records) records.push(r);
    for (const w of batch.warnings) warnings.push(w);
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

/**
 * Durum makinesiyle satır ve alanlara böler -- ÜRETEÇ olarak.
 *
 * Eskiden `string[][]` döndürüyordu: 116 417 satırlık bir beslemede bu, tüm
 * satırların dizi dizisi olarak bellekte durması demekti ve üstüne bir de
 * `RawRecord[]` kuruluyordu. ÖLÇÜLDÜ: 30 MB'lık metin 643 MB heap bırakıyordu
 * (~21x). Üreteç, aynı durum makinesini satır satır çalıştırır; çağıran
 * tükettikçe satır serbest kalır.
 *
 * Ayrıştırma MANTIĞI DEĞİŞMEDİ -- yalnızca biriktirme kaldırıldı. `parseCsv`
 * bunun üstünde duruyor, yani tek bir ayrıştırıcı var ve iki kod yolu
 * birbirinden ayrışamaz.
 */
function* iterateRows(text: string, sep: string): Generator<string[]> {
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
      yield row;
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
    yield row;
  }
}
