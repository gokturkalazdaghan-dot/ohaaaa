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

/**
 * Metni en fazla `maxRecords` veri satırına kırpar — **AYRIŞTIRMADAN ÖNCE**.
 *
 * ======================================================================
 * NEDEN VAR: ÖLÇÜLMÜŞ BİR OOM
 * ======================================================================
 * `pipeline.ts` içindeki `MAX_ITEMS_PER_RUN` tavanı AYRIŞTIRMADAN SONRA
 * uygulanıyordu. Yani tavan veritabanını koruyor ama BELLEĞİ korumuyordu:
 * 200.000 satırlık bir feed önce tamamen nesneye çevriliyor, ancak sonra
 * ilk 50.000'e kesiliyordu.
 *
 * Üretimde ölçüldü (GitHub Actions, 2026-09-26, Lunzo PL parça 0 —
 * 200.000 kalem):
 *
 *   FATAL ERROR: Ineffective mark-compacts near heap limit
 *   Allocation failed - JavaScript heap out of memory   (exit 134)
 *
 * Alım hiç başlamadan düştü. Dizeyi ayrıştırmadan ÖNCE kesmek, nesne
 * patlamasını hiç oluşturmuyor.
 *
 * ======================================================================
 * TIRNAK FARKINDALIĞI ŞART, YOKSA KIRPMA VERİYİ BOZAR
 * ======================================================================
 * CSV'de tırnak içinde satır sonu OLABİLİR ve ürün açıklamalarında sık
 * görülür. Ham `\n` sayarak kesmek, bir kaydın ORTASINDAN bölmek demekti:
 * kalan yarım satır ayrıştırıcıda kolonları kaymış bir kayda dönüşür ve o
 * kayıt "bozuk veri" sanılır. Kendi kırpmamızla ürettiğimiz bir hatayı
 * satıcının feed'ine yazmak, ölçümü sessizce kirletirdi.
 *
 * Bu yüzden tarama tırnak durumunu izliyor ve yalnızca tırnak DIŞINDAKİ
 * satır sonlarını sayıyor. `""` (kaçırılmış tırnak) iki kez geçiş yapar,
 * yani net etkisi yok -- doğru davranış.
 *
 * Kesme noktası daima gerçek bir kayıt sınırı olduğu için kalan metin
 * kendi başına geçerli bir CSV'dir.
 *
 * `maxRecords` VERİ satırını sayar; başlık satırı ayrıca korunur.
 */
export function truncateCsvRecords(
  text: string,
  maxRecords: number,
): { text: string; truncated: boolean } {
  if (maxRecords < 0) return { text, truncated: false };

  let inQuotes = false;
  /** Görülen satır sonu sayısı (başlık dahil). */
  let boundaries = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === '\n' && !inQuotes) {
      boundaries += 1;
      /*
       * Başlık + `maxRecords` veri satırı = `maxRecords + 1` sınır.
       * O sınıra gelindiğinde metin BURADA biter; sonrası hiç
       * ayrıştırılmaz.
       */
      if (boundaries >= maxRecords + 1) {
        // Son satır sonu dahil edilmiyor: kalan metin tam kayıtlarla biter.
        return { text: text.slice(0, i), truncated: i < text.length - 1 };
      }
    }
  }

  return { text, truncated: false };
}
