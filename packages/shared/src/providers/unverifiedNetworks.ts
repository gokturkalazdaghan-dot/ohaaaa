/**
 * Sözleşmesi henüz doğrulanmamış ortaklık ağları.
 *
 * ======================================================================
 * NEDEN HEPSİ AYNI DOSYADA VE HEPSİ AYNI DURUMDA
 * ======================================================================
 * Bu ağların her biri için ayrı bir dosya yazmak, dokuz kez aynı "hiçbir
 * şey doğrulanmadı" beyanını kopyalamak olurdu. Hepsi AYNI sebeple aynı
 * durumda: resmî dokümanlarına bu ortamdan erişilemiyor (ağ politikası
 * doküman sunucularını 403 ile kapatıyor), dolayısıyla hiçbir uç nokta,
 * kimlik doğrulama şeması ya da alan eşlemesi DOĞRULANAMADI.
 *
 * Bir ağın sözleşmesi doğrulandığında kendi dosyasına taşınır, gerçek
 * kanıtlarıyla (`source` + `verifiedAt`) ve gerçek metotlarıyla.
 *
 * ======================================================================
 * NEDEN YİNE DE KAYDA GİRİYORLAR
 * ======================================================================
 * Kayıtta OLMAYAN bir ağ `unknown_network` fırlatır ve bu doğru davranış
 * -- ama yanlış soruya doğru cevap. "CJ'yi tanımıyoruz" ile "CJ'nin
 * sözleşmesini doğrulamadık" farklı şeylerdir ve ikincisi bir İŞ
 * KALEMİDİR: operatör panelde görebilmeli, keşif turu sayabilmeli,
 * puanlama listeleyebilmeli.
 *
 * Kayıtta olmaları HİÇBİR risk taşımıyor: her yetenek `unavailable`,
 * yani `callCapability` hepsinde kapalı başarısız oluyor ve bu ağlara
 * TEK BİR İSTEK bile gitmiyor.
 *
 * ======================================================================
 * POSTBACK DE KAPALI
 * ======================================================================
 * `verifyPostback` `false` DÖNMÜYOR, FIRLATIYOR. İkisi çok farklı: `false`
 * "imza yanlış" demektir ve çağıran bunu bir saldırı sayar; fırlatmak
 * "bu ağın imza şemasını bilmiyoruz" der. Birincisini yazmak, doğrulama
 * yapıyormuş gibi görünüp aslında hiçbir şey doğrulamamaktır.
 */

import { matrixFromEvidence, unverifiedEvidence, type CapabilityEvidenceMap } from './capabilityEvidence.js';
import {
  ProviderError,
  type AffiliateProvider,
  type NormalizedConversion,
  type PostbackContext,
} from './types.js';

/**
 * Ortamın doküman erişimini kapatması, bir ağın yeteneği hakkında HİÇBİR
 * ŞEY söylemez. Not bunu açıkça yazıyor ki altı ay sonra okuyan kişi
 * "denendi ve yok" ile "bakılamadı"yı karıştırmasın.
 */
const ERISIM_NOTU =
  'Resmi dokumanlara bu ortamdan erisilemedi (ag politikasi 403). Hicbir uc ' +
  'nokta, kimlik dogrulama semasi ya da alan eslemesi DOGRULANMADI. Bu bir ' +
  'BOSLUKTUR, "desteklemiyor" karari DEGILDIR.';

export interface UnverifiedNetworkSpec {
  network: string;
  displayName: string;
}

/**
 * Öncelik sırası operatör tarafından bildirildi. Sıra bir yetenek iddiası
 * DEĞİL, yalnızca hangi ağın sözleşmesine önce bakılacağı.
 */
export const UNVERIFIED_NETWORKS: readonly UnverifiedNetworkSpec[] = [
  { network: 'cj', displayName: 'CJ Affiliate' },
  { network: 'daisycon', displayName: 'Daisycon' },
  { network: 'tradedoubler', displayName: 'Tradedoubler' },
  { network: 'rakuten', displayName: 'Rakuten Advertising' },
  { network: 'impact', displayName: 'Impact' },
  { network: 'partnerize', displayName: 'Partnerize' },
  { network: 'admitad', displayName: 'Admitad' },
  { network: 'webgains', displayName: 'Webgains' },
  { network: 'tradetracker', displayName: 'TradeTracker' },
] as const;

/**
 * Doğrulanmamış bir ağ için sağlayıcı üretir.
 *
 * Hiçbir yetenek metodu TANIMLANMIYOR. Tanımlansaydı `requireCapability`
 * yine reddederdi (beyan `unavailable`) ama kodun kendisi bir sözleşme
 * varmış izlenimi verirdi -- ve bir gün biri beyanı `supported`'a çevirip
 * o uydurma kodu canlıya alırdı.
 */
export function createUnverifiedProvider(spec: UnverifiedNetworkSpec): AffiliateProvider {
  const evidence: CapabilityEvidenceMap = unverifiedEvidence(ERISIM_NOTU);

  return {
    network: spec.network,
    displayName: spec.displayName,
    capabilities: matrixFromEvidence(spec.network, evidence),

    verifyPostback(_context: PostbackContext): never {
      throw new ProviderError(
        `${spec.displayName}: bildirim dogrulama semasi bilinmiyor. ${ERISIM_NOTU}`,
        'verification_unavailable',
      );
    },

    normalizePostback(_payload: unknown): NormalizedConversion {
      throw new ProviderError(
        `${spec.displayName}: bildirim alan eslemesi bilinmiyor. ${ERISIM_NOTU}`,
        'verification_unavailable',
      );
    },

    // buildDeeplink BILEREK TANIMSIZ: sablonu bilinmeyen bir agin baglantisi
    // uretilemez ve uretilmis gibi gorunmesi, komisyonsuz tiklama demektir.
  };
}

/** Kanıt kümeleri — panel ve denetim bu haritadan okur. */
export const UNVERIFIED_EVIDENCE: Readonly<Record<string, CapabilityEvidenceMap>> =
  Object.fromEntries(
    UNVERIFIED_NETWORKS.map((s) => [s.network, unverifiedEvidence(ERISIM_NOTU)]),
  );

export const unverifiedProviders: readonly AffiliateProvider[] =
  UNVERIFIED_NETWORKS.map(createUnverifiedProvider);
