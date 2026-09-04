/**
 * GET /api/cron/fiyat-alarmi — favorilerdeki fiyat düşüşlerini haber verir.
 *
 * KİM ÇAĞIRIR
 * Vercel Cron (bkz. vercel.json). Vercel, zamanlanmış isteklere kendi
 * `authorization: Bearer <CRON_SECRET>` başlığını ekler; başka hiç kimse
 * bu uç noktayı çalıştıramamalı çünkü çalıştırmak E-POSTA GÖNDERTMEK
 * demektir. Sırsız bir uç nokta, siteyi kendi kullanıcılarına spam
 * gönderten bir araca çevirirdi.
 *
 * SIR TANIMLI DEĞİLSE UÇ NOKTA KAPALIDIR
 * Boş bir sırla "herkese açık" duruma düşmek, en kötü varsayılan olurdu.
 * Tanımlı değilse istek 503 ile reddedilir.
 *
 * SERVICE_ROLE NEDEN GEREKLİ
 * `pending_price_alerts` başka kullanıcıların e-postasını ve ne
 * işaretlediklerini döndürür; bu yüzden istemci rollerine kapalı ve
 * yalnızca sunucu anahtarıyla çağrılabiliyor.
 */

import { NextResponse } from 'next/server';

import { safeCompareHash } from '@ohaaaa/shared/api-key';

export const dynamic = 'force-dynamic';
// Zamanlanmış iş, bir sayfa isteğinden uzun sürebilir.
export const maxDuration = 60;

interface AlertRow {
  favorite_id: string;
  email: string;
  group_slug: string;
  group_title: string;
  saved_price_cents: number;
  current_price_cents: number;
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: { code: 'not_configured', message: 'CRON_SECRET tanımlı değil.' } },
      { status: 503 },
    );
  }

  /*
   * SIR KARSILASTIRMASI SABIT ZAMANDA.
   *
   * Onceki hal duz `!==` idi. Duz karsilastirma ilk farkli baytta doner;
   * saldirgan yanit suresini olcerek dogru degeri bayt bayt turetebilir.
   * Bu uc nokta E-POSTA GONDERTTIGI icin sirrin ele gecirilmesi, siteyi
   * kendi kullanicilarina spam gonderten bir araca cevirir.
   *
   * `safeCompareHash` projede zaten var (packages/shared/src/apiKey.ts) ve
   * tasoron API anahtarlarinda kullaniliyor. Ayni isi ikinci kez yazmak
   * yerine onu cagiriyoruz: iki farkli sabit zaman uygulamasi, birinin
   * sessizce yanlis olmasi demektir.
   *
   * Uzunluk farkinda erken donuyor; uzunluk gizli bir bilgi degil.
   */
  const provided = request.headers.get('authorization') ?? '';

  if (!safeCompareHash(provided, `Bearer ${secret}`)) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Yetkisiz.' } },
      { status: 401 },
    );
  }

  const { isMailConfigured, sendMail } = await import('@/lib/mail');
  if (!isMailConfigured()) {
    /*
     * Sağlayıcı yoksa TARAMA HİÇ YAPILMAZ. Yapılsaydı `last_alerted_at`
     * işaretlenir ve bekleme süresi başlardı; sağlayıcı sonradan
     * bağlandığında o düşüşler bir daha hiç bildirilmezdi.
     */
    return NextResponse.json({
      data: { skipped: true, reason: 'mail_not_configured', sent: 0 },
    });
  }

  const { getServiceClient } = await import('@/lib/supabase/service');
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('pending_price_alerts', {
    p_min_drop_ratio: 0.05,
    p_cooldown_days: 7,
    p_limit: 200,
  });

  if (error) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Liste alınamadı.' } },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as AlertRow[];
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.ohaaaa.com').replace(
    /\/+$/,
    '',
  );

  let sent = 0;
  const gonderilen: string[] = [];

  for (const row of rows) {
    const eski = row.saved_price_cents / 100;
    const yeni = row.current_price_cents / 100;
    const oran = Math.round((1 - row.current_price_cents / row.saved_price_cents) * 100);

    const result = await sendMail({
      to: row.email,
      subject: `Fiyat düştü: ${row.group_title}`,
      text: [
        `Favorilerinizdeki bir ürünün fiyatı düştü.`,
        '',
        row.group_title,
        `İşaretlediğinizde: ${eski.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`,
        `Şu an: ${yeni.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL  (%${oran} daha ucuz)`,
        '',
        // Fiyatlar KARGO DAHİL toplam üzerinden; sitenin geri kalanıyla
        // aynı ölçü. Farklı bir ölçü kullanmak, e-postadaki sayının ürün
        // sayfasındakiyle tutmamasına yol açardı.
        'Fiyatlar kargo dahil toplam maliyettir.',
        '',
        `${siteUrl}/urun/${row.group_slug}`,
        '',
        `Bu bildirimleri favori listenizden kapatabilirsiniz: ${siteUrl}/favoriler`,
      ].join('\n'),
    });

    if (result.sent) {
      sent += 1;
      gonderilen.push(row.favorite_id);
    }
  }

  /*
   * `last_alerted_at` YALNIZCA gerçekten gönderilenler için işaretlenir.
   * Hepsini birden işaretleseydik, sağlayıcı geçici olarak hata verdiğinde
   * o kullanıcılar bir hafta boyunca hiçbir şey duymazdı.
   */
  if (gonderilen.length > 0) {
    await supabase
      .from('favorites')
      .update({ last_alerted_at: new Date().toISOString() })
      .in('id', gonderilen);
  }

  return NextResponse.json({ data: { candidates: rows.length, sent } });
}
