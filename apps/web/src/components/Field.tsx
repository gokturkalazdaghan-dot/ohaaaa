/**
 * Form alanı — etiket, girdi, ipucu ve hata metnini birlikte kurar.
 *
 * NEDEN TEK BİR BİLEŞEN
 * Bu bileşenin DÖRT ayrı kopyası vardı: taşeron başvurusu, iletişim,
 * ödeme ve giriş formlarında. Kopyalar zaten ayrışmıştı ve aynı kusurları
 * bağımsız olarak taşıyorlardı:
 *
 *   • Hata YALNIZCA kırmızı kenarlıkla anlatılıyordu. `aria-invalid` yoktu:
 *     rengi ayırt edemeyen bir kullanıcı için alan sağlamdan farksızdı
 *     (WCAG 1.4.1 ve 3.3.1).
 *   • `aria-describedby` yoktu. `role="alert"` metni belirdiği anda BİR KEZ
 *     okunur; kullanıcı sonradan alana geri sekerse hatayı bir daha duymaz.
 *     İpucu metni ise ekran okuyucuya HİÇ ulaşmıyordu.
 *   • Üç kopyada `multiline` dalı `{...rest}`'i DÜŞÜRÜYORDU: çok satırlı bir
 *     alana verilen hiçbir öznitelik uygulanmıyor, sessizce yutuluyordu.
 *
 * Dört kopyayı tek tek yamamak, dördüncüsünü yazacak kişiye hiçbir şey
 * öğretmezdi. Kusurun kaynağı kopya olmasıydı.
 */

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  /*
   * Alanın DOM kimliği. Varsayılan olarak `name` kullanılır; ancak aynı
   * sayfada aynı adı taşıyan birden çok form varsa (her siparişe bir
   * değerlendirme formu gibi) kimlikler çakışır ve `<label for>` bağı
   * bozulur — ekran okuyucu yanlış alanı okur. O durumda benzersiz bir
   * kimlik verilir; gönderilen alan ADI değişmez.
   */
  inputId?: string;
  /** Sunucudan ya da şemadan gelen hata metni. */
  error?: string;
  /** Hata yokken gösterilen yardım metni. */
  hint?: string;
  /** Girdinin soluna yapışan sabit metin (örn. "ohaaaa.com/magaza/"). */
  prefix?: string;
  multiline?: boolean;
  /** Verilirse `<select>` çizilir; içeriği `<option>` listesidir. */
  options?: ReactNode;
  /** Dış kapsayıcıya uygulanır (ızgara sütunu vb.), girdiye değil. */
  wrapperClassName?: string;
  rows?: number;
}

export function Field({
  label,
  name,
  inputId,
  error,
  hint,
  prefix,
  multiline = false,
  options,
  wrapperClassName = '',
  rows,
  type = 'text',
  required = false,
  ...rest
}: FieldProps) {
  const fieldId = inputId ?? name;
  const errorId = `${fieldId}-hata`;
  const hintId = `${fieldId}-ipucu`;

  /* Hata varken hatayı, yokken ipucunu bağlar. İkisini birden bağlamak,
     hata anında kullanıcıya iki metni arka arkaya okuturdu. */
  const describedBy = error ? errorId : hint ? hintId : undefined;

  const control = `w-full bg-bg text-sm text-fg outline-none transition-colors placeholder:text-subtle ${
    prefix ? 'rounded-r-xl px-3 py-2.5' : 'rounded-xl px-3.5 py-2.5'
  }`;

  /*
   * Erişilebilirlik öznitelikleri TEK yerde kurulur ve her dala aynı
   * şekilde geçer. Dal başına tekrar yazmak, tam da bu kopyaların
   * ayrışmasına yol açan şeydi.
   */
  const shared = {
    id: fieldId,
    name,
    required,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': describedBy,
    className: control,
  };

  return (
    <div className={wrapperClassName}>
      <label htmlFor={fieldId} className="text-xs font-medium text-muted">
        {label}
      </label>

      <div
        className={`mt-1.5 flex overflow-hidden rounded-xl border transition-colors focus-within:border-brand ${
          error ? 'border-danger' : 'border-line'
        }`}
      >
        {prefix && (
          <span className="shrink-0 bg-surface-2 px-3 py-2.5 font-mono text-xs text-subtle">
            {prefix}
          </span>
        )}

        {options ? (
          <select {...shared} {...(rest as SelectHTMLAttributes<HTMLSelectElement>)}>
            {options}
          </select>
        ) : multiline ? (
          <textarea
            {...shared}
            rows={rows ?? 4}
            {...(rest as unknown as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          />
        ) : (
          <input {...shared} type={type} {...rest} />
        )}
      </div>

      {error ? (
        <p id={errorId} className="mt-1 text-2xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-2xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
