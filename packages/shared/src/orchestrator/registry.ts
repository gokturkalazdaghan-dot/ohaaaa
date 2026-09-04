/**
 * Ajan kayıt defteri ve YETENEK yönlendirmesi.
 *
 * SEÇİM ADLA DEĞİL YETENEKLE YAPILIR (madde 9).
 * Adla seçim, çağıran tarafı belirli bir ajana zincirler: ajanı
 * iyileştirmek için adını korumak ya da her çağrıyı düzenlemek gerekir.
 * Yetenekle seçimde ise "fiyat analizi yapabilen bir şey" istenir ve
 * hangi ajanın bunu yaptığı bir yapılandırma detayı olur.
 */

import type { Market } from '../market.js';
import type { AgentDefinition, SupervisorId } from './types.js';

export class AgentRegistry {
  private readonly byId = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition): void {
    if (this.byId.has(agent.id)) {
      // Sessizce üzerine yazmak, iki farklı ajanın aynı kimlikle
      // kaydolduğu durumu gizlerdi -- ve hangisinin çalıştığı yükleme
      // sırasına bağlı hâle gelirdi.
      throw new Error(`Ajan kimliği zaten kayıtlı: ${agent.id}`);
    }
    this.byId.set(agent.id, agent);
  }

  get(id: string): AgentDefinition | undefined {
    return this.byId.get(id);
  }

  all(): AgentDefinition[] {
    return [...this.byId.values()];
  }

  bySupervisor(supervisor: SupervisorId): AgentDefinition[] {
    return this.all().filter((a) => a.supervisor === supervisor);
  }

  /**
   * Bir yeteneği, VERİLEN PAZARDA sağlayabilen ajanlar.
   *
   * Pazar filtresi burada, seçim anında uygulanıyor -- ajanın içinde
   * değil. İçeride olsaydı her ajan kendi pazar kontrolünü yazmak
   * zorunda kalırdı ve bir tanesinin unutması, Alman kullanıcıya Türk
   * teklifi göstermek demek olurdu.
   */
  findByCapability(capability: string, market: Market): AgentDefinition[] {
    return this.all().filter(
      (a) =>
        a.enabled &&
        a.capabilities.includes(capability) &&
        (a.marketScope === 'all' || a.marketScope.includes(market)),
    );
  }

  /**
   * Yeteneği sağlayan TEK ajanı seçer.
   *
   * Birden çok aday varsa ilki değil, HATA döner. "İlkini al" sessiz bir
   * karardır ve hangi ajanın çalıştığı kayıt sırasına bağlı olur; iki
   * ajanın aynı yeteneği iddia etmesi çözülmesi gereken bir yapılandırma
   * hatasıdır, çalışma anında kura çekilecek bir durum değil.
   */
  resolve(capability: string, market: Market): AgentDefinition {
    const adaylar = this.findByCapability(capability, market);

    if (adaylar.length === 0) {
      throw new Error(
        `"${capability}" yeteneğini ${market} pazarında sağlayan etkin ajan yok.`,
      );
    }
    if (adaylar.length > 1) {
      throw new Error(
        `"${capability}" yeteneğini ${market} pazarında birden çok ajan sağlıyor: ` +
          adaylar.map((a) => a.id).join(', '),
      );
    }

    return adaylar[0]!;
  }
}
