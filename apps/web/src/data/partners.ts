import 'server-only';

/**
 * Ortaklık boru hattı okuma katmanı.
 *
 * Bu dosya YALNIZCA okur ve türetir; hiçbir alanı doldurmaz, hiçbir
 * eksiği tamamlamaz. Veritabanında ne varsa o, türetme kuralları
 * `@ohaaaa/shared` içindeki saf katmanda.
 *
 * NEDEN service_role:
 * `merchants` üzerindeki ortaklık sütunları (başvuru durumu, MID, öncelik
 * sırası) anon ve authenticated rollerine SÜTUN BAZINDA kapalıdır --
 * hangi firmaya başvurduğumuz ve hangisinin bizi reddettiği işletme
 * bilgisidir. Sayfa kendi admin kontrolünü yapar; middleware ikinci
 * katmandır.
 *
 * OKUNAMADI ≠ BOŞ. Her okuma başarısızlığı `null` döner ve arayüz bunu
 * "veri yok" değil "okunamadı" diye gösterir. Boş bir tablo göstermek,
 * "hiç ortağımız yok" iddiasıdır; oysa bilmiyor olabiliriz.
 */

import {
  ortakOzetiCikar,
  ortakSatiriTuret,
  ortakSatirlariSirala,
  type BasvuruDurumu,
  type MagazaDurumu,
  type OrtakGirdisi,
  type OrtakKaynagi,
  type OrtakOzeti,
  type OrtakSatiri,
} from '@ohaaaa/shared';

import { getServiceClient } from '@/lib/supabase/service';

export interface OrtakTablosu {
  satirlar: OrtakSatiri[];
  ozet: OrtakOzeti;
  /**
   * Gelir tablosu okunabildi mi. Okunamadıysa satırların gelir sütunu
   * "doğrulanmadı" gösterir -- sıfır DEĞİL.
   */
  gelirOkunabildi: boolean;
}

