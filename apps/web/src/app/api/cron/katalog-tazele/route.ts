/**
 * POST /api/cron/katalog-tazele — katalog önbelleğini boşaltır.
 *
 * NEDEN VAR
 * `onbellekle` bütün katalog okumalarını `katalog` etiketiyle saklıyor ve
 * taksonomi 3600 saniye tutuluyor. Etiket vardı ama onu BOŞALTAN hiçbir
 * yer yoktu (kaynak tarandı: `revalidateTag('katalog')` sıfır sonuç).
 *
 * Bunun ölçülen bedeli: 34.722 ürün grubu veritabanında yeni
 * kategorilerine taşındıktan ve site yeniden dağıtıldıktan SONRA bile üst
 * çubuk eski ağacı sunmaya devam etti (Bilgisayarlar 32.873 -- taşımadan
 * önceki sayı). Vercel'in veri önbelleği dağıtımla temizlenmiyor;
 * dolayısıyla bir veri düzeltmesinin vitrine yansıması için elde hiçbir
 * kaldıraç yoktu, yalnızca beklemek vardı.
 *
 * KİM ÇAĞIRIR
 * Alım turundan sonra Vercel Cron ya da bir operatör. `/api/cron/alim` ile
 * AYNI sırrı kullanır: bu uç nokta da katalogun vitrine yansımasını
 * tetikler ve sırsız bırakılırsa herkes önbelleği sürekli boşaltarak
 * veritabanına yük bindirebilirdi.
 *
 * NEDEN POST
 * Yan etkisi var. GET olsaydı bir önizleme aracı, bir bağlantı tarayıcısı
 * ya da tarayıcının ön-getirmesi onu kazara tetikleyebilirdi.
 */

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { safeCompareHash } from '@ohaaaa/shared/api-key';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: { code: 'not_configured', message: 'CRON_SECRET tanımlı değil.' } },
      { status: 503 },
    );
  }

  /*
   * Sabit zamanlı karşılaştırma -- `/api/cron/alim` ile aynı gerekçe: düz
   * `!==` ilk farklı baytta döner ve saldırgan yanıt süresini ölçerek
   * sırrı bayt bayt türetebilir.
   */
  const provided = request.headers.get('authorization') ?? '';
  if (!safeCompareHash(provided, `Bearer ${secret}`)) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Yetkisiz.' } },
      { status: 401 },
    );
  }

  /*
   * İKİNCİ ARGÜMAN ZORUNLU (Next 16).
   *
   * `{ expire: 0 }` = "bu etiketli her şey ŞU AN bayat". Bir profil adı
   * ('max' gibi) vermek, önbelleğin ne kadar daha yaşayacağını söylemek
   * olurdu -- oysa burada istenen şey tam tersi: veri değişti, elde olan
   * kopya artık yanlış.
   *
   * `updateTag` KULLANILMADI: o yalnızca Server Action içinde çalışır ve
   * bu bir rota işleyicisi.
   */
  revalidateTag('katalog', { expire: 0 });

  return NextResponse.json({ ok: true, tazelenen: 'katalog' });
}
