/**
 * Awin dönüşüm çekme turu.
 *
 * ======================================================================
 * NEDEN AYRI MODÜL
 * ======================================================================
 * Cron route'u yalnızca yetkilendirme ve sunum yapar; zincirin kendisi
 * burada. Route'a gömülseydi test etmek için HTTP sunucusu ayağa
 * kaldırmak gerekirdi ve pratikte test edilmezdi.
 *
 * Ağ ve veritabanı DIŞARIDAN veriliyor (`fetcher`, `supabase`): tur, gerçek
 * bir Awin hesabı ya da gerçek bir veritabanı olmadan sınanabiliyor.
 *
 * ======================================================================
 * IDEMPOTENTLİK BURADA DEĞİL, VERİTABANINDA
 * ======================================================================
 * `record_conversion` RPC'si `on conflict (merchant_id, network_order_id)`
 * ile çalışıyor ve durum geçişini `conversion_transition_allowed` ile
 * denetliyor. Yani aynı turu iki kez koşmak yinelenen satır üretmez ve
 * `approved` bir dönüşümü `pending`'e geri düşürmez.
 *
 * Bu mantığı burada TEKRAR yazmak iki doğruluk kaynağı demekti; ikisi
 * zamanla ayrışır ve ayrışma sessizdir.
 */

import {
  awinMagazaEslemesi,
  awinTransactionToConversion,
  awinTransactionsUrl,
  AWIN_MAX_RANGE_DAYS,
  type PulledConversion,
} from '@ohaaaa/shared/providers';

/** Ağ erişimi — testte sahtelenebilsin diye dışarıdan. */
export type Getirici = (url: string, init: RequestInit) => Promise<Response>;

export interface CekmeSecenekleri {
  supabase: SupabaseBenzeri;
  fetcher?: Getirici;
  /** Awin API jetonu. Ortamdan gelir, koda hiç girmez. */
  token: string;
  publisherId: string;
  /** Kaç günlük geriye bakılacak. Varsayılan 31 (Awin'in tek istek sınırı). */
  gunSayisi?: number;
  /** Şimdiki zaman — testte sabitlenebilsin diye. */
  now?: () => Date;
  log?: (olay: string, veri: Record<string, unknown>) => void;
}

export interface CekmeSonucu {
  /** Awin'in döndürdüğü satır sayısı. */
  okunan: number;
  /** Ortak modele çevrilebilen satır sayısı. */
  cevrilen: number;
  /** Veritabanına yazılan/güncellenen satır sayısı. */
  yazilan: number;
  /** Mağazası eşlenemediği için atlanan satırlar. */
  eslenmeyen: number;
  /** `record_conversion` hata verdiği için atlanan satırlar. */
  basarisiz: number;
}

/** Yalnızca kullandığımız yüzey — tam Supabase tipine bağımlı olmamak için. */
export interface SupabaseBenzeri {
  from(tablo: string): {
    select(sutunlar: string): {
      eq(sutun: string, deger: unknown): Promise<{ data: unknown[] | null; error: unknown }>;
    };
  };
  rpc(ad: string, parametreler: Record<string, unknown>): Promise<{ error: unknown }>;
}

/**
 * Mağaza eşlemesi için gereken satırları okur.
 *
 * Eşlemenin KENDİSİ `awinMagazaEslemesi` içinde ve saf: iki kaynağın
 * hangisinin kazanacağı, çelişkinin nasıl çözüleceği orada yazılı ve
 * orada test ediliyor. Burada yalnızca okuma var.
 */
async function eslemeIcinSatirlariOku(
  supabase: SupabaseBenzeri,
): Promise<Map<string, string>> {
  const { data: magazalar, error: magazaHata } = await supabase
    .from('merchants')
    .select('id, deeplink_template')
    .eq('network', 'awin');
  if (magazaHata) throw new Error(`Magazalar okunamadi: ${String(magazaHata)}`);

  const { data: baglantilar, error: baglantiHata } = await supabase
    .from('merchant_network_links')
    .select('merchant_id, network_program_id')
    .eq('network', 'awin');
  if (baglantiHata) throw new Error(`Baglantilar okunamadi: ${String(baglantiHata)}`);

  return awinMagazaEslemesi(
    (magazalar ?? []) as { id: string; deeplink_template: string | null }[],
    (baglantilar ?? []) as { merchant_id: string; network_program_id: string }[],
  );
}

