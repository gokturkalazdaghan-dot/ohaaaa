import 'server-only';

/**
 * SAĞLAYICI SÖZLEŞMESİ — iki işlem, iki biçim.
 *
 * Bu katman metin döndürür, nesne değil. Sebep önemli: ayrıştırma ve
 * DOĞRULAMA çağıranda kalsın diye. `searchIntent` gelen metni Zod ile
 * doğruluyor ve son söz onun; bu katman araya girip "nesne" döndürseydi,
 * sağlayıcı değiştirmek doğrulama zincirine dokunmak anlamına gelirdi.
 *
 * Yani buradaki tek vaat: "modele sordum, dönen metin bu". Metnin anlamlı
 * olup olmadığına çağıran karar verir ve bu karar sağlayıcıdan bağımsızdır.
 *
 * RED (refusal) NORMALLEŞTİRİLİR. Her sağlayıcı reddi farklı bildiriyor:
 * Anthropic `stop_reason: 'refusal'`, OpenAI-uyumlu uçlar
 * `finish_reason: 'content_filter'` ya da `message.refusal`. Çağıranın bunu
 * bilmesi gerekmiyor; tek bir `refused` sebebine indiriliyor. Ayrım korunuyor
 * çünkü "model reddetti" ile "istek başarısız" farklı olaylar: birincisi
 * beklenen bir sonuç, ikincisi bir arıza.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { AiAyari } from '@ohaaaa/shared';

export type AiCevap =
  | { ok: true; metin: string }
  | { ok: false; reason: 'refused' | 'failed' };

/** Kullanıcı bir arama kutusunun önünde bekliyor; süresiz beklemek yok. */
const ZAMAN_ASIMI_MS = 20_000;

