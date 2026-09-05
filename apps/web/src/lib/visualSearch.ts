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

import { gorselAiAcik } from '@ohaaaa/shared';

import { aiAyari } from './ai/config';
import { gorselMetin } from './ai/client';

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

/**
 * Görme modeli yapılandırılmış mı?
 *
 * Sağlayıcı artık seçilebilir, ama bu işlevin SÖZLEŞMESİ değişmedi:
 * `layout.tsx` ve `page.tsx` hâlâ yalnızca bir boolean alıyor ve istemciye
 * inen tek şey o -- anahtarın kendisi değil.
 *
 * Metin aramasından AYRI sorulur: bir işletmeci yalnızca metin aramasını
 * açıp görsel aramayı kapalı tutabilir (görme modeli tanımlamayarak).
 */
export function isVisualSearchConfigured(): boolean {
  return gorselAiAcik(aiAyari());
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
  const ayar = aiAyari();
  if (!gorselAiAcik(ayar)) return { ok: false, reason: 'not_configured' };

  if (!ALLOWED_TYPES.has(mediaType)) return { ok: false, reason: 'unsupported_type' };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' };

  /*
   * İstem bilinçli olarak dar: modelden ürünü SATIN ALINABİLİR biçimde
   * adlandırması isteniyor, tarif etmesi değil. "Siyah, kablosuz, gürültü
   * engelleyici kulaklık" iyi bir tarif ama kötü bir arama terimi; "Sony
   * WH-1000XM5" iyi bir arama terimi.
   *
   * Emin olamadığında marka/model uydurması engelleniyor: uydurulmuş bir
   * model adı, hiç sonuç vermeyen bir aramadan daha kötüdür -- kullanıcı
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

  // Sağlayıcıya özgü her şey `ai/client` içinde; buraya yalnızca metin döner.
  const cevap = await gorselMetin({
    ayar: ayar!,
    prompt,
    bytes,
    mediaType,
    maxTokens: 64,
  });

  /*
   * Modelin reddi de eşleşmeme sayılıyor: kullanıcı açısından ikisi de
   * "bu fotoğraftan ürün çıkmadı" demek ve arayüzün ayrı bir davranışı yok.
   * Arıza (`failed`) ayrı kalıyor -- o bir sistem sorunu.
   */
  if (!cevap.ok) return { ok: false, reason: cevap.reason === 'refused' ? 'no_match' : 'failed' };

  const text = cevap.metin.trim();
  if (!text || /^yok\b/i.test(text)) return { ok: false, reason: 'no_match' };

  // Model kuralı çiğneyip tırnak ya da fazladan satır eklerse temizle.
  const query = text.split('\n')[0]!.replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 120);

  if (!query) return { ok: false, reason: 'no_match' };

  return { ok: true, query, description: text };
}
