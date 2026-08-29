/**
 * JSON feed ayrıştırıcısı.
 *
 * Ürün dizisi kökte olabileceği gibi bir sarmalayıcı içinde de olabilir
 * (`{"products": [...]}`, `{"data":{"items":[...]}}`). En büyük nesne
 * dizisi bulunur — feed'in yapısını yapılandırmaya yazdırmak yerine
 * kendiliğinden bulmak, yeni kaynak eklemeyi kolaylaştırır.
 */

import type { AdapterResult, RawRecord } from '../types.js';

export function parseJson(content: string): AdapterResult {
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return {
      records: [],
      warnings: [`JSON ayrıştırılamadı: ${(error as Error).message}`],
    };
  }

  const array = findLargestObjectArray(parsed);

  if (!array) {
    return { records: [], warnings: ['JSON içinde ürün dizisi bulunamadı.'] };
  }

  const records: RawRecord[] = [];

  for (const [index, item] of array.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      warnings.push(`${index}. öğe nesne değil — atlandı.`);
      continue;
    }

    records.push(flatten(item as Record<string, unknown>));
  }

  return { records, warnings };
}

/**
 * İç içe nesneleri `a.b.c` anahtarlarına düzleştirir; böylece alan haritası
 * `"price": "pricing.current"` gibi yollar kullanabilir.
 */
function flatten(input: Record<string, unknown>, prefix = ''): RawRecord {
  const output: RawRecord = {};

  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      // Diziler `|` ile birleştirilir (görsel listeleri gibi).
      output[path] = value
        .filter((entry) => typeof entry === 'string' || typeof entry === 'number')
        .join('|');
      continue;
    }

    if (typeof value === 'object') {
      Object.assign(output, flatten(value as Record<string, unknown>, path));
      continue;
    }

    output[path] = String(value);
  }

  return output;
}

function findLargestObjectArray(value: unknown, depth = 0): unknown[] | null {
  if (depth > 6) return null;

  if (Array.isArray(value)) {
    return value.some((item) => typeof item === 'object' && item !== null) ? value : null;
  }

  if (typeof value !== 'object' || value === null) return null;

  let best: unknown[] | null = null;

  for (const child of Object.values(value)) {
    const candidate = findLargestObjectArray(child, depth + 1);
    if (candidate && (!best || candidate.length > best.length)) {
      best = candidate;
    }
  }

  return best;
}
