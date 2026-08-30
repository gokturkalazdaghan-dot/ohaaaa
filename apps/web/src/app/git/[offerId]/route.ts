/**
 * GET /git/:offerId — ortak mağazaya yönlendirme (para yolu).
 *
 * Akış:
 *   1. Teklifi ve mağazasını veritabanından oku
 *   2. Tıklama kimliği (subid) üret
 *   3. Yönlendirme adresini şablondan kur ve İZİNLİ ALAN ADINA karşı doğrula
 *   4. Tıklamayı kaydet (subid → dönüşüm eşleştirmesinin tek bağı)
 *   5. 302 ile yönlendir
 *
 * GÜVENLİK — AÇIK YÖNLENDİRME:
 * Hedef adres HİÇBİR ZAMAN istekten okunmaz. Yalnızca `offerId` alınır ve
 * adres veritabanındaki kayıttan türetilir. Kullanıcı `?url=` benzeri bir
 * parametreyle hedefi etkileyemez. `buildAffiliateUrl` ayrıca sonucu
 * mağazanın izinli alan adlarıyla karşılaştırır.
 *
 * GİZLİLİK (KVKK):
 * IP ve user-agent ham saklanmaz. Günlük dönen bir tuzla özetlenir; böylece
 * aynı gün içinde tekilleştirme yapılabilir ama günler arası kullanıcı takibi
 * mümkün olmaz.
 */

