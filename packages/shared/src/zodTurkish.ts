/**
 * Zod'un varsayılan hata mesajlarını TÜRKÇELEŞTİRİR.
 *
 * NEDEN GEREKLİ
 * Şemalardaki doğrulayıcıların bir kısmı özel mesaj taşıyordu, bir kısmı
 * taşımıyordu. Taşımayanlar Zod'un İngilizce varsayılanına düşüyordu ve bu
 * doğrudan kullanıcının önüne geliyordu. Taşeron başvuru formunda ölçüldü:
 *
 *   slug   → "String must contain at least 3 character(s)"
 *   tax_id → "String must contain at least 10 character(s)"
 *
 * Türkçe bir sitenin en önemli dönüşüm formunda, hatanın yarısı Türkçe
 * yarısı İngilizceydi.
 *
 * NEDEN TEK TEK MESAJ YAZILMADI
 * Şemalarda mesajsız onlarca doğrulayıcı var ve her birine elle mesaj
 * yazmak hem uzun hem de UNUTULABİLİR: yarın eklenen bir `.max(50)` yine
 * İngilizce döner. Hata haritası bir kez kurulur ve sonradan eklenen
 * doğrulayıcıyı da kapsar.
 *
 * ÖZEL MESAJLAR KORUNUR
 * Zod, doğrulayıcıya özel mesaj verilmişse haritayı hiç çağırmaz. Yani
 * `.min(20, 'En az 20 karakterlik bir tanıtım yazın')` aynen kalır; harita
 * yalnızca boşluğu doldurur.
 */

import { z } from 'zod';

/** "3 karakter" / "1 öğe" gibi birim seçimini tipe göre yapar. */
function birim(type: string, count: number): string {
  if (type === 'array') return `${count} öğe`;
  if (type === 'string') return `${count} karakter`;
  return String(count);
}

const errorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type: {
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'Bu alan zorunlu' };
      }
      const beklenen =
        issue.expected === 'string'
          ? 'metin'
          : issue.expected === 'number'
            ? 'sayı'
            : issue.expected === 'boolean'
              ? 'doğru/yanlış'
              : issue.expected === 'array'
                ? 'liste'
                : issue.expected === 'object'
                  ? 'nesne'
                  : issue.expected;
      return { message: `Beklenen değer türü: ${beklenen}` };
    }

    case z.ZodIssueCode.too_small: {
      const n = Number(issue.minimum);
      if (issue.type === 'number') {
        return {
          message: issue.inclusive
            ? `En az ${n} olmalı`
            : `${n} değerinden büyük olmalı`,
        };
      }
      if (n === 1 && issue.type !== 'date') {
        return { message: 'Bu alan boş bırakılamaz' };
      }
      return { message: `En az ${birim(issue.type, n)} olmalı` };
    }

    case z.ZodIssueCode.too_big: {
      const n = Number(issue.maximum);
      if (issue.type === 'number') {
        return {
          message: issue.inclusive
            ? `En fazla ${n} olabilir`
            : `${n} değerinden küçük olmalı`,
        };
      }
      return { message: `En fazla ${birim(issue.type, n)} olabilir` };
    }

    case z.ZodIssueCode.invalid_string: {
      if (issue.validation === 'email') return { message: 'Geçerli bir e-posta girin' };
      if (issue.validation === 'url') return { message: 'Geçerli bir adres girin' };
      if (issue.validation === 'uuid') return { message: 'Geçerli bir kimlik girin' };
      if (issue.validation === 'regex') return { message: 'Biçim uygun değil' };
      return { message: 'Geçersiz değer' };
    }

    case z.ZodIssueCode.invalid_enum_value:
      return {
        message: `Geçerli seçenekler: ${issue.options.map(String).join(', ')}`,
      };

    case z.ZodIssueCode.unrecognized_keys:
      return {
        message: `Tanımlı olmayan alan: ${issue.keys.join(', ')}`,
      };

    case z.ZodIssueCode.not_multiple_of:
      return { message: `${String(issue.multipleOf)} katı olmalı` };

    default:
      // Bilinmeyen bir kod için Zod'un kendi metni kalsın: yanlış bir
      // Türkçe cümle uydurmaktansa özgün mesaj daha yararlıdır.
      return { message: ctx.defaultError };
  }
};

/**
 * Haritayı kurar. `schemas.ts` içe aktarıldığında bir kez çalışır; şemalar
 * bu paketten geçtiği için web, API ve ingest tarafı aynı metinleri görür.
 */
export function useTurkishZodMessages(): void {
  z.setErrorMap(errorMap);
}
