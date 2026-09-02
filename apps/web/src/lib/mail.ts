/**
 * E-posta gönderimi.
 *
 * SAĞLAYICI YOKSA SESSİZCE BAŞARILI SAYILMAZ
 * Bu katmanın en kolay hatası, anahtar tanımlı değilken "gönderildi"
 * dönmektir: sipariş akışı yeşil görünür, kimse e-posta almaz ve sorun ancak
 * müşteri "onay gelmedi" dediğinde ortaya çıkar. Burada yapılandırılmamış
 * durum AÇIKÇA `not_configured` olarak döner ve kayda düşer.
 *
 * ÇAĞIRANIN AKIŞINI ASLA DÜŞÜRMEZ
 * Sipariş oluşturuldu ama bildirim gönderilemedi ise sipariş geçerlidir.
 * Bildirim yüzünden `create_order` sonrası hata döndürmek, parası çekilmiş
 * bir alıcıya "sipariş başarısız" demek olurdu. Bu yüzden fonksiyon hiçbir
 * durumda fırlatmaz; sonucu döner ve çağıran isterse kaydeder.
 *
 * SAĞLAYICI: Resend'in HTTP API'si doğrudan `fetch` ile çağrılır. SDK
 * eklemek, tek bir POST için bütün bir bağımlılık ağacı demekti.
 */

export type MailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: 'not_configured' | 'failed'; detail?: string };

export interface MailInput {
  to: string;
  subject: string;
  /** Düz metin ZORUNLU: HTML'i engelleyen istemcilerde de okunabilmeli. */
  text: string;
  html?: string;
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.MAIL_FROM?.trim());
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();

  if (!apiKey || !from) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'E-posta gönderilmedi: sağlayıcı yapılandırılmamış',
        subject: input.subject,
      }),
    );
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
      // Bildirim, siparişin kendisinden daha az önemli: yanıt gecikirse
      // akışı bekletmek yerine vazgeçilir.
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'E-posta gönderilemedi',
          status: response.status,
          detail: detail.slice(0, 300),
        }),
      );
      return { sent: false, reason: 'failed', detail: `HTTP ${response.status}` };
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, id: body?.id ?? null };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'E-posta gönderilemedi',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { sent: false, reason: 'failed', detail: 'ag hatasi' };
  }
}

/*
 * Şablonlar.
 *
 * Hepsi DÜZ METİN üretir. Bir pazar yerinin ilk e-postaları için görsel
 * şablon, okunabilirlikten çok bakım yükü getirir; ayrıca metin e-postası
 * her istemcide aynı görünür ve istenmeyen klasörüne düşme ihtimali düşüktür.
 *
 * Hiçbir şablon ÖLÇÜLMEMİŞ bir şey söylemez: teslim tarihi tahmini
 * yazılmaz, "kargonuz yola çıktı" yalnızca satıcı gerçekten kargoladığında
 * gönderilir.
 */

export function orderConfirmationMail(params: {
  orderNumber: string;
  totalText: string;
  vendorNames: string[];
  siteUrl: string;
}): Omit<MailInput, 'to'> {
  const magazalar =
    params.vendorNames.length > 1
      ? `Siparişiniz ${params.vendorNames.length} mağazaya bölündü ve her mağaza kendi kargosuyla gönderecek:\n${params.vendorNames.map((n) => `  - ${n}`).join('\n')}`
      : `Satıcı: ${params.vendorNames[0] ?? '—'}`;

  return {
    subject: `Siparişiniz alındı · ${params.orderNumber}`,
    text: [
      'Siparişiniz alındı.',
      '',
      `Sipariş numarası: ${params.orderNumber}`,
      `Toplam: ${params.totalText}`,
      '',
      magazalar,
      '',
      `Siparişinizin durumunu buradan izleyebilirsiniz: ${params.siteUrl}/siparislerim`,
      '',
      'Ohaaaa — kargo dahil fiyat karşılaştırması',
    ].join('\n'),
  };
}

export function shipmentMail(params: {
  orderNumber: string;
  vendorName: string;
  carrierName: string;
  trackingNumber: string;
  trackingUrl: string | null;
  siteUrl: string;
}): Omit<MailInput, 'to'> {
  return {
    subject: `Kargoya verildi · ${params.orderNumber}`,
    text: [
      `${params.vendorName} siparişinizi kargoya verdi.`,
      '',
      `Sipariş numarası: ${params.orderNumber}`,
      `Kargo firması: ${params.carrierName}`,
      `Takip numarası: ${params.trackingNumber}`,
      params.trackingUrl ? `Takip: ${params.trackingUrl}` : '',
      '',
      // Teslim tarihi TAHMİNİ YAZILMAZ: kargo firmasının API'si bağlı
      // değil, ölçmediğimiz bir tarihi söylemek olurdu.
      `Siparişleriniz: ${params.siteUrl}/siparislerim`,
      '',
      'Ohaaaa — kargo dahil fiyat karşılaştırması',
    ]
      .filter((satir) => satir !== '')
      .join('\n'),
  };
}
