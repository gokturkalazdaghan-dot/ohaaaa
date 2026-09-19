/**
 * GET /api/cron/donusum-esitle — Awin dönüşümlerini ağın raporundan çeker.
 *
 * KİM ÇAĞIRIR
 * Vercel Cron (bkz. apps/web/vercel.json). Vercel zamanlanmış isteklere
 * kendi `authorization: Bearer <CRON_SECRET>` başlığını ekler.
 *
 * NEDEN SIR ZORUNLU: bu uç nokta ÇALIŞTIRMAK, dış bir API'ye kimliğimizle
 * istek attırmak ve komisyon tablosuna yazmak demektir. Sırsız bir uç
 * nokta, Awin kotamızı (dakikada 20 çağrı) herkesin tüketebileceği bir
 * düğmeye çevirirdi. Sır tanımlı değilse uç nokta 503 ile KAPALIDIR.
 *
 * ======================================================================
 * NEDEN ÇEKME, BEKLEME DEĞİL
 * ======================================================================
 * Bir dönüşümün durumu SONRADAN değişir: `pending → approved` ya da
 * `pending → declined`. Awin'in bildirim (push) yolu tek seferliktir;
 * nihai durumu ancak yeniden okuyarak öğreniriz. Bu yüzden tur her
 * çalıştığında son 31 günü BAŞTAN okur ve `record_conversion` değişenleri
 * günceller.
 *
 * Aynı satırı tekrar okumak israf değil, tasarımın kendisi: idempotentlik
 * veritabanında (`on conflict (merchant_id, network_order_id)`) ve
 * yinelenen okuma orada sessizce soğurulur.
 */

import { NextResponse } from 'next/server';

import { safeCompareHash } from '@ohaaaa/shared/api-key';
import { AWIN_PUBLISHER_ID } from '@ohaaaa/shared/providers';

export const dynamic = 'force-dynamic';
/** Ağ turu bir sayfa isteğinden uzun sürer. */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: { code: 'not_configured', message: 'CRON_SECRET tanımlı değil.' } },
      { status: 503 },
    );
  }

  /*
   * Sabit zamanlı karşılaştırma. Düz `!==` ilk farklı baytta döner ve
   * saldırgan yanıt süresini ölçerek sırrı bayt bayt türetebilir.
   */
  const provided = request.headers.get('authorization') ?? '';
  if (!safeCompareHash(provided, `Bearer ${secret}`)) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Yetkisiz.' } },
      { status: 401 },
    );
  }

  /*
   * JETON YOKSA TUR HİÇ BAŞLAMAZ.
   * Başlasaydı her çağrı 401 alır, sayaçlar sıfır kalır ve dışarıdan
   * "cron çalışıyor ama dönüşüm gelmiyor" gibi görünürdü. 503 bunu
   * görünür kılıyor.
   */
  const token = process.env.AWIN_API_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      { error: { code: 'not_configured', message: 'AWIN_API_TOKEN tanımlı değil.' } },
      { status: 503 },
    );
  }

  // Yayıncı kimliği sır değil (her ortaklık linkinde açıkta), ama hesap
  // değişirse ortamdan geçersiz kılınabilsin.
  const publisherId = process.env.AWIN_PUBLISHER_ID?.trim() || AWIN_PUBLISHER_ID;

  const { awinDonusumleriniCek } = await import('@/lib/awin/donusum-cek');
  const { getServiceClient } = await import('@/lib/supabase/service');

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Dönüşüm turu başlatılamadı — Supabase yapılandırması eksik',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json(
      { error: { code: 'not_configured', message: 'Supabase yapılandırması eksik.' } },
      { status: 503 },
    );
  }

  try {
    const sonuc = await awinDonusumleriniCek({
      supabase: supabase as never,
      token,
      publisherId,
      log: (olay, veri) => console.log(JSON.stringify({ event: olay, ...veri })),
    });

    /*
     * ÇEVRİLEMEYEN SATIR VARSA 5xx.
     *
     * 200 dönmek, izleme açısından "her şey yolunda" demekti ve Awin bir
     * alan adını değiştirdiğinde dönüşümler sessizce düşmeye başlardı --
     * tam olarak alım hattında yaşanan arıza.
     *
     * `eslenmeyen` hata SAYILMAZ: henüz mağazasını açmadığımız bir
     * reklamverenden dönüşüm gelmesi olağandır ve loglanıyor.
     */
    const status = sonuc.basarisiz > 0 ? 500 : 200;
    return NextResponse.json({ data: sonuc }, { status });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Dönüşüm turu başarısız',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json(
      { error: { code: 'sync_failed', message: 'Dönüşüm turu başarısız.' } },
      { status: 500 },
    );
  }
}
