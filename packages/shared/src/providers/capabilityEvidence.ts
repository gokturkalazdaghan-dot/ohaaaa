/**
 * Yetenek KANITI — "destekliyor" demenin bedeli.
 *
 * ======================================================================
 * NEDEN BEYAN TEK BAŞINA YETMİYOR
 * ======================================================================
 * `CapabilityMatrix` bir yeteneğin durumunu söylüyor ama NEDEN o durumda
 * olduğunu söylemiyor. Ölçekte bu boşluk pahalıya patlar: on ağ eklenince
 * kimse hangi `supported` beyanının resmî bir dokümana, hangisinin bir
 * hatıraya dayandığını bilemez. Ve hatıraya dayanan bir `supported`, var
 * olmayan bir uç noktaya gerçek istek göndermek demektir.
 *
 * Bu yüzden `supported` bir KANIT İSTİYOR: resmî doküman adresi ve
 * doğrulama tarihi. Kanıtsız `supported` modül yüklenirken düşer --
 * yani yanlış bir beyan CANLIYA ÇIKAMAZ.
 *
 * `manual_required` ve `unavailable` kanıt istemez ama GEREKÇE ister:
 * ikisi de bir karardır ve gerekçesiz bir karar, altı ay sonra kimsenin
 * geri dönüp bakmadığı bir satıra dönüşür.
 */

import type { CapabilityMatrix, CapabilitySupport, ProviderCapability } from './capabilities.js';
import { PROVIDER_CAPABILITIES } from './capabilities.js';

export interface CapabilityEvidence {
  support: CapabilitySupport;
  /**
   * Resmî doküman adresi. `supported` için ZORUNLU.
   *
   * Blog yazısı, forum cevabı ya da üçüncü taraf kütüphane DEĞİL: ağın
   * kendi yayınladığı sözleşme. Başka bir kaynağa dayanan bir entegrasyon,
   * ağ sözleşmeyi değiştirdiğinde sessizce bozulur.
   */
  source: string | null;
  /** Kanıtın görüldüğü an (ISO-8601). `supported` için ZORUNLU. */
  verifiedAt: string | null;
  /** Neden bu durumda. Her durum için ZORUNLU. */
  note: string;
}

export type CapabilityEvidenceMap = Record<ProviderCapability, CapabilityEvidence>;

export class CapabilityEvidenceError extends Error {
  constructor(
    readonly network: string,
    readonly capability: ProviderCapability,
    message: string,
  ) {
    super(`${network}/${capability}: ${message}`);
    this.name = 'CapabilityEvidenceError';
  }
}

/**
 * Kanıt kümesini doğrular ve ondan bir yetenek matrisi üretir.
 *
 * Matris ve kanıt AYRI yazılsaydı ikisi ayrışabilirdi: matriste
 * `supported`, kanıtta `unavailable`. Matris kanıttan TÜRETİLİYOR, o
 * yüzden ayrışma imkânsız.
 */
export function matrixFromEvidence(
  network: string,
  evidence: CapabilityEvidenceMap,
): CapabilityMatrix {
  const matris = {} as CapabilityMatrix;

  for (const capability of PROVIDER_CAPABILITIES) {
    const k = evidence[capability];

    if (!k) {
      throw new CapabilityEvidenceError(network, capability, 'kanit kaydi yok.');
    }

    if (typeof k.note !== 'string' || k.note.trim().length === 0) {
      throw new CapabilityEvidenceError(
        network,
        capability,
        'gerekce zorunlu -- gerekcesiz bir karar, kimsenin geri donup bakmadigi bir satira doner.',
      );
    }

    if (k.support === 'supported') {
      if (!k.source || k.source.trim().length === 0) {
        throw new CapabilityEvidenceError(
          network,
          capability,
          'kanitsiz "supported" -- var olmayan bir uc noktaya gercek istek gonderilirdi.',
        );
      }
      if (!/^https:\/\//.test(k.source)) {
        throw new CapabilityEvidenceError(
          network,
          capability,
          `kanit adresi https olmali: ${k.source}`,
        );
      }
      if (!k.verifiedAt || !Number.isFinite(Date.parse(k.verifiedAt))) {
        throw new CapabilityEvidenceError(
          network,
          capability,
          'dogrulama tarihi zorunlu -- tarihsiz kanit bayatligi olculemeyen kanittir.',
        );
      }
    }

    matris[capability] = k.support;
  }

  return matris;
}

/**
 * Sözleşmesi HENÜZ doğrulanmamış bir ağ için kanıt kümesi.
 *
 * Hepsi `unavailable`: "bilmiyoruz". `manual_required` YAZILMIYOR çünkü o
 * bir KARARDIR ("bu iş elle yapılır") ve biz henüz bakamadık. İkisini
 * karıştırmak, bir BOŞLUĞU karar gibi göstermek ve o ağa bir daha hiç
 * bakmamak demektir.
 */
export function unverifiedEvidence(note: string): CapabilityEvidenceMap {
  return Object.fromEntries(
    PROVIDER_CAPABILITIES.map((c) => [
      c,
      { support: 'unavailable' as const, source: null, verifiedAt: null, note },
    ]),
  ) as CapabilityEvidenceMap;
}
