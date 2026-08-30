/**
 * POST /api/gorsel-arama — fotoğraftan arama terimi üretir.
 *
 * İstemci önce barkod dener; barkod bulunamazsa fotoğraf buraya gelir.
 * Yanıt bir ARAMA TERİMİdir, bir ürün değil: model tahmini kesinmiş gibi
 * sunulmaz, kullanıcı sonuçları kendisi görür.
 */

import {
  MAX_IMAGE_BYTES,
  describeProductImage,
  isVisualSearchConfigured,
} from '@/lib/visualSearch';

export const dynamic = 'force-dynamic';

/**
 * Reddedilme sebebine karşılık gelen kullanıcı mesajı.
 *
 * Mesajlar kullanıcıya NE YAPACAĞINI söyler. "Bir hata oluştu" demek,
 * arama kutusunun önünde duran birine hiçbir şey söylememektir.
 */
const REASON_MESSAGE: Record<string, string> = {
  not_configured: 'Görselle arama şu an kapalı. Ürün adını yazarak arayabilirsiniz.',
  unsupported_type: 'Bu dosya türü desteklenmiyor. JPEG, PNG veya WebP gönderin.',
  too_large: 'Fotoğraf çok büyük. 5 MB altında bir görsel gönderin.',
  no_match: 'Fotoğrafta tanıyabildiğimiz bir ürün yok. Ürün adını yazmayı deneyin.',
  failed: 'Görsel şu an işlenemedi. Ürün adını yazarak arayabilirsiniz.',
};

const REASON_STATUS: Record<string, number> = {
  not_configured: 503,
  unsupported_type: 415,
  too_large: 413,
  no_match: 404,
  failed: 502,
};

export async function POST(request: Request): Promise<Response> {
  // Yapılandırma yoksa dosyayı hiç okumadan çık: 5 MB'ı boşuna almanın anlamı yok.
  if (!isVisualSearchConfigured()) {
    return Response.json(
      { error: { code: 'not_configured', message: REASON_MESSAGE.not_configured } },
      { status: 503 },
    );
  }

  let file: File | null = null;

  try {
    const form = await request.formData();
    const value = form.get('gorsel');
    if (value instanceof File) file = value;
  } catch {
    return Response.json(
      { error: { code: 'invalid_body', message: 'Görsel okunamadı.' } },
      { status: 400 },
    );
  }

  if (!file) {
    return Response.json(
      { error: { code: 'invalid_body', message: "'gorsel' alanı gerekli." } },
      { status: 400 },
    );
  }

  // Boyut kontrolü okumadan ÖNCE: belleğe almadan reddet.
  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json(
      { error: { code: 'too_large', message: REASON_MESSAGE.too_large } },
      { status: 413 },
    );
  }

  const result = await describeProductImage(await file.arrayBuffer(), file.type);

  if (!result.ok) {
    return Response.json(
      {
        error: {
          code: result.reason,
          message: REASON_MESSAGE[result.reason] ?? REASON_MESSAGE.failed,
        },
      },
      { status: REASON_STATUS[result.reason] ?? 502 },
    );
  }

  return Response.json({ data: { query: result.query } });
}