function hata(msg: string, error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      msg,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

export async function getPartnerPipeline(): Promise<OrtakTablosu | null> {
  let supabase: ReturnType<typeof getServiceClient>;

  try {
    supabase = getServiceClient();
  } catch {
    // Supabase yapılandırılmamış (demo/yerel). Uydurma satır üretmiyoruz.
    return null;
  }

  const { data, error } = await supabase
    .from('merchants')
    .select(
      `id, slug, display_name, network, status, partner_rank,
       application_status, application_submitted_at, approved_at, rejected_at,
       network_advertiser_id, terms_verified_at, deeplink_template,
       sources:sources!merchant_id (
         slug, kind, endpoint_url, field_mapping, is_enabled,
         last_run_at, last_status
       )`,
    );

  if (error) {
    hata('Ortaklık boru hattı okunamadı', error);
    return null;
  }

  const magazalar = (data ?? []) as Record<string, unknown>[];
  const kimlikler = magazalar.map((m) => String(m.id));

  const [donusumler, tahsilatlar] = await Promise.all([
    donusumSayilari(supabase, kimlikler),
    tahsilEdilenler(supabase, kimlikler),
  ]);

  /*
   * Gelir iki tablodan okunuyor ve ikisi de düşebilir. Biri bile
   * okunamadıysa gelir sütunu bir SAYI göstermemeli: "0 dönüşüm" ile
   * "dönüşüm tablosu okunamadı" farklı cümlelerdir ve ikincisi bir
   * altyapı sorununu işaret eder.
   */
  const gelirOkunabildi = donusumler !== null && tahsilatlar !== null;

  const satirlar = magazalar.map((m) => {
    const id = String(m.id);
    const girdi: OrtakGirdisi = {
      slug: String(m.slug),
      displayName: String(m.display_name),
      partnerRank: m.partner_rank === null ? null : Number(m.partner_rank),
      network: String(m.network),
      status: m.status as MagazaDurumu,
      applicationStatus: m.application_status as BasvuruDurumu,
      applicationSubmittedAt: metinYaNull(m.application_submitted_at),
      approvedAt: metinYaNull(m.approved_at),
      rejectedAt: metinYaNull(m.rejected_at),
      networkAdvertiserId: metinYaNull(m.network_advertiser_id),
      termsVerifiedAt: metinYaNull(m.terms_verified_at),
      deeplinkTemplate: metinYaNull(m.deeplink_template),
      kaynaklar: kaynaklariCevir(m.sources),
      donusumSayisi: donusumler?.get(id) ?? 0,
      tahsilEdilenKurus: tahsilatlar?.get(id) ?? 0,
      gelirOkunabildi,
    };
    return ortakSatiriTuret(girdi);
  });

  const sirali = ortakSatirlariSirala(satirlar);
  return { satirlar: sirali, ozet: ortakOzetiCikar(sirali), gelirOkunabildi };
}

function metinYaNull(deger: unknown): string | null {
  return deger === null || deger === undefined ? null : String(deger);
}

function kaynaklariCevir(ham: unknown): OrtakKaynagi[] {
  const dizi = (Array.isArray(ham) ? ham : ham ? [ham] : []) as Record<string, unknown>[];

  return dizi.map((k): OrtakKaynagi => ({
    slug: String(k.slug),
    kind: String(k.kind),
    endpointUrl: metinYaNull(k.endpoint_url),
    /*
     * `field_mapping` jsonb'dir; nesne olmayan bir değer (null, dizi)
     * gelirse BOŞ eşleme sayılır. `as Record` ile geçmek, eksik eşlemeyi
     * "tamam" göstermeye yol açabilirdi.
     */
    fieldMapping:
      k.field_mapping !== null && typeof k.field_mapping === 'object' && !Array.isArray(k.field_mapping)
        ? (k.field_mapping as Record<string, unknown>)
        : {},
    isEnabled: k.is_enabled === true,
    lastRunAt: metinYaNull(k.last_run_at),
    lastStatus: (k.last_status ?? null) as OrtakKaynagi['lastStatus'],
  }));
}

/**
 * Mağaza başına dönüşüm sayısı.
 *
 * `null` döner = OKUNAMADI. Boş Map döner = okundu, dönüşüm yok. Bu ikisi
 * çağıran tarafta ayrı ayrı ele alınıyor.
 */
async function donusumSayilari(
  supabase: ReturnType<typeof getServiceClient>,
  merchantIds: string[],
): Promise<Map<string, number> | null> {
  if (merchantIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('conversions')
    .select('merchant_id')
    .in('merchant_id', merchantIds);

  if (error) {
    hata('Dönüşüm sayıları okunamadı', error);
    return null;
  }

  const sayac = new Map<string, number>();
  for (const satir of (data ?? []) as Record<string, unknown>[]) {
    const id = String(satir.merchant_id);
    sayac.set(id, (sayac.get(id) ?? 0) + 1);
  }
  return sayac;
}

/**
 * Mağaza başına TAHSİL EDİLEN tutar.
 *
 * Ağın beyanı (`declared_cents`) değil, hesaba geçen (`received_cents`)
 * toplanıyor. İkisini karıştırmak, tahsilat sayfasının varlık sebebini
 * ortadan kaldırırdı.
 *
 * PARA BİRİMLERİ TOPLANMIYOR gibi görünse de burada toplanıyor -- ve bu
 * kasıtlı bir sadeleştirme DEĞİL, bilinçli bir sınır: bu sayı panelde bir
 * TUTAR olarak gösterilmiyor, yalnızca "tahsilat var mı yok mu" sorusunun
 * cevabı için kullanılıyor. Tutarın kendisi tahsilat sayfasında, para
 * birimi ayrıştırılmış hâlde duruyor.
 */
async function tahsilEdilenler(
  supabase: ReturnType<typeof getServiceClient>,
  merchantIds: string[],
): Promise<Map<string, number> | null> {
  if (merchantIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('payouts')
    .select('merchant_id, received_cents')
    .in('merchant_id', merchantIds);

  if (error) {
    hata('Tahsilat kayıtları okunamadı', error);
    return null;
  }

  const toplam = new Map<string, number>();
  for (const satir of (data ?? []) as Record<string, unknown>[]) {
    if (satir.received_cents === null || satir.received_cents === undefined) continue;
    const id = String(satir.merchant_id);
    toplam.set(id, (toplam.get(id) ?? 0) + Number(satir.received_cents));
  }
  return toplam;
}
