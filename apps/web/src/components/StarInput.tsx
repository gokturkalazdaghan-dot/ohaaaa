'use client';

/**
 * Yıldız seçimi.
 *
 * `radiogroup` DEĞİL, gerçek `<input type="radio">` kullanılıyor. Sebebi:
 * radyo grubu tarayıcının kendi klavye davranışını getirir (ok tuşlarıyla
 * gezme, grup içinde tek sekme durağı, form gönderimine katılma). Bunları
 * `div` + `role` ile taklit etmek, hepsini elle ve daha kötü yazmak olurdu.
 *
 * Girişler görsel olarak gizli ama ODAKLANABİLİR: `sr-only` ile kaldırılıp
 * `peer-focus-visible` üzerinden yıldıza halka çiziliyor. `display: none`
 * olsaydı klavyeyle hiç ulaşılamazdı.
 */
import { useState } from 'react';

import { StarIcon } from './Icons';

export function StarInput({
  name,
  label,
  required = false,
  defaultValue,
}: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: number;
}) {
  const [value, setValue] = useState(defaultValue ?? 0);

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium text-muted">{label}</legend>

      <div className="mt-1.5 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <label
            key={star}
            className="cursor-pointer"
            /* Etiket metni ekran okuyucuya gider; görsel olarak yalnızca
               yıldız görünür. "3" demek yetmez, "5 üzerinden 3" demeli. */
          >
            <input
              type="radio"
              name={name}
              value={star}
              required={required && star === 1}
              checked={value === star}
              onChange={() => setValue(star)}
              className="peer sr-only"
            />
            <span className="sr-only">5 üzerinden {star}</span>
            <StarIcon
              aria-hidden="true"
              className={`h-7 w-7 rounded transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand ${
                star <= value ? 'text-brand' : 'text-subtle opacity-40'
              }`}
            />
          </label>
        ))}

        {/* Seçim RENKTEN bağımsız olarak da okunabilmeli. */}
        <span className="ml-2 text-sm text-muted" aria-hidden="true">
          {value > 0 ? `${value}/5` : 'Seçilmedi'}
        </span>
      </div>
    </fieldset>
  );
}
