import Link from 'next/link';

import { t } from '@ohaaaa/shared';

import { getCategoryTree } from '@/data/catalog';
import { getRequestLocale } from '@/lib/locale';

/**
 * Üst çubuktaki kategori şeridi.
 *
 * Sunucu bileşeni: kategoriler nadiren değişir ve istemciye bir tur
 * attırmanın anlamı yok. Veri alınamazsa şerit HİÇ ÇİZİLMEZ — üst çubukta
 * boş bir çizgi bırakmak, "kategori yok" gibi görünür.
 *
 * ŞERİT ARTIK AĞAÇTAN BESLENİYOR. İki şey değişti:
 *
 *   1) ALT KATEGORİLER GÖRÜNÜR. Kataloğun neredeyse tamamı alt
 *      kategorilerde (bilgisayar 32.894, telefon 814, kulaklık 541 grup --
 *      ölçüldü) ve hiçbiri menüde yoktu.
 *
 *   2) BOŞ KATEGORİLER DÜŞTÜ. Altı üst kategorinin dördü tamamen boştu;
 *      şeritte durmaları kullanıcıyı ürünsüz bir sayfaya göndermekti.
 */
export async function CategoryNav() {
  const [tree, { contentLocale }] = await Promise.all([
    getCategoryTree().catch(() => []),
    getRequestLocale(),
  ]);
  if (tree.length === 0) return null;

  return (
    /*
      Etiket ana sayfadaki kategori listesinden FARKLI olmak zorunda: iki
      landmark aynı adı taşıyınca ekran okuyucu ikisini ayırt edemiyor ve
      axe bunu ihlal olarak bildiriyor ("landmark must have a unique
      aria-label"). İkisi aynı veriyi gösteriyor ama biri her sayfada duran
      menü, diğeri ana sayfanın kendi listesi.
    */
    /*
      ŞERİT TELEFONDA DA GÖRÜNÜR.

      Ölçülen durum: `hidden md:block` yüzünden kategori şeridi dar
      ekranda HİÇ çizilmiyordu. Yani telefondan gelen ziyaretçinin
      kategoriye göre gezinme yolu yoktu -- yalnızca arama kutusu vardı.
      Ekran görüntülerinde bildirilen eksik buydu.

      Şerit zaten yatay kaydırılıyor ve ürünsüz kategoriler
      `buildCategoryTree` tarafından eleniyor, dolayısıyla dar ekranda
      da tek satır kalıyor.
    */
    <nav
      aria-label={t(contentLocale, 'ev.kategoriler')}
      className="border-t border-line"
    >
      {/*
        DAR EKRANDA YATAY KAYDIRILIR, GENİŞ EKRANDA SARMALANIR.

        `overflow-x-auto` bir KIRPMA BAĞLAMI yaratır: açılır panel şeridin
        dışına taşıdığı anda kesilir. Bu yüzden taşma yalnızca dar ekranda
        açık; geniş ekranda şerit sarmalanıyor ve panel serbestçe
        aşağı açılabiliyor.
      */}
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-1.5 sm:px-6 md:flex-wrap md:overflow-x-visible">
        {/*
          Fırsatlar şeridin BAŞINDA duruyor ve vurgulu: fiyatı düşen ürünler
          sitenin en çok aranan girişi ve kategori listesinin içinde kaybolursa
          hiç tıklanmaz. Bir kategori değil, bu yüzden rengiyle ayrılıyor.
        */}
        <li className="shrink-0">
          <Link
            href="/firsatlar"
            className="block rounded-lg px-3 py-1.5 text-sm font-semibold text-brand transition-colors hover:bg-surface-2"
          >
            {t(contentLocale, 'ortak.firsatlar')}
          </Link>
        </li>
        {tree.map((node) => (
          /*
            ALT KATEGORİLER ARTIK ÜSTÜNÜN ALTINDA AÇILIYOR.

            Önce hepsi tek sırada yan yana diziliyordu: üst kategoriyle alt
            kategoriyi yalnızca renk ayırıyordu ve 21 alt kategori
            dolduğunda şerit okunmaz bir listeye dönüyordu. Hangi alt
            kategorinin hangi üste ait olduğu da görünmüyordu.

            Panel SAF CSS ile açılıyor (`group-hover` + `group-focus-within`):
            bileşen sunucuda kalıyor, istemciye fazladan JavaScript inmiyor.
            `focus-within` klavye için şart -- yalnızca `hover` yazmak,
            klavyeyle gezen kullanıcıya alt kategorileri hiç göstermemek
            olurdu.

            Dokunmatik ekranda panel açılmaz; üst kategoriye dokunmak
            kategori sayfasını açar ve alt kategoriler orada zaten
            listeleniyor. Dokunmayla açılan bir menü, ilk dokunuşu
            "menüyü aç"a çevirip gezinmeyi yavaşlatırdı.
          */
          <li key={node.category.id} className="group relative shrink-0">
            <Link
              href={`/kategori/${node.category.slug}`}
              className="block rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              {node.category.name}
            </Link>

            {node.children.length > 0 && (
              <div
                className="invisible absolute left-0 top-full z-50 hidden max-w-[min(90vw,44rem)] rounded-xl border border-line bg-surface p-2 opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 md:block"
              >
                {/*
                  ÜÇ SEVİYE, İKİ DEĞİL.

                  Kanonik taksonomi L1 > L2 > L3. Panel yalnızca L2'yi
                  gösterseydi ürün kategorileri (L3) menüden hiç
                  görünmezdi: "Bilgisayar Bileşenleri" açılır ama "Ekran
                  Kartı"na yalnızca kategori sayfasından gidilebilirdi.

                  L3'ler kendi L2'sinin ALTINDA, girintili bir liste olarak
                  duruyor. Düz bir listede L2 ile L3'ü yalnızca sıra ayırır
                  ve hangi ürün kategorisinin hangi alt kategoriye ait
                  olduğu görünmez olur -- taksonomiyi menüde çözmek yerine
                  kullanıcıya bırakmak olurdu.

                  Sütunlara bölünüyor çünkü bazı L2'lerin altında altı L3
                  var; tek sütunda panel ekranı aşardı.
                */}
                <ul className="columns-1 gap-4 sm:columns-2 lg:columns-3">
                  {node.children.map((child) => (
                    <li key={child.category.id} className="mb-2 break-inside-avoid">
                      <Link
                        href={`/kategori/${child.category.slug}`}
                        className="flex items-center justify-between gap-4 rounded-lg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
                      >
                        <span>{child.category.name}</span>
                        {/*
                          Sayı gösteriliyor çünkü "Yazıcı (3.464)" ile
                          "Aydınlatma (1)" kullanıcı için aynı şey değil:
                          biri gezilecek bir raf, diğeri tek ürün.
                        */}
                        <span className="text-xs text-subtle">
                          {child.groupCount.toLocaleString(contentLocale)}
                        </span>
                      </Link>

                      {child.children.length > 0 && (
                        <ul className="ml-3 border-l border-line pl-2">
                          {child.children.map((grandChild) => (
                            <li key={grandChild.category.id}>
                              <Link
                                href={`/kategori/${grandChild.category.slug}`}
                                className="flex items-center justify-between gap-3 rounded-lg px-3 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                              >
                                <span>{grandChild.category.name}</span>
                                <span className="text-subtle">
                                  {grandChild.groupCount.toLocaleString(contentLocale)}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
