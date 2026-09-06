/**
 * GET /api/cron/alim — zamanlanmış ürün alım turu.
 *
 * KİM ÇAĞIRIR
 * Vercel Cron (bkz. vercel.json). Vercel zamanlanmış isteklere kendi
 * `authorization: Bearer <CRON_SECRET>` başlığını ekler.
 *
 * NEDEN SIR ZORUNLU: bu uç nokta ÇALIŞTIRMAK, dış sitelere istek attırmak
 * ve katalog yazmak demektir. Sırsız bir uç nokta, siteyi başkalarının
 * feed'lerine yönlendirilebilecek bir tetikleyiciye çevirirdi. Sır tanımlı
 * değilse uç nokta 503 ile KAPALIDIR -- "herkese açık" en kötü varsayılan
 * olurdu.
 *
 * ======================================================================
 * İKİNCİ BİR ALIM SİSTEMİ DEĞİLDİR
 * ======================================================================
 * Bu dosya alım mantığı İÇERMEZ. `runScheduledIngest` çağırır -- CLI'ın
 * `--schedule` kipiyle BİREBİR aynı fonksiyon. Zincirin adımları
 * (schedule_due_sources → recover_orphaned_jobs → runWorkerOnce) tek bir
 * yerde, `packages/ingest/src/runner.ts` içindedir.
 *
 * Adımları burada tekrar yazmak iki alım yolu demekti ve iki yol zamanla
 * AYRIŞIR: biri nezaket gecikmesini uygular, diğeri unutur. Ayrışma
 * sessizdir; ikisi de "çalışıyor" görünür.
 *
 * ======================================================================
 * SÜRE BÜTÇESİ
 * ======================================================================
 * Serverless çağrı `maxDuration`'da ÖLDÜRÜLÜR. Bütçe ondan kısa tutuluyor
 * ki tur kendi isteğiyle dursun ve yanıt yazılabilsin. Yarıda kesilmek
 * veri kaybı değildir (iş kirası dolunca geri gelir) ama gereksiz
 * gecikmedir.
 *
 * ======================================================================
 * GÜVENLİK: SSRF / GÖVDE BOYUTU / NEZAKET
 * ======================================================================
 * Ağ erişimi yalnızca `createPoliteClient` üzerinden. SSRF kapısı, gövde
 * boyutu sınırı, zaman aşımı, yeniden deneme ve devre kesici oradadır.
 * Ayarlar CLI'daki değerlerle aynı: iki tetikleyicinin farklı nezaket
 * davranışı göstermesi, mağazalar açısından iki farklı bot olmamız demekti.
 */

import { NextResponse } from 'next/server';

import { safeCompareHash } from '@ohaaaa/shared/api-key';

export const dynamic = 'force-dynamic';
/** Alım turu bir sayfa isteğinden uzun sürer. */
export const maxDuration = 60;

/**
 * Turun kendi süre bütçesi. `maxDuration`'dan KISA:
 * kalan süre, çalışan işin bitirilmesi ve yanıtın yazılması içindir.
 */
const BUDGET_MS = 45_000;

const USER_AGENT =
  process.env.OHAAAA_USER_AGENT ??
  'OhaaaaBot/1.0 (+https://ohaaaa.com/bot; iletisim@ohaaaa.com)';

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
   * `safeCompareHash` depoda zaten var ve aynı işi ikinci kez yazmak,
   * birinin sessizce yanlış olması demektir.
   */
  const provided = request.headers.get('authorization') ?? '';
  if (!safeCompareHash(provided, `Bearer ${secret}`)) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Yetkisiz.' } },
      { status: 401 },
    );
  }

  const { createPoliteClient, runScheduledIngest } = await import('@ohaaaa/ingest');
  const { getServiceClient } = await import('@/lib/supabase/service');

  /*
   * YAPILANDIRMA EKSİKSE TUR HİÇ BAŞLAMAZ.
   *
   * Başlasaydı `schedule_due_sources` düşer, işler `bekliyor`da kalır ve
   * dışarıdan "cron çalışıyor ama hiçbir şey olmuyor" gibi görünürdü.
   * 503 bunu görünür kılar.
   */
  let supabase;
  try {
    supabase = getServiceClient();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Alım turu başlatılamadı — Supabase yapılandırması eksik',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json(
      { error: { code: 'not_configured', message: 'Supabase yapılandırması eksik.' } },
      { status: 503 },
    );
  }

  // Ayarlar CLI ile AYNI: iki tetikleyici tek bir bot gibi davranmalı.
  const fetcher = createPoliteClient({
    userAgent: USER_AGENT,
    minDelayMs: 2000,
    timeoutMs: 30_000,
    maxRetries: 3,
    circuitBreakerThreshold: 5,
  });

  try {
    const sonuc = await runScheduledIngest({
      supabase,
      fetcher,
      budgetMs: BUDGET_MS,
      log: (event, data) => console.log(JSON.stringify({ event, ...data })),
    });

    const govde = {
      scheduled: sonuc.scheduled.length,
      orphansRecovered: sonuc.orphansRecovered,
      claimed: sonuc.worker.claimed,
      completed: sonuc.worker.completed,
      failed: sonuc.worker.failed,
      permanentlyFailed: sonuc.worker.permanentlyFailed,
      budgetExhausted: sonuc.budgetExhausted,
      durationMs: sonuc.durationMs,
      sources: sonuc.summaries.map((s) => ({
        sourceId: s.sourceId,
        status: s.status,
        itemsSeen: s.itemsSeen,
        itemsNew: s.itemsNew,
        itemsChanged: s.itemsChanged,
        itemsDeleted: s.itemsDeleted,
      })),
    };

    /*
     * BAŞARISIZ İŞ VARSA 5xx.
     *
     * 200 dönmek, izleme açısından "her şey yolunda" demekti ve alım
     * hattının sessizce durması tam olarak böyle fark edilmeden kalırdı --
     * bu depoda bir kez yaşandı.
     *
     * Yeniden denemeden korkulmuyor: işler kuyrukta ve kira ile korunuyor,
     * aynı tur ikinci kez koşsa da yinelenen alım üretmez.
     */
    const status = sonuc.worker.failed > 0 ? 500 : 200;
    return NextResponse.json({ data: govde }, { status });
  } catch (error) {
    /*
     * Buraya yalnızca ZAMANLAYICI düşerse gelinir (runner o durumda
     * fırlatır). Tur hiç başlamamıştır; sessizce 200 dönmek, hattın
     * durduğunu gizlemek olurdu.
     */
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Alım turu başarısız',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json(
      { error: { code: 'ingest_failed', message: 'Alım turu başarısız.' } },
      { status: 500 },
    );
  }
}
