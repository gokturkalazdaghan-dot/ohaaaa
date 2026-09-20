'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

import { ChevronDownIcon, categoryIcon } from '@/components/Icons';
import { t, type Category, type CategoryNode, type Locale } from '@ohaaaa/shared';

/**
 * Ana sayfadaki kategori gezgini: önce YALNIZCA ana başlıklar.
 *
 * ÖLÇÜLEN ARIZA
 * Ana sayfa 6 ana kategoriyi ve 21 alt kategoriyi AYNI ANDA, aynı görünüşte
 * çip olarak diziyordu -- 27 çip, hepsi eşit ağırlıkta. Telefon ekranında bu,
 * arama kutusunun altını baştan aşağı dolduran bir duvar oluşturuyor ve
 * sayfanın asıl içeriğini (fırsatlar, öne çıkan ürünler) ekranın çok
 * aşağısına itiyordu. Kullanıcı Safari ekran görüntüsüyle tam olarak bunu
 * bildirdi.
 *
 * Üst kategoriyi alt kategoriden yalnızca ikonun varlığı ayırıyordu:
 * "Elektronik" ile "Kulaklık" görsel olarak eşitti, yani taksonominin
 * seviyesi arayüzde hiç görünmüyordu.
 *
 * KARAR
 * Kapalıyken YALNIZCA ana başlıklar durur (altı satır). Bir başlığa
 * dokunulunca o kategorinin alt kategorileri açılır. Aynı anda tek bölüm
 * açık kalır: iki bölüm birden açıksa telefonda yine kaydırılamayan bir
 * liste oluşurdu ve sorun geri gelirdi.
 *
 * VERİ KAYNAĞI DEĞİŞMEDİ. Ağaç `getCategoryTree()`'den geliyor, yani
 * kanonik taksonominin kendisinden; burada elle yazılmış kategori listesi
 * YOKTUR. Yeni bir ana kategori eklendiğinde bu bileşen onu kendiliğinden
 * gösterir, kod değişmez. Adresler de aynı: `/kategori/<slug>`.
 *
 * NEDEN İSTEMCİ BİLEŞENİ
 * Üst çubuktaki şerit (`CategoryNav`) saf CSS ile açılıyor ve sunucuda
 * kalıyor; orada bu doğru karardı çünkü şerit yalnızca geniş ekranda ve
 * yalnızca `hover`/`focus-within` ile açılıyor. Burada açılma DOKUNMAYLA
 * olmak zorunda ve `aria-expanded` gerçek duruma bağlı olmalı. CSS ile
 * açılan bir panelde `aria-expanded` yazılamaz: sunucuda basılan değer
 * sabit kalır ve panel açıkken ekran okuyucuya "kapalı" denir -- yanlış
 * bilgi, hiç bilgi vermemekten kötüdür.
 *
 * `<details>`/`<summary>` de düşünüldü ve seçilmedi: durumu tarayıcı tutar
 * ama Safari/VoiceOver'da açık/kapalı durumunun bildirimi tarayıcı
 * sürümüne göre değişir -- ve bildirilen arıza tam da Safari'de. Otuz
 * satırlık durum, taşınabilir davranıştan ucuz değildir.
 *
 * Veri yine SUNUCUDA okunuyor; istemciye inen tek şey açma/kapama.
 */
/**
 * `kart`    : ana sayfadaki çerçeveli liste.
 * `cekmece` : telefondaki kenar menüsünün içi -- çerçeve yok, satırlar
 *             daha yüksek (baş parmak hedefi), yazı biraz daha büyük.
 *
 * İki KOPYA yazmak yerine tek bileşenin iki görünümü var: akordeonun
 * mantığı (tek bölüm açık, `aria-expanded`, panelin kapalıyken hiç
 * çizilmemesi) iki yerde ayrı ayrı yazılsaydı, biri düzeltilip diğeri
 * unutulduğunda menü iki yerde farklı davranırdı.
 */
export type KategoriGorunumu = 'kart' | 'cekmece';

