import 'server-only';

/**
 * Yapay zekâ çağrılarının bütçe kapısı.
 *
 * Her model çağrısının önünde İKİ tavan vardır:
 *
 *   1) KİŞİ BAŞI  — tek bir ziyaretçinin saatlik hakkı. Tek kötü niyetliyi
 *                   durdurur.
 *   2) KÜRESEL    — bütün site için günlük çağrı tavanı. Dağıtık kullanımı
 *                   (çok sayıda IP) ve ani talep patlamasını durdurur.
 *
 * Yalnızca birincisi olsaydı bir botnet ikinciyi hiç görmezdi; yalnızca
 * ikincisi olsaydı tek kişi herkesin bütçesini yiyebilirdi.
 *
 * TAVANLAR İŞLETMECİNİN KARARIDIR.
 * Varsayılanlar makul ama keyfîdir; gerçek değer, gerçek kullanım ve gerçek
 * fatura görüldükten sonra belirlenir. Bu yüzden hepsi ortam değişkeniyle
 * ezilebilir. Kod kendi başına "ucuza kaçma" kararı vermez.
 *
 * SAYAÇ NEDEN VERİTABANINDA?
 * Sunucusuz ortamda her istek ayrı bir örnekte çalışabilir; bellekteki bir
 * sayaç orada sıfırdan başlar. Yani bellek sayacı, sınır varmış gibi görünüp
 * uygulanmayan bir sınırdır. (Aynı hata bu depoda bir kez yapılmış ve
 * 20260830140000_api_rate_limit.sql ile düzeltilmişti.)
 */

import { getServiceClient } from '@/lib/supabase/service';
import { hashedClientIp } from '@/lib/clientHash';

export type AiFeature = 'arama' | 'gorsel';

interface Tavan {
  /** Kişi başı pencere içindeki en fazla çağrı. */
  kisiBasi: number;
  /** Kişi başı pencerenin uzunluğu (saniye). */
  kisiPencereSaniye: number;
  /** Bütün site için günlük en fazla çağrı. */
  kuresel: number;
}

/** Ortam değişkenini pozitif tam sayı olarak okur; yoksa/geçersizse yedeği verir. */
function sayi(ad: string, yedek: number): number {
  const ham = process.env[ad]?.trim();
  if (!ham) return yedek;
  const deger = Number(ham);
  return Number.isInteger(deger) && deger > 0 ? deger : yedek;
}

function tavanlar(feature: AiFeature): Tavan {
  if (feature === 'gorsel') {
    /*
     * Görselle arama daha pahalı (fotoğraf girdi olarak gider) ve daha
     * seyrek kullanılır: iki tavan da daha dar.
     */
    return {
      kisiBasi: sayi('AI_GORSEL_IP_SAATLIK', 10),
      kisiPencereSaniye: 3600,
      kuresel: sayi('AI_GORSEL_GUNLUK', 500),
    };
  }

  return {
    kisiBasi: sayi('AI_ARAMA_IP_SAATLIK', 20),
    kisiPencereSaniye: 3600,
    kuresel: sayi('AI_ARAMA_GUNLUK', 2000),
  };
}

export type ButceSonucu =
  | { izin: true }
  | { izin: false; sebep: 'kisi_basi' | 'kuresel' | 'olculemedi' };

/**
 * Bir yapay zekâ çağrısını bütçeye yazar ve izin verilip verilmediğini söyler.
 *
 * SAYAMAZSAK İZİN VERMİYORUZ.
 * Veritabanına ulaşılamazsa `olculemedi` dönüyor ve çağrı yapılmıyor.
 * Tersi (ölçemeyince serbest bırakmak) kolayca sömürülebilir bir kapı olurdu:
 * sayacı düşüren bir saldırgan aynı anda tavanı da kaldırmış olurdu.
 * Kaybedilen şey yalnızca bir kolaylık özelliği; arama düz metinle çalışmaya
 * devam eder.
 */
export async function tuketAiButcesi(
  feature: AiFeature,
  headers: Headers,
): Promise<ButceSonucu> {
  const tavan = tavanlar(feature);

  let supabase: ReturnType<typeof getServiceClient>;
  try {
    supabase = getServiceClient();
  } catch {
    // Supabase yapılandırılmamış (demo/yerel). Sayaç yok, ama model anahtarı
    // da büyük ihtimalle yok; çağrının kendisi zaten yapılandırmaya bakıyor.
    return { izin: true };
  }

  const ipOzeti = hashedClientIp(headers);

  // KÜRESEL TAVAN ÖNCE.
  // Kişi başı tavanı önce saysaydık, küresel tavan dolduğunda bile her
  // ziyaretçinin kişisel sayacı artmaya devam ederdi -- yani sınır
  // aşıldıktan sonra da yazma yükü sürerdi.
  const kuresel = await say(supabase, `${feature}:kuresel`, tavan.kuresel, 86_400);
  if (kuresel === null) return { izin: false, sebep: 'olculemedi' };
  if (!kuresel) return { izin: false, sebep: 'kuresel' };

  const kisi = await say(
    supabase,
    `${feature}:ip:${ipOzeti}`,
    tavan.kisiBasi,
    tavan.kisiPencereSaniye,
  );
  if (kisi === null) return { izin: false, sebep: 'olculemedi' };
  if (!kisi) return { izin: false, sebep: 'kisi_basi' };

  return { izin: true };
}

/** true = izin var, false = tavan aşıldı, null = sayılamadı. */
async function say(
  supabase: ReturnType<typeof getServiceClient>,
  kova: string,
  tavan: number,
  pencereSaniye: number,
): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('consume_ai_budget', {
    p_bucket: kova,
    p_limit: tavan,
    p_window_seconds: pencereSaniye,
  });

  if (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Yapay zeka butcesi sayilamadi — cagri yapilmadi',
        kova,
        error: error.message,
      }),
    );
    return null;
  }

  const sonuc = data as { allowed?: boolean; used?: number; limit?: number } | null;

  if (sonuc?.allowed === false) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Yapay zeka tavani asildi',
        kova,
        kullanilan: sonuc.used,
        tavan: sonuc.limit,
      }),
    );
  }

  return sonuc?.allowed === true;
}
