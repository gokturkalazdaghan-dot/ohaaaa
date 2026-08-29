/**
 * robots.txt ayrıştırıcısı (RFC 9309).
 *
 * Bu dosyanın bir "atlatma" seçeneği YOKTUR ve olmayacaktır. Sebebi ahlaki
 * olduğu kadar pratiktir: gelirimizin tamamı ortaklık hesaplarımızdan gelir
 * ve o sözleşmelerin hepsi izinsiz otomatik erişimi yasaklar. Yasağı çiğneyip
 * yakalanmanın bedeli tarayıcının durması değil, GELİR KAYNAĞININ kapanmasıdır.
 *
 * Uygulanan kurallar:
 *   • En eşleşen (most specific) user-agent grubu kazanır; yoksa `*` grubu.
 *   • Allow/Disallow'da en UZUN kalıp kazanır; eşitlikte Allow kazanır.
 *   • `*` (herhangi bir dizi) ve `$` (satır sonu) joker karakterleri desteklenir.
 *   • Crawl-delay standart dışıdır ama yaygındır; uygulanır.
 */

export interface RobotsRule {
  /** true = Allow, false = Disallow */
  allow: boolean;
  /** Ham kalıp (ör. "/urun/*.json$") */
  pattern: string;
}

export interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

export interface RobotsTxt {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobotsTxt(content: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let current: RobotsGroup | null = null;
  // Ardışık User-agent satırları TEK bir grubu paylaşır:
  //   User-agent: a
  //   User-agent: b
  //   Disallow: /x
  // → hem a hem b için /x yasak.
  let expectingMoreAgents = false;

  for (const rawLine of content.split(/\r?\n/)) {
    // '#' yorum başlatır; satır içinde de geçerlidir.
    const line = rawLine.split('#')[0]!.trim();
    if (line === '') continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    switch (field) {
      case 'user-agent': {
        if (!expectingMoreAgents || current === null) {
          current = { userAgents: [], rules: [], crawlDelaySeconds: null };
          groups.push(current);
        }
        current.userAgents.push(value.toLowerCase());
        expectingMoreAgents = true;
        break;
      }

      case 'allow':
      case 'disallow': {
        if (current === null) break; // gruba ait olmayan kural yok sayılır
        expectingMoreAgents = false;

        // "Disallow:" (boş değer) "hiçbir şey yasak değil" demektir.
        if (field === 'disallow' && value === '') break;

        current.rules.push({ allow: field === 'allow', pattern: value });
        break;
      }

      case 'crawl-delay': {
        if (current === null) break;
        expectingMoreAgents = false;

        const seconds = Number.parseFloat(value);
        if (Number.isFinite(seconds) && seconds >= 0) {
          current.crawlDelaySeconds = seconds;
        }
        break;
      }

      case 'sitemap': {
        // Sitemap grup dışıdır, dosyanın tamamına aittir.
        if (value !== '') sitemaps.push(value);
        break;
      }

      default:
        break;
    }
  }

  return { groups, sitemaps };
}

/**
 * Bizim user-agent'ımıza uygulanacak grubu seçer.
 *
 * En uzun (en spesifik) eşleşme kazanır: "ohaaaabot" grubu varsa "*" yerine
 * o kullanılır. Site bize özel bir kural yazmışsa niyeti odur.
 */
export function selectGroup(robots: RobotsTxt, userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();

  let best: RobotsGroup | null = null;
  let bestLength = -1;

  for (const group of robots.groups) {
    for (const candidate of group.userAgents) {
      const matches = candidate === '*' || ua.includes(candidate);
      if (!matches) continue;

      // '*' en zayıf eşleşmedir; uzunluğu 0 sayılır.
      const length = candidate === '*' ? 0 : candidate.length;
      if (length > bestLength) {
        best = group;
        bestLength = length;
      }
    }
  }

  return best;
}

/**
 * Bir yolun taranmasına izin var mı?
 *
 * robots.txt bulunamadığında (404) çağıran taraf bu fonksiyonu hiç
 * çağırmaz — "dosya yok" izin demektir. Ancak dosya alınamadıysa (5xx,
 * zaman aşımı) varsayılan YASAKTIR: sunucunun ne istediğini bilmiyoruz.
 */
export function isAllowed(
  robots: RobotsTxt,
  userAgent: string,
  pathname: string,
): boolean {
  const group = selectGroup(robots, userAgent);
  if (!group || group.rules.length === 0) return true;

  let decision = true;
  let decisionLength = -1;

  for (const rule of group.rules) {
    if (!matchesPattern(rule.pattern, pathname)) continue;

    // Joker içermeyen kalıpta uzunluk = kalıp uzunluğu (RFC 9309).
    const length = rule.pattern.length;

    if (length > decisionLength) {
      decision = rule.allow;
      decisionLength = length;
    } else if (length === decisionLength && rule.allow) {
      // Eşit uzunlukta Allow kazanır.
      decision = true;
    }
  }

  return decision;
}

export function crawlDelayFor(robots: RobotsTxt, userAgent: string): number | null {
  return selectGroup(robots, userAgent)?.crawlDelaySeconds ?? null;
}

/**
 * robots.txt kalıbını yola uygular.
 *
 * Kalıp bir ÖN EKTİR: "/admin" → "/admin", "/administrator", "/admin/x"
 * hepsini kapsar. `*` herhangi bir diziyi, `$` satır sonunu belirtir.
 */
function matchesPattern(pattern: string, pathname: string): boolean {
  if (pattern === '') return false;
  if (pattern === '/') return true;

  const anchoredToEnd = pattern.endsWith('$');
  const body = anchoredToEnd ? pattern.slice(0, -1) : pattern;

  // Joker yoksa düz ön ek karşılaştırması yeterli (ve çok daha hızlı).
  if (!body.includes('*')) {
    return anchoredToEnd ? pathname === body : pathname.startsWith(body);
  }

  const escaped = body
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${escaped}${anchoredToEnd ? '$' : ''}`).test(pathname);
}
