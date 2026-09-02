import type { Metadata } from 'next';
import Link from 'next/link';

import { ContentPage, Notice } from '@/components/ContentPage';

export const metadata: Metadata = {
  title: 'OhaaaaBot — Tarayıcı Ajanı Hakkında',
  description:
    'OhaaaaBot nedir, hangi kurallara uyar, sitenizden nasıl engellersiniz ' +
    've bize nasıl ulaşırsınız.',
  alternates: { canonical: '/bot' },
};

/**
 * Bot bilgi sayfası.
 *
 * Tarayıcımızın User-Agent dizesi bu adrese işaret eder:
 *   OhaaaaBot/1.0 (+https://ohaaaa.com/bot; iletisim@ohaaaa.com)
 *
 * Bir site yöneticisi günlüklerinde bilmediği bir botu görünce ilk yapacağı
 * şey o adrese bakmaktır. Orada bir şey bulamazsa yapacağı ikinci şey botu
 * engellemektir. Bu sayfa tam olarak o anı hedefler — ve İngilizcesi de
 * vardır, çünkü altyapı ekiplerinin çoğu İngilizce okur.
 */
export default function BotPage() {
  return (
    <ContentPage
      title="OhaaaaBot"
      description="Sitenizi ziyaret eden tarayıcı ajanımız hakkında bilmeniz gereken her şey."
      updatedAt="2026-08-30"
      breadcrumb="Bot"
    >
      <Notice>
        <strong>Kimlik:</strong>{' '}
        <code className="font-mono text-xs">
          OhaaaaBot/1.0 (+https://ohaaaa.com/bot; iletisim@ohaaaa.com)
        </code>
      </Notice>

      <h2>Ne yapıyor?</h2>
      <p>
        Ohaaaa bir fiyat karşılaştırma platformudur. OhaaaaBot, <strong>izin
        verdiğiniz</strong> ürün feed’lerini ve sayfaları okuyarak fiyat ve stok
        bilgisini günceller. Amacı sitenizden trafik almak değil,{' '}
        <strong>size trafik göndermektir</strong>: ürünleriniz karşılaştırma
        listemizde görünür ve kullanıcı satın almak için sizin sitenize gider.
      </p>

      <h2>Hangi kurallara uyar?</h2>
      <ul>
        <li>
          <strong>robots.txt zorunludur.</strong> Her alan adı için okunur ve
          uygulanır. Atlatma seçeneği <strong>yoktur</strong>.
        </li>
        <li>
          <strong>robots.txt okunamazsa erişim yapılmaz.</strong> Sunucunuz hata
          döndürürse güvenli varsayım “yasak”tır.
        </li>
        <li>
          <strong>Crawl-delay değeriniz bizimkinden yavaşsa sizinki geçerlidir.</strong>
        </li>
        <li>
          <strong>Varsayılan hız:</strong> alan adı başına en fazla dakikada 30
          istek, istekler arasında en az 2 saniye.
        </li>
        <li>
          <strong>429 veya 503</strong> yanıtında <code>Retry-After</code> süresi
          beklenir; art arda hata gelirse o alan adı o çalışma için bırakılır.
        </li>
        <li>
          <strong>Tarayıcı taklidi yapılmaz.</strong> Proxy rotasyonu, parmak izi
          gizleme veya CAPTCHA atlatma kullanmayız.
        </li>
      </ul>

      <h2>Nasıl engellersiniz?</h2>
      <p>
        <code>robots.txt</code> dosyanıza şunu ekleyin; bir sonraki ziyarette
        geçerli olur:
      </p>
      <pre className="overflow-x-auto rounded-xl border border-line bg-bg p-4 font-mono text-xs text-muted">
        <code>{`User-agent: OhaaaaBot
Disallow: /`}</code>
      </pre>
      <p>Yalnızca belirli bölümleri kapatmak isterseniz:</p>
      <pre className="overflow-x-auto rounded-xl border border-line bg-bg p-4 font-mono text-xs text-muted">
        <code>{`User-agent: OhaaaaBot
Disallow: /siparislerim
Disallow: /degerlendirmelerim
Disallow: /adreslerim
Disallow: /sepet
Crawl-delay: 10`}</code>
      </pre>
      <p>
        Daha hızlı bir sonuç isterseniz{' '}
        <a href="mailto:iletisim@ohaaaa.com">iletisim@ohaaaa.com</a> adresine
        yazın; alan adınızı aynı gün listeden çıkarırız.
      </p>

      <h2>Ürünlerinizin listelenmesini istiyorsanız</h2>
      <p>
        Taramaya hiç gerek yok — <Link href="/tasoron">satıcı programımıza</Link>{' '}
        katılın. Kataloğunuzu tek bir API çağrısıyla gönderirsiniz; fiyat ve stok
        anlık güncellenir, tarama yükü ortadan kalkar.
      </p>

      <hr className="my-10 border-line" />

      {/* İngilizce özet: altyapı ekiplerinin çoğu bu sayfaya İngilizce bakar. */}
      <h2 lang="en">In English</h2>
      <p lang="en">
        <strong>OhaaaaBot</strong> is the crawler of Ohaaaa, a Turkish price
        comparison platform. It reads product feeds and pages you allow, in order
        to keep price and stock data current. We send traffic to merchants; we do
        not resell your content.
      </p>
      <p lang="en">
        The crawler <strong>always obeys robots.txt</strong> (and treats an
        unreachable robots.txt as “disallow”), honours <code>Crawl-delay</code>,
        respects <code>Retry-After</code> on 429/503, and identifies itself
        honestly. We do not rotate proxies, spoof browser fingerprints, or solve
        CAPTCHAs.
      </p>
      <p lang="en">
        To block it, add the following to your <code>robots.txt</code>:
      </p>
      <pre className="overflow-x-auto rounded-xl border border-line bg-bg p-4 font-mono text-xs text-muted">
        <code>{`User-agent: OhaaaaBot
Disallow: /`}</code>
      </pre>
      <p lang="en">
        Questions or removal requests:{' '}
        <a href="mailto:iletisim@ohaaaa.com">iletisim@ohaaaa.com</a>
      </p>
    </ContentPage>
  );
}