function hataYaz(msg: string, error: unknown): void {
  // Ayar nesnesi LOGLANMAZ: içinde anahtar var.
  console.error(
    JSON.stringify({
      level: 'error',
      msg,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

// ---------------------------------------------------------------------------
// Yapısal metin (arama niyeti)
// ---------------------------------------------------------------------------

export interface YapisalIstek {
  ayar: AiAyari;
  sistem: string;
  kullaniciMetni: string;
  jsonSemasi: Record<string, unknown>;
  semaAdi: string;
  maxTokens: number;
}

export async function yapisalMetin(istek: YapisalIstek): Promise<AiCevap> {
  const model = istek.ayar.aramaModeli;
  if (!model) return { ok: false, reason: 'failed' };

  return istek.ayar.saglayici === 'anthropic'
    ? anthropicYapisal(istek, model)
    : openAiYapisal(istek, model);
}

async function anthropicYapisal(istek: YapisalIstek, model: string): Promise<AiCevap> {
  const client = new Anthropic({ apiKey: istek.ayar.apiKey, baseURL: istek.ayar.baseUrl });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: istek.maxTokens,
      system: istek.sistem,
      // Kullanıcı metni kendi bloğunda ve sınırları işaretli: modelin
      // sistem istemiyle veriyi karıştırmasını zorlaştırır.
      messages: [
        { role: 'user', content: `<kullanici_metni>\n${istek.kullaniciMetni}\n</kullanici_metni>` },
      ],
      /*
       * Şema YALNIZCA `json_schema` modunda gönderilir. Diğer modlarda
       * model serbest üretir ve doğrulamayı Zod yapar -- yani en kötü
       * durumda bugünkü güvenlik seviyesindeyiz, altında değil.
       */
      ...(istek.ayar.jsonModu === 'json_schema'
        ? { output_config: { format: { type: 'json_schema' as const, schema: istek.jsonSemasi } } }
        : {}),
    });

    /*
     * Güvenlik sınıflandırıcısı isteği reddedebilir (HTTP 200 ama
     * stop_reason 'refusal'). İçeriği okumadan ÖNCE bakılır; aksi hâlde
     * boş içerik "anlaşılmadı" gibi görünür ve gerçek sebep kaybolur.
     */
    if (response.stop_reason === 'refusal') return { ok: false, reason: 'refused' };

    const blok = response.content.find((b) => b.type === 'text');
    if (!blok || blok.type !== 'text') return { ok: false, reason: 'failed' };

    return { ok: true, metin: blok.text };
  } catch (error) {
    hataYaz('AI yapısal isteği başarısız (anthropic)', error);
    return { ok: false, reason: 'failed' };
  }
}

async function openAiYapisal(istek: YapisalIstek, model: string): Promise<AiCevap> {
  const govde: Record<string, unknown> = {
    model,
    max_tokens: istek.maxTokens,
    messages: [
      { role: 'system', content: istek.sistem },
      { role: 'user', content: `<kullanici_metni>\n${istek.kullaniciMetni}\n</kullanici_metni>` },
    ],
  };

  if (istek.ayar.jsonModu === 'json_schema') {
    govde.response_format = {
      type: 'json_schema',
      json_schema: { name: istek.semaAdi, strict: true, schema: istek.jsonSemasi },
    };
  } else if (istek.ayar.jsonModu === 'json_object') {
    govde.response_format = { type: 'json_object' };
  }

  return openAiIstek(istek.ayar, govde, 'AI yapısal isteği başarısız (openai-uyumlu)');
}

// ---------------------------------------------------------------------------
// Görsel açıklama
// ---------------------------------------------------------------------------

export interface GorselIstek {
  ayar: AiAyari;
  prompt: string;
  bytes: ArrayBuffer;
  mediaType: string;
  maxTokens: number;
}

export async function gorselMetin(istek: GorselIstek): Promise<AiCevap> {
  const model = istek.ayar.gorselModeli;
  if (!model) return { ok: false, reason: 'failed' };

  const base64 = Buffer.from(istek.bytes).toString('base64');

  return istek.ayar.saglayici === 'anthropic'
    ? anthropicGorsel(istek, model, base64)
    : openAiGorsel(istek, model, base64);
}

async function anthropicGorsel(
  istek: GorselIstek,
  model: string,
  base64: string,
): Promise<AiCevap> {
  try {
    const response = await fetch(`${istek.ayar.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': istek.ayar.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: istek.maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: istek.mediaType, data: base64 },
              },
              { type: 'text', text: istek.prompt },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(ZAMAN_ASIMI_MS),
    });

    if (!response.ok) {
      // Durum kodu loglanır, gövde DEĞİL: gövde istem metnini yankılayabilir.
      console.error(
        JSON.stringify({ level: 'error', msg: 'Görsel model hata döndü', status: response.status }),
      );
      return { ok: false, reason: 'failed' };
    }

    const payload = (await response.json()) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
    };

    if (payload.stop_reason === 'refusal') return { ok: false, reason: 'refused' };

    const metin = (payload.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join(' ')
      .trim();

    return { ok: true, metin };
  } catch (error) {
    hataYaz('Görsel istek başarısız (anthropic)', error);
    return { ok: false, reason: 'failed' };
  }
}

async function openAiGorsel(
  istek: GorselIstek,
  model: string,
  base64: string,
): Promise<AiCevap> {
  return openAiIstek(
    istek.ayar,
    {
      model,
      max_tokens: istek.maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: istek.prompt },
            // OpenAI-uyumlu uçlar görseli data URI olarak bekler.
            {
              type: 'image_url',
              image_url: { url: `data:${istek.mediaType};base64,${base64}` },
            },
          ],
        },
      ],
    },
    'Görsel istek başarısız (openai-uyumlu)',
  );
}

// ---------------------------------------------------------------------------
// OpenAI-uyumlu ortak istek
// ---------------------------------------------------------------------------

async function openAiIstek(
  ayar: AiAyari,
  govde: Record<string, unknown>,
  hataMesaji: string,
): Promise<AiCevap> {
  try {
    const response = await fetch(`${ayar.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ayar.apiKey}`,
      },
      body: JSON.stringify(govde),
      signal: AbortSignal.timeout(ZAMAN_ASIMI_MS),
    });

    if (!response.ok) {
      console.error(
        JSON.stringify({ level: 'error', msg: hataMesaji, status: response.status }),
      );
      return { ok: false, reason: 'failed' };
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string | null; refusal?: string | null };
      }>;
    };

    const secim = payload.choices?.[0];
    if (!secim) return { ok: false, reason: 'failed' };

    /*
     * İki ayrı red biçimi: yapısal çıktıda `message.refusal`, içerik
     * süzgecinde `finish_reason`. İkisi de "model üretmeyi reddetti"
     * demek ve arıza DEĞİL -- bu yüzden `failed` ile karıştırılmıyor.
     */
    if (secim.message?.refusal) return { ok: false, reason: 'refused' };
    if (secim.finish_reason === 'content_filter') return { ok: false, reason: 'refused' };

    const metin = (secim.message?.content ?? '').trim();
    if (!metin) return { ok: false, reason: 'failed' };

    return { ok: true, metin };
  } catch (error) {
    hataYaz(hataMesaji, error);
    return { ok: false, reason: 'failed' };
  }
}