import { createHash, randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

import {
  AffiliateLinkError,
  allowedHostsForMerchant,
  buildAffiliateUrl,
  generateSubId,
} from '@ohaaaa/shared/affiliate';

import { isSupabaseConfigured } from '@/lib/env';
import { demoMerchants, demoProductGroups } from '@/data/demo';

/** Yönlendirme daima anlık hesaplanır; önbelleğe alınamaz (subid tekildir). */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await context.params;
  const subid = generateSubId();

  try {
    const resolved = isSupabaseConfigured()
      ? await resolveFromDatabase(offerId)
      : resolveFromDemo(offerId);

    if (!resolved) {
      return errorPage('Ürün bulunamadı veya artık satışta değil.', 404);
    }

    const targetUrl = buildAffiliateUrl({
      template: resolved.deeplinkTemplate,
      productUrl: resolved.productUrl,
      trackingId: resolved.trackingId,
      subid,
      allowedHosts: allowedHostsForMerchant({
        homepageUrl: resolved.homepageUrl,
        deeplinkTemplate: resolved.deeplinkTemplate,
      }),
    });

    // Tıklama kaydı yönlendirmeyi BEKLETMEMELİ ama KAYBOLMAMALI da.
    // Kayıt başarısız olursa atıf kaybedilir (para kaybı), bu yüzden
    // beklenir — ama kısa bir zaman aşımıyla.
    await recordClick({
      offerId,
      subid,
      request,
      priceCents: resolved.priceCents,
    });

    // 302 (kalıcı değil): şablon veya mağaza değişebilir, tarayıcı
    // önbelleğe almamalı.
    return NextResponse.redirect(targetUrl, {
      status: 302,
      headers: {
        'cache-control': 'no-store, private',
        // Hedef siteye hangi ürün sayfasından geldiğini sızdırmayalım.
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (error) {
    if (error instanceof AffiliateLinkError) {
      // Yapılandırma hatası: sessizce yönlendirmek yerine görünür kılıyoruz.
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'Yönlendirme linki üretilemedi',
          offer_id: offerId,
          code: error.code,
          error: error.message,
        }),
      );

      return errorPage(
        'Bu ürün için yönlendirme şu anda yapılamıyor. Mağaza ayarları kontrol ediliyor.',
        503,
      );
    }

    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Yönlendirme başarısız',
        offer_id: offerId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    return errorPage('Beklenmeyen bir hata oluştu.', 500);
  }
}

interface ResolvedOffer {
  productUrl: string;
  deeplinkTemplate: string;
  trackingId: string | null;
  homepageUrl: string;
  priceCents: number;
}

async function resolveFromDatabase(offerId: string): Promise<ResolvedOffer | null> {
  // service_role: merchants.tracking_id ve deeplink_template herkese açık
  // değildir; anon istemciyle okunamaz.
  const { getServiceClient } = await import('@/lib/supabase/service');
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('products')
    .select(
      `id, product_url, price_cents, status, fulfillment,
       merchant:merchants!inner ( status, homepage_url, deeplink_template, tracking_id )`,
    )
    .eq('id', offerId)
    .eq('fulfillment', 'affiliate')
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw new Error(`Teklif okunamadı: ${error.message}`);
  if (!data) return null;

  const rawMerchant = (data as Record<string, unknown>).merchant;
  const merchant = (Array.isArray(rawMerchant) ? rawMerchant[0] : rawMerchant) as
    | Record<string, unknown>
    | null;

  if (!merchant || merchant.status !== 'active') return null;
  if (!data.product_url || !merchant.deeplink_template) return null;

  return {
    productUrl: String(data.product_url),
    deeplinkTemplate: String(merchant.deeplink_template),
    trackingId: merchant.tracking_id ? String(merchant.tracking_id) : null,
    homepageUrl: String(merchant.homepage_url),
    priceCents: Number(data.price_cents),
  };
}

/** Demo modunda gerçek bir mağaza yoktur; akış yine uçtan uca denenebilir. */
function resolveFromDemo(offerId: string): ResolvedOffer | null {
  for (const group of demoProductGroups) {
    const offer = group.offers.find((candidate) => candidate.id === offerId);
    if (!offer || offer.fulfillment !== 'affiliate' || !offer.productUrl) continue;

    const merchant = demoMerchants.find((m) => m.id === offer.merchantId);
    if (!merchant) continue;

    return {
      productUrl: offer.productUrl,
      deeplinkTemplate: '{url}?ref={tracking_id}&subid={subid}',
      trackingId: 'ohaaaa-demo',
      homepageUrl: merchant.homepageUrl,
      priceCents: offer.priceCents,
    };
  }

  return null;
}

async function recordClick(input: {
  offerId: string;
  subid: string;
  request: NextRequest;
  priceCents: number;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const { getServiceClient } = await import('@/lib/supabase/service');
    const supabase = getServiceClient();

    const headers = input.request.headers;
    const salt = dailySalt();

    const ip =
      headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headers.get('x-real-ip') ??
      null;

    const userAgent = headers.get('user-agent');

    const { error } = await supabase.rpc('record_click', {
      p_product_id: input.offerId,
      p_subid: input.subid,
      p_session_id: input.request.cookies.get('ohaaaa_sid')?.value ?? null,
      p_ip_hash: ip ? hashWithSalt(ip, salt) : null,
      p_ua_hash: userAgent ? hashWithSalt(userAgent, salt) : null,
      p_referrer: headers.get('referer'),
      p_placement: input.request.nextUrl.searchParams.get('k') ?? 'product_page',
      p_device: detectDevice(userAgent),
    });

    if (error) {
      // Yönlendirmeyi ENGELLEMEZ: kullanıcının alışverişi, bizim
      // telemetrimizden önemlidir. Ama sessiz de kalmaz.
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'Tıklama kaydedilemedi — atıf kaybı riski',
          offer_id: input.offerId,
          subid: input.subid,
          error: error.message,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Tıklama kaydı çöktü',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Günlük dönen tuz.
 *
 * Sabit bir tuz, IP özetlerini kalıcı bir kullanıcı kimliğine çevirirdi.
 * Günlük döndürmek, aynı gün içindeki tekilleştirmeyi korurken günler arası
 * takibi imkânsız kılar.
 */
function dailySalt(): string {
  const secret = process.env.CLICK_HASH_SECRET ?? 'ohaaaa-varsayilan-tuz';
  return `${secret}:${new Date().toISOString().slice(0, 10)}`;
}

function hashWithSalt(value: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32);
}

function detectDevice(userAgent: string | null): string {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/mobile|android|iphone/.test(ua)) return 'mobile';
  return 'desktop';
}

/** Yönlendirilemeyen durumlarda kullanıcıya açıklama gösterilir. */
function errorPage(message: string, status: number): NextResponse {
  const requestId = randomUUID();

  return new NextResponse(
    `<!doctype html><html lang="tr"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Yönlendirme yapılamadı · Ohaaaa</title>
     <style>
       body{font-family:system-ui,sans-serif;background:#0a0a0c;color:#f4f4f7;
            display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
       .box{max-width:28rem;text-align:center}
       a{color:#c084fc}
       code{color:#6b6b7c;font-size:12px}
     </style></head>
     <body><div class="box">
       <h1 style="font-size:20px">Yönlendirme yapılamadı</h1>
       <p style="color:#9a9aab;line-height:1.6">${escapeHtml(message)}</p>
       <p><a href="/">Ana sayfaya dön</a></p>
       <p><code>${requestId}</code></p>
     </div></body></html>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    },
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
