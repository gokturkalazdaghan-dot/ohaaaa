/**
 * Tek biçimli API hata modeli.
 *
 * Taşeronlar entegrasyonlarını `code` alanına göre kurar; bu yüzden kodlar
 * sözleşmenin parçasıdır ve geriye dönük uyumluluk gözetilmeden
 * değiştirilmemelidir. `message` insan içindir, `details` ise hata ayıklama.
 */

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'rate_limited'
  | 'conflict'
  | 'payload_too_large'
  | 'internal_error'
  | 'service_unavailable';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  rate_limited: 429,
  conflict: 409,
  payload_too_large: 413,
  internal_error: 500,
  service_unavailable: 503,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  toJSON(requestId?: string) {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
        ...(requestId ? { request_id: requestId } : {}),
      },
    };
  }
}

export const unauthorized = (message = 'Geçerli bir API anahtarı gerekli') =>
  new ApiError('unauthorized', message);

export const forbidden = (message = 'Bu işlem için yetkiniz yok') =>
  new ApiError('forbidden', message);

export const notFound = (message = 'Kayıt bulunamadı') => new ApiError('not_found', message);

export const validationFailed = (message: string, details?: unknown) =>
  new ApiError('validation_failed', message, details);

export const conflict = (message: string, details?: unknown) =>
  new ApiError('conflict', message, details);
