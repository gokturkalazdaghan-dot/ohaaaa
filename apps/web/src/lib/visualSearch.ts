/**
 * Görsel arama — fotoğraftan ürün tanıma.
 *
 * AKIŞ (istemciden sunucuya)
 *   1. Tarayıcı önce BARKOD arar (BarcodeDetector). Barkod bulunursa buraya
 *      hiç gelinmez: barkod küresel olarak benzersizdir, en güvenilir eşleşme
 *      odur ve ücretsizdir.
 *   2. Barkod yoksa fotoğraf buraya gelir ve bir görme modeline sorulur.
 *
 * NEDEN MODEL SONUCU DOĞRUDAN ÜRÜNE BAĞLANMIYOR?
 * Model "bu bir Sony WH-1000XM5" dediğinde bu bir TAHMİNDİR. Tahmini doğrudan
 * bir ürün sayfasına çevirmek, kullanıcıya yanlış ürünü kesinmiş gibi
 * göstermek olurdu. Bunun yerine model yalnızca ARAMA TERİMİ üretir; terim
 * normal aramadan geçer ve kullanıcı sonuçları kendisi görür. Yanlış tahmin
 * en kötü ihtimalle alakasız bir sonuç listesi verir, yanlış bir satın alma
 * değil.
 */

import 'server-only';

/** Desteklenen görsel türleri. Model tarafının kabul ettiği kümeyle aynı. */
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Boyut tavanı.
 *
 * Telefon kamerası 8-12 MB'lık dosyalar üretebilir; istemci küçültme yapar
 * ama ona güvenilmez — sınır sunucuda da olmalı.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type VisualSearchResult =
  | { ok: true; query: string; description: string }
  | { ok: false; reason: 'not_configured' | 'unsupported_type' | 'too_large' | 'no_match' | 'failed' };

/** Görme modeli yapılandırılmış mı? */
export function isVisualSearchConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * Modelden aranacak terimi çıkarır.
 *
 * Yanıt sade metin olarak istenir; JSON ayrıştırma bir hata yüzeyi daha
 * açardı ve tek satırlık bir çıktı için gereksiz.
 */
export async function describeProductImage(
  bytes: ArrayBuffer,
  mediaType: string,
): Promise<VisualSearchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: 'not_configured' };

  if (!ALLOWED_TYPES.has(mediaType)) return { ok: false, reason: 'unsupported_type' };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' };

  const model = process.env.VISUAL_SEARCH_MODEL?.trim() || 'claude-haiku-4-5-20251001';

  /*
   * İstem bilinçli olarak dar: modelden ürünü SATIN ALINABİLİR biçimde
   * adlandırması isteniyor, tarif etmesi değil. "Siyah, kablosuz, gürültü
   * engelleyici kulaklık" iyi bir tarif ama kötü bir arama terimi; "Sony
   * WH-1000XM5" iyi bir arama terimi.
   *
   * Emin olamadığında marka/model uydurması engelleniyor: uydurulmuş bir
   * model adı, hiç sonuç vermeyen bir aramadan daha kötüdür — kullanıcı
   * ürünün katalogda olmadığını değil, aramanın bozuk olduğunu düşünür.
   */
  const prompt = [
    'Bu fotoğraftaki ürünü bir alışveriş sitesinde aratacak şekilde adlandır.',
    '',
    'Kurallar:',
    '- Yalnızca arama terimini yaz. Açıklama, noktalama ya da tırnak ekleme.',
    '- Marka ve model fotoğrafta OKUNABİLİYORSA yaz. Okunamıyorsa YAZMA, uydurma.',
    '- Marka okunamıyorsa ürün türünü ve ayırt edici özelliklerini yaz.',
    '- Türkçe yaz. En fazla 8 kelime.',
    '- Fotoğrafta satın alınabilir bir ürün yoksa yalnızca YOK yaz.',
  ].join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 64,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: Buffer.from(bytes).toString('base64'),
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
      // Kullanıcı bir arama kutusunun önünde bekliyor: yanıt gelmiyorsa
      // süresiz beklemek yerine hızlıca "olmadı" demek daha iyi.
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'Görsel arama modeli hata döndü',
          status: response.status,
        }),
      );
      return { ok: false, reason: 'failed' };
    }

    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join(' ')
      .trim();

    if (!text || /^yok\b/i.test(text)) return { ok: false, reason: 'no_match' };

    // Model kuralı çiğneyip tırnak ya da fazladan satır eklerse temizle.
    const query = text.split('\n')[0]!.replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 120);

    if (!query) return { ok: false, reason: 'no_match' };

    return { ok: true, query, description: text };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Görsel arama isteği başarısız',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, reason: 'failed' };
  }
}
