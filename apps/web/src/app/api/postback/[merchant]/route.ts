/**
 * POST /api/postback/:merchant — ortaklık ağından dönüşüm bildirimi.
 *
 * Bu uç nokta GELİRİN KAYDEDİLDİĞİ yerdir. Üç şey kritiktir:
 *
 *   1. İMZA DOĞRULAMA. Doğrulanmamış bir postback uç noktası, herkesin
 *      "bana 50.000 TL komisyon yaz" diyebildiği bir formdur. Raporlar
 *      kirlenir, ağla yapılan mutabakat çöker.
 *
 *   2. İDEMPOTENTLİK. Ağlar aynı satışı defalarca bildirir (onay, iptal,
 *      düzeltme). Her bildirim yeni satır açsaydı ciro katlanırdı.
 *      `record_conversion` bunu (merchant_id, network_order_id) üzerinden
 *      çözer.
 *
 *   3. DOĞRU AĞ. Hangi doğrulama ve hangi alan eşlemesinin uygulanacağı
 *      `merchants.network` sütununa bakılarak SAĞLAYICI KAYDINDAN seçilir.
 *      Bilinmeyen bir ağ varsayılana düşürülmez — sessizce yanlış şemayla
 *      doğrulamak, doğrulamamakla aynı kapıya çıkar.
 *
 * Ağa özgü her şey (imza şeması, alan adları) `@ohaaaa/shared/providers`
 * altındadır; bu dosya yalnızca akışı yürütür.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { ProviderError, getProvider } from '@ohaaaa/shared/providers';

import { getServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ merchant: string }> },
) {
  const { merchant: merchantSlug } = await context.params;

  // Ham gövde İMZA İÇİN gereklidir: JSON.parse edilip yeniden
  // serileştirilirse baytlar değişir ve imza tutmaz.
  const rawBody = await request.text();

  const supabase = getServiceClient();

  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('id, slug, status, network, postback_secret')
    .eq('slug', merchantSlug)
    .maybeSingle();

  if (merchantError) {
    return json({ error: { code: 'internal_error', message: 'Mağaza okunamadı.' } }, 500);
  }

  if (!merchant) {
    return json({ error: { code: 'not_found', message: 'Mağaza bulunamadı.' } }, 404);
  }

  // Sırrı tanımlanmamış bir mağaza için postback KABUL EDİLMEZ.
  // "Şimdilik doğrulamayı atlayalım" kararı, kalıcı bir açık hâline gelir.
  if (!merchant.postback_secret) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Postback sırrı tanımsız — bildirim reddedildi',
        merchant: merchantSlug,
      }),
    );

    return json(
      { error: { code: 'forbidden', message: 'Bu mağaza için doğrulama yapılandırılmamış.' } },
      403,
    );
  }

  /*
   * SAĞLAYICI SEÇİMİ.
   *
   * Bilinmeyen ağ 503'tür, 400 değil: hata bildirimi gönderende değil,
   * bizim yapılandırmamızdadır. 5xx ağın yeniden denemesini sağlar; ağ
   * tanımlandıktan sonra aynı bildirim başarıyla işlenir ve satış kaybolmaz.
   */
  let provider;
  try {
    provider = getProvider(merchant.network);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Saglayici secilemedi — bildirim islenmedi',
        merchant: merchantSlug,
        network: merchant.network,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    return json(
      {
        error: {
          code: 'provider_unavailable',
          message: 'Bu mağazanın ortaklık ağı yapılandırılmamış.',
        },
      },
      503,
    );
  }

  /*
   * DOĞRULAMA.
   *
   * İki başarısızlık türü AYRI yanıt alır:
   *   • imza yanlış                → 401 (gönderen hatalı)
   *   • şema henüz bilinmiyor      → 503 (biz hazır değiliz, tekrar dene)
   * Aynı yanıtı vermek, açılmamış bir entegrasyonu saldırı gibi gösterirdi.
   */
  let verified: boolean;
  try {
    verified = provider.verifyPostback({
      rawBody,
      headers: request.headers,
      secret: String(merchant.postback_secret),
    });
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'verification_unavailable') {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'Ag dogrulamasi henuz yapilandirilmadi',
          merchant: merchantSlug,
          network: provider.network,
          error: error.message,
        }),
      );

      return json(
        {
          error: {
            code: 'provider_unavailable',
            message: 'Bu ağ için doğrulama henüz yapılandırılmadı.',
          },
        },
        503,
      );
    }

    throw error;
  }

  if (!verified) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Geçersiz postback imzası',
        merchant: merchantSlug,
        network: provider.network,
      }),
    );

    return json({ error: { code: 'unauthorized', message: 'İmza doğrulanamadı.' } }, 401);
  }

  // Ayrıştırma DOĞRULAMADAN SONRA: doğrulanmamış gövdeyi ayrıştırmak,
  // saldırganın belirlediği veriyi ortak modele sokmak demektir.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: { code: 'validation_failed', message: 'Geçersiz JSON.' } }, 400);
  }

  let normalized;
  try {
    normalized = provider.normalizePostback(payload);
  } catch (error) {
    if (error instanceof ProviderError) {
      if (error.code === 'verification_unavailable') {
        return json(
          {
            error: {
              code: 'provider_unavailable',
              message: 'Bu ağ için alan eşlemesi henüz yapılandırılmadı.',
            },
          },
          503,
        );
      }

      return json(
        { error: { code: 'validation_failed', message: error.message } },
        422,
      );
    }

    throw error;
  }

  const { data, error } = await supabase.rpc('record_conversion', {
    p_merchant_id: merchant.id,
    p_network_order_id: normalized.orderId,
    p_subid: normalized.subid,
    p_status: normalized.status,
    p_order_total_cents: normalized.orderTotalCents,
    p_commission_cents: normalized.commissionCents,
    p_currency: normalized.currency,
    p_occurred_at: normalized.occurredAt,
    p_raw: payload,
  });

  if (error) {
    /*
     * ATIF REDDİ (OH409) GEÇİCİ BİR ARIZA DEĞİLDİR.
     *
     * `record_conversion`, bildirilen subid başka bir mağazanın tıklamasına
     * aitse dönüşümü hiç oluşturmaz. Bunu 5xx ile yanıtlamak ağın aynı
     * bildirimi sonsuza kadar yeniden denemesine yol açardı — oysa sonuç
     * her denemede aynı olacak. 409 "bunu tekrar gönderme" demektir.
     */
    if (error.code === 'OH409') {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'Capraz magaza atif denemesi reddedildi',
          merchant: merchantSlug,
          order_id: normalized.orderId,
        }),
      );

      return json(
        {
          error: {
            code: 'attribution_conflict',
            message: 'Bildirilen subid bu mağazaya ait değil.',
          },
        },
        409,
      );
    }

    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Dönüşüm kaydedilemedi',
        merchant: merchantSlug,
        order_id: normalized.orderId,
        error: error.message,
      }),
    );

    // 5xx döndürmek önemlidir: ağlar başarısız postback'i tekrar dener.
    // 200 dönersek satış kalıcı olarak kaybolur.
    return json({ error: { code: 'internal_error', message: 'Kaydedilemedi.' } }, 500);
  }

  const conversion = data as { id: string; click_id: string | null } | null;

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'Dönüşüm kaydedildi',
      merchant: merchantSlug,
      network: provider.network,
      order_id: normalized.orderId,
      status: normalized.status,
      attributed: Boolean(conversion?.click_id),
    }),
  );

  return json({ data: { received: true, attributed: Boolean(conversion?.click_id) } }, 200);
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