export function CategoryBrowser({
  nodes,
  locale,
  gorunum = 'kart',
  etiket,
}: {
  nodes: CategoryNode<Category>[];
  locale: Locale;
  gorunum?: KategoriGorunumu;
  /** Landmark adı. İki menü aynı adı taşıyamaz (axe: benzersiz olmalı). */
  etiket?: string;
}) {
  const [acikKimlik, setAcikKimlik] = useState<string | null>(null);
  const onEk = useId();

  if (nodes.length === 0) return null;

  const cekmece = gorunum === 'cekmece';
  const listeSinifi = cekmece
    ? 'divide-y divide-line/60'
    : 'divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface';
  /* Çekmecede satır daha yüksek: baş parmakla vurulan hedef en az 44px. */
  const satirSinifi = cekmece
    ? 'flex w-full items-center gap-3 rounded-lg px-3 py-3.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand'
    : 'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand';
  const panelSinifi = cekmece
    ? 'px-3 pb-3'
    : 'border-t border-line bg-surface-2 px-4 py-3';

  return (
    /*
      Etiket üst çubuktaki şeritten AYRI olmak zorunda: iki landmark aynı
      adı taşıyınca ekran okuyucu ikisini ayırt edemiyor ve axe bunu ihlal
      sayıyor ("landmark must have a unique aria-label"). Şerit
      `ev.kategoriler` adını kullanıyor; burası ana sayfanın kendi listesi.
    */
    <nav
      aria-label={etiket ?? t(locale, 'ev.kategorilerGez')}
      className={cekmece ? undefined : 'mt-6'}
    >
      <ul className={listeSinifi}>
        {nodes.map((node) => {
          const acik = acikKimlik === node.category.id;
          const panelKimligi = `${onEk}-${node.category.id}`;
          const Ikon = categoryIcon(node.category);
          const altlar = node.children;

          return (
            <li key={node.category.id}>
              {/*
                ANA BAŞLIK BİR DÜĞMEDİR, BAĞLANTI DEĞİL.

                Bağlantı olsaydı dokunmak kategori sayfasına giderdi ve alt
                kategoriler ana sayfada hiç açılamazdı -- istenen davranış
                bu değil. Kategori sayfasına giden yol kapanmıyor: panelin
                içindeki "Tümünü gör" bağlantısı oraya gidiyor.

                Alt kategorisi olmayan bir ana kategori DÜĞME DEĞİL, doğrudan
                bağlantı olarak çiziliyor: açılacak bir şeyi olmayan düğme,
                dokunana hiçbir şey yapmayan bir düğmedir.
              */}
              {altlar.length === 0 ? (
                <Link
                  href={`/kategori/${node.category.slug}`}
                  className={satirSinifi}
                >
                  {Ikon ? <Ikon className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" /> : null}
                  <span className="flex-1 font-semibold">{node.category.name}</span>
                  <span className="tabular text-xs text-subtle">
                    {node.groupCount.toLocaleString(locale)}
                  </span>
                </Link>
              ) : (
                <button
                  type="button"
                  aria-expanded={acik}
                  aria-controls={panelKimligi}
                  onClick={() => setAcikKimlik(acik ? null : node.category.id)}
                  className={satirSinifi}
                >
                  {Ikon ? <Ikon className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" /> : null}
                  <span className="flex-1 font-semibold">{node.category.name}</span>
                  {/*
                    Sayı gösteriliyor çünkü ölçülmüş bir değer: kullanıcı
                    hangi rafın dolu olduğunu ancak böyle görür.
                  */}
                  <span className="tabular text-xs text-subtle">
                    {node.groupCount.toLocaleString(locale)}
                  </span>
                  <ChevronDownIcon
                    className={`h-4 w-4 shrink-0 text-subtle transition-transform ${
                      acik ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>
              )}

              {/*
                PANEL AÇIK DEĞİLKEN HİÇ ÇİZİLMEZ.

                `hidden` ile gizlemek de olurdu ama o zaman 21 alt kategori
                bağlantısı her ana sayfa yüklemesinde HTML'e basılır ve
                ekran okuyucuda gezinen kullanıcı gizli olmayan bir sırayla
                karşılaşma riskine girerdi. Çizmemek hem daha küçük bir
                sayfa hem daha az yanlış anlaşılacak bir ağaç.
              */}
              {acik && altlar.length > 0 && (
                <div id={panelKimligi} className={panelSinifi}>
                  {/*
                    Alt kategoriler ÇİP olarak: mevcut tasarım dili bu ve
                    sarmalanan bir çip kümesi, tek sütunlu uzun bir listeden
                    telefonda çok daha az yer kaplıyor.

                    Yalnızca L2 gösteriliyor. L3 (ürün kategorileri) ana
                    sayfaya gelseydi tek bir başlık altında onlarca bağlantı
                    açılırdı -- kaldırılmak istenen duvarın aynısı, bir
                    tık ötede. L3'e giden yollar kapanmıyor: üst çubuktaki
                    şerit ve kategori sayfası ikisini de listeliyor.
                  */}
                  <ul className="flex flex-wrap gap-2">
                    {altlar.map((alt) => (
                      <li key={alt.category.id}>
                        <Link href={`/kategori/${alt.category.slug}`} className="chip">
                          {alt.category.name}
                          <span className="tabular text-2xs text-subtle">
                            {alt.groupCount.toLocaleString(locale)}
                          </span>
                        </Link>
                      </li>
                    ))}
                    <li>
                      {/*
                        "Tümünü gör" kategorinin KENDİ sayfasına gider:
                        panel yalnızca alt kategorileri gösteriyor,
                        ürünlerin tamamı orada.
                      */}
                      <Link
                        href={`/kategori/${node.category.slug}`}
                        className="chip font-semibold text-brand"
                      >
                        {t(locale, 'ortak.tumunuGor')}
                      </Link>
                    </li>
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
