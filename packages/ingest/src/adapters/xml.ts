/**
 * Ürün feed'leri için odaklı XML ayrıştırıcısı.
 *
 * KAPSAM: Genel amaçlı bir XML ayrıştırıcısı DEĞİLDİR. Ürün feed'lerinin
 * tamamı aynı basit yapıdadır — tekrar eden bir öğe listesi ve düz metin
 * çocuk düğümler:
 *
 *   <item><g:id>1</g:id><g:title>Ürün</g:title></item>
 *
 * Desteklenen: CDATA, temel XML varlıkları, ad alanı önekleri (g: gibi,
 * metin olarak korunur), öznitelik değerleri (`etiket@öznitelik` anahtarıyla).
 *
 * Desteklenmeyen: iç içe tekrar eden yapılar, ad alanı çözümlemesi, DTD.
 * Bir feed bunlara ihtiyaç duyuyorsa doğru cevap bu dosyayı büyütmek değil,
 * o kaynak için ayrı bir adaptör yazmaktır.
 */

import type { AdapterResult, RawRecord } from '../types.js';

/** Ürün öğesi olabilecek etiket adları (öncelik sırasıyla). */
const ITEM_TAGS = ['item', 'entry', 'product', 'urun', 'offer'];

export function parseXml(content: string, itemTag?: string): AdapterResult {
  const warnings: string[] = [];

  const tag = itemTag ?? detectItemTag(content);
  if (!tag) {
    return {
      records: [],
      warnings: ['Tekrar eden ürün öğesi bulunamadı (item/entry/product bekleniyordu).'],
    };
  }

  const records: RawRecord[] = [];

  // Ad alanı öneki olabilir: <g:item> veya <item>.
  const itemPattern = new RegExp(
    `<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`,
    'gi',
  );

  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = itemPattern.exec(content)) !== null) {
    index += 1;
    const inner = match[1]!;
    const record = parseChildren(inner);

    if (Object.keys(record).length === 0) {
      warnings.push(`${index}. öğe boş — atlandı.`);
      continue;
    }

    records.push(record);
  }

  return { records, warnings };
}

function detectItemTag(content: string): string | null {
  for (const candidate of ITEM_TAGS) {
    // En az iki kez geçiyorsa tekrar eden öğedir.
    const pattern = new RegExp(`<(?:[\\w-]+:)?${candidate}(?:\\s|>)`, 'gi');
    const matches = content.match(pattern);
    if (matches && matches.length >= 2) return candidate;
  }

  // Tek ürünlü feed de geçerlidir.
  for (const candidate of ITEM_TAGS) {
    if (new RegExp(`<(?:[\\w-]+:)?${candidate}(?:\\s|>)`, 'i').test(content)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Bir öğenin düz metin çocuklarını okur.
 *
 * Aynı etiket birden çok kez geçerse (ör. çoklu görsel) değerler `|` ile
 * birleştirilir; normalleştirme katmanı bunu diziye çevirir.
 */
function parseChildren(inner: string): RawRecord {
  const record: RawRecord = {};

  const childPattern = /<([\w:-]+)((?:\s[^>]*?)?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  let match: RegExpExecArray | null;

  while ((match = childPattern.exec(inner)) !== null) {
    const name = match[1]!;
    const attributes = match[2] ?? '';
    const rawValue = match[3];

    if (rawValue !== undefined) {
      const value = decodeXmlText(rawValue).trim();

      if (value !== '') {
        record[name] = record[name] === undefined ? value : `${record[name]}|${value}`;
      }
    }

    // Öznitelikler `etiket@ad` anahtarıyla erişilebilir olur.
    // Örn. <g:price currency="TRY">129.90</g:price> → "g:price@currency"
    const attributePattern = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let attributeMatch: RegExpExecArray | null;

    while ((attributeMatch = attributePattern.exec(attributes)) !== null) {
      record[`${name}@${attributeMatch[1]!}`] = decodeXmlText(attributeMatch[2]!);
    }
  }

  return record;
}

/** CDATA bloklarını açar ve temel XML varlıklarını çözer. */
function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    // &amp; EN SONA bırakılır: önce çözülürse "&amp;lt;" yanlışlıkla "<" olur.
    .replace(/&amp;/g, '&');
}