/**
 * Bir dönüşüm turu çalıştırır.
 *
 * FIRLATIR yalnızca tur HİÇ başlayamadığında (jeton yok, Awin erişilemedi).
 * Tek bir satırın düşmesi turu düşürmez -- bir bozuk kayıt yüzünden geri
 * kalan dönüşümleri kaybetmek, kaybın kendisinden pahalıdır.
 */
export async function awinDonusumleriniCek(
  secenek: CekmeSecenekleri,
): Promise<CekmeSonucu> {
  const {
    supabase,
    fetcher = fetch,
    token,
    publisherId,
    gunSayisi = AWIN_MAX_RANGE_DAYS,
    now = () => new Date(),
    log = () => {},
  } = secenek;

  if (token.trim() === '') {
    throw new Error('AWIN_API_TOKEN tanimli degil.');
  }

  /*
   * PENCERE 31 GÜNLE SINIRLI (Awin'in tek istek sınırı). Daha genişi
   * istemek hata döndürür; sessizce kırpmak yerine burada sabitleniyor.
   */
  const gun = Math.min(Math.max(1, Math.floor(gunSayisi)), AWIN_MAX_RANGE_DAYS);
  const endDate = now();
  const startDate = new Date(endDate.getTime() - gun * 24 * 60 * 60 * 1000);

  const url = awinTransactionsUrl({ publisherId, startDate, endDate });

  const yanit = await fetcher(url, {
    headers: {
      // Resmî doküman: OAuth 2.0, jeton "Bearer" ile gönderilir.
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });

  if (!yanit.ok) {
    /*
     * Gövde loglanmıyor: hata metni jetonu yankılayabilir ve log'a sır
     * yazmak, sırrı log'u okuyan herkese vermektir.
     */
    throw new Error(`Awin transactions cagrisi basarisiz: HTTP ${yanit.status}`);
  }

  const govde: unknown = await yanit.json();
  if (!Array.isArray(govde)) {
    throw new Error('Awin transactions yaniti dizi degil.');
  }

  const sonuc: CekmeSonucu = {
    okunan: govde.length,
    cevrilen: 0,
    yazilan: 0,
    eslenmeyen: 0,
    basarisiz: 0,
  };

  if (govde.length === 0) return sonuc;

  const esleme = await eslemeIcinSatirlariOku(supabase);

  for (const ham of govde) {
    const donusum: PulledConversion | null = awinTransactionToConversion(ham);
    if (donusum === null) {
      sonuc.basarisiz += 1;
      log('awin.cevrilemedi', { ham_id: (ham as { id?: unknown })?.id ?? null });
      continue;
    }
    sonuc.cevrilen += 1;

    const merchantId = esleme.get(donusum.networkMerchantId);
    if (merchantId === undefined) {
      sonuc.eslenmeyen += 1;
      log('awin.magaza_eslenmedi', {
        advertiserId: donusum.networkMerchantId,
        orderId: donusum.orderId,
      });
      continue;
    }

    /*
     * ATIF VE IDEMPOTENTLİK RPC'NİN İŞİ.
     * `record_conversion` subid'den tıklamayı bulur, çerez penceresini
     * denetler, başka mağazaya ait subid'i reddeder ve durum geçişini
     * doğrular. Burada tekrarlanmıyor.
     */
    const { error } = await supabase.rpc('record_conversion', {
      p_merchant_id: merchantId,
      p_network_order_id: donusum.orderId,
      p_subid: donusum.subid,
      p_status: donusum.status,
      p_order_total_cents: donusum.orderTotalCents,
      p_commission_cents: donusum.commissionCents,
      p_currency: donusum.currency,
      p_occurred_at: donusum.occurredAt,
      p_raw: ham as Record<string, unknown>,
    });

    if (error) {
      sonuc.basarisiz += 1;
      log('awin.kayit_basarisiz', {
        orderId: donusum.orderId,
        hata: String((error as { message?: unknown }).message ?? error),
      });
      continue;
    }

    sonuc.yazilan += 1;
  }

  return sonuc;
}
