'use client';

/**
 * Etkileşimli bento galerisi — sürüklenebilir ızgara + büyütme kipi.
 *
 * KAYNAK ve UYARLAMA
 * Tasarım hazır bir bileşenden alındı. Olduğu gibi kopyalanmadı; üç şey
 * değiştirildi ve her birinin sebebi ölçülebilir:
 *
 * 1) RENKLER TOKEN'A BAĞLANDI. Özgün hâl `bg-gray-50/50`, `text-gray-900`,
 *    `from-white dark:via-gray-200` gibi SABİT renkler kullanıyordu. Bu
 *    depoda tema iki durumlu (bej açık + koyu) ve renkler `--bg`,
 *    `--surface`, `--text` token'larından geliyor. Sabit renkler bej
 *    zeminde yanlış kontrast, koyu temada ise okunamaz metin üretirdi.
 *
 * 2) İKİ GERÇEK HATA DÜZELTİLDİ (aşağıda yerinde açıklandı): video
 *    temizliğinde ref yakalama, ve prop değişince iç durumun bayat kalması.
 *
 * 3) GALERİ BİR KEŞİF YÜZEYİ OLDU. Özgün hâl yalnızca büyütme yapıyordu.
 *    Ohaaaa'da bir ürün görseline tıklayan kullanıcı o ürüne gitmek ister;
 *    büyütme kipine fiyat ve ürün bağlantısı eklendi. Dekoratif bir galeri
 *    ile keşif yüzeyi arasındaki fark budur.
 */

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ExternalLink } from 'lucide-react';
import { formatMoney } from '@ohaaaa/shared';

/**
 * Galeride gösterilen bir kalem.
 *
 * `href` ve `priceCents` EKLENDİ: özgün tipte yoktu. Ohaaaa'nın galerisi
 * gerçek ürünlerle besleniyor, dolayısıyla her kalem bir ürün sayfasına
 * ve gerçek bir fiyata karşılık geliyor.
 */
export interface BentoMediaItem {
  id: string;
  type: 'image' | 'video';
  title: string;
  desc: string;
  url: string;
  /** Tailwind ızgara yerleşimi: `md:col-span-2 md:row-span-3` gibi. */
  span: string;
  /** Ürün sayfası yolu. Yoksa kalem tıklanınca yalnızca büyür. */
  href?: string;
  priceCents?: number | null;
  /** Fiyatın GERÇEK para birimi. Verilmezse fiyat gösterilmez. */
  currency?: string;
}

function MediaItem({
  item,
  className,
  onClick,
}: {
  item: BentoMediaItem;
  className?: string;
  onClick?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);

  useEffect(() => {
    /*
     * REF YEREL DEĞİŞKENE ALINIYOR.
     *
     * Özgün hâl temizlik fonksiyonunda `videoRef.current` okuyordu. Temizlik
     * bileşen SÖKÜLDÜKTEN sonra çalışır ve o anda `current` çoktan null
     * olmuş olabilir -- yani `unobserve` hiç çağrılmaz ve gözlemci sızar.
     * Etki kipi açılıp kapandıkça birikir.
     */
    const element = videoRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setIsInView(entry.isIntersecting);
      },
      { root: null, rootMargin: '50px', threshold: 0.1 },
    );

    observer.observe(element);
    return () => observer.unobserve(element);
  }, []);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    let mounted = true;

    const oynat = async () => {
      if (!mounted || !isInView) return;
      try {
        if (element.readyState < 3) {
          setIsBuffering(true);
          await new Promise<void>((coz) => {
            element.oncanplay = () => coz();
          });
        }
        if (!mounted) return;
        setIsBuffering(false);
        await element.play();
      } catch {
        /*
         * Otomatik oynatma engeli HATA DEĞİLDİR: tarayıcı politikası
         * sessizce reddedebilir. Konsolu kirletmek yerine yok sayılıyor;
         * görsel yine duruyor, yalnızca oynamıyor.
         */
      }
    };

    if (isInView) void oynat();
    else element.pause();

    return () => {
      mounted = false;
      element.pause();
    };
  }, [isInView]);

  if (item.type === 'video') {
    return (
      <div className={`${className} relative overflow-hidden`}>
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          onClick={onClick}
          playsInline
          muted
          loop
          preload="metadata"
          style={{ opacity: isBuffering ? 0.8 : 1, transition: 'opacity 0.2s' }}
        >
          <source src={item.url} type="video/mp4" />
        </video>
        {isBuffering && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        )}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- depo genelinde
    // düz <img> kullanılıyor; `next/image` hiç import edilmiyor ve uzak
    // görsel optimizasyonu bilinçli olarak kapalı (bkz. next.config.ts).
    <img
      src={item.url}
      alt={item.title}
      className={`${className} cursor-pointer object-cover`}
      onClick={onClick}
      loading="lazy"
      decoding="async"
    />
  );
}

function GalleryModal({
  selectedItem,
  onClose,
  setSelectedItem,
  mediaItems,
}: {
  selectedItem: BentoMediaItem;
  onClose: () => void;
  setSelectedItem: (item: BentoMediaItem | null) => void;
  mediaItems: BentoMediaItem[];
}) {
  const [dockPosition, setDockPosition] = useState({ x: 0, y: 0 });

  return (
    <>
      <motion.div
        initial={{ scale: 0.98, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.98, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="fixed inset-0 z-40 overflow-hidden bg-bg/95 backdrop-blur-lg"
      >
        <div className="flex h-full flex-col">
          <div className="flex flex-1 items-center justify-center bg-surface-2/60 p-2 sm:p-3 md:p-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedItem.id}
                className="relative h-auto max-h-[70vh] w-full max-w-[95%] overflow-hidden rounded-lg shadow-lg sm:max-w-[85%] md:max-w-3xl"
                initial={{ y: 20, scale: 0.97 }}
                animate={{
                  y: 0,
                  scale: 1,
                  transition: { type: 'spring', stiffness: 500, damping: 30, mass: 0.5 },
                }}
                exit={{ y: 20, scale: 0.97, transition: { duration: 0.15 } }}
              >
                <MediaItem
                  item={selectedItem}
                  className="max-h-[70vh] w-full bg-surface object-contain"
                />

                {/*
                  BÜYÜTME KİPİ BİR KEŞİF YÜZEYİ.
                  Özgün tasarımda yalnızca başlık ve açıklama vardı. Ohaaaa'da
                  kullanıcı ürüne gitmek ister; fiyat ve bağlantı bu yüzden
                  burada. Fiyat GERÇEK para biriminde basılır -- para birimi
                  bilinmiyorsa HİÇ gösterilmez.
                */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-3 sm:p-4">
                  <h3 className="text-base font-semibold text-white sm:text-lg md:text-xl">
                    {selectedItem.title}
                  </h3>
                  <p className="mt-1 text-xs text-white/80 sm:text-sm">{selectedItem.desc}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {selectedItem.priceCents !== null
                      && selectedItem.priceCents !== undefined
                      && selectedItem.currency && (
                        <span className="tabular text-lg font-bold text-white">
                          {formatMoney(selectedItem.priceCents, selectedItem.currency)}
                        </span>
                      )}

                    {selectedItem.href && (
                      <Link
                        href={selectedItem.href}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
                      >
                        Ürünü gör
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <button
          type="button"
          aria-label="Galeriyi kapat"
          className="absolute right-3 top-3 rounded-full bg-surface p-2 text-text shadow-md transition-colors hover:bg-surface-hover"
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </motion.div>

      {/* Sürüklenebilir küçük resim şeridi. */}
      <motion.div
        drag
        dragMomentum={false}
        dragElastic={0.1}
        initial={false}
        animate={{ x: dockPosition.x, y: dockPosition.y }}
        onDragEnd={(_, info) =>
          setDockPosition((onceki) => ({
            x: onceki.x + info.offset.x,
            y: onceki.y + info.offset.y,
          }))
        }
        className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 touch-none"
      >
        <div className="cursor-grab rounded-xl border border-line-strong bg-surface/90 shadow-lg backdrop-blur-xl active:cursor-grabbing">
          <div className="flex items-center -space-x-2 px-3 py-2">
            {mediaItems.map((item, index) => (
              <motion.button
                type="button"
                key={item.id}
                aria-label={item.title}
                onClick={(olay) => {
                  olay.stopPropagation();
                  setSelectedItem(item);
                }}
                style={{
                  zIndex: selectedItem.id === item.id ? 30 : mediaItems.length - index,
                }}
                className={`relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg sm:h-9 sm:w-9 md:h-10 md:w-10 ${
                  selectedItem.id === item.id
                    ? 'ring-2 ring-brand shadow-lg'
                    : 'hover:ring-2 hover:ring-line-strong'
                }`}
                initial={{ rotate: index % 2 === 0 ? -15 : 15 }}
                animate={{
                  scale: selectedItem.id === item.id ? 1.2 : 1,
                  rotate: selectedItem.id === item.id ? 0 : index % 2 === 0 ? -15 : 15,
                  y: selectedItem.id === item.id ? -8 : 0,
                }}
                whileHover={{
                  scale: 1.3,
                  rotate: 0,
                  y: -10,
                  transition: { type: 'spring', stiffness: 400, damping: 25 },
                }}
              >
                <MediaItem item={item} className="h-full w-full" />
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>
    </>
  );
}

export function InteractiveBentoGallery({
  mediaItems,
  title,
  description,
}: {
  mediaItems: BentoMediaItem[];
  title: string;
  description: string;
}) {
  const [selectedItem, setSelectedItem] = useState<BentoMediaItem | null>(null);
  const [items, setItems] = useState(mediaItems);
  const [isDragging, setIsDragging] = useState(false);

  /*
   * PROP DEĞİŞİNCE İÇ DURUM TAZELENİR.
   *
   * Özgün hâl `useState(mediaItems)` ile başlatıp bir daha hiç senkronlamıyordu.
   * `useState` yalnızca İLK render'da okunur; katalog yenilendiğinde galeri
   * ESKİ listeyi göstermeye devam ederdi. Sessiz bir hata: ekranda eski
   * ürünler kalır.
   *
   * NEDEN `useEffect` DEĞİL: effect içinde senkron `setState` çağırmak
   * zincirleme render üretir ve linter bunu haklı olarak reddediyor. React'in
   * bu durum için belgelenmiş kalıbı RENDER SIRASINDA ayarlamaktır: önceki
   * prop'u hatırla, değiştiyse durumu sıfırla. React bu render'ı hemen,
   * DOM'a hiç dokunmadan yeniden başlatır -- ekstra geçiş yok.
   *
   * Kullanıcının sürükleyerek yaptığı sıralama bu sayede korunuyor: yalnızca
   * GELEN LİSTE değiştiğinde sıfırlanıyor, her render'da değil.
   */
  const [oncekiListe, setOncekiListe] = useState(mediaItems);
  if (oncekiListe !== mediaItems) {
    setOncekiListe(mediaItems);
    setItems(mediaItems);
  }

  if (items.length === 0) return null;

  return (
    <div className="w-full">
      <div className="mb-6 text-center">
        <motion.h2
          className="text-2xl font-bold text-text sm:text-3xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {title}
        </motion.h2>
        <motion.p
          className="mt-2 text-sm text-muted sm:text-base"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          {description}
        </motion.p>
      </div>

      <AnimatePresence mode="wait">
        {selectedItem ? (
          <GalleryModal
            selectedItem={selectedItem}
            onClose={() => setSelectedItem(null)}
            setSelectedItem={setSelectedItem}
            mediaItems={items}
          />
        ) : (
          <motion.div
            className="grid auto-rows-[60px] grid-cols-1 gap-3 sm:grid-cols-3 md:grid-cols-4"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={{
              hidden: { opacity: 0 },
              visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
            }}
          >
            {items.map((item, index) => (
              <motion.div
                key={item.id}
                layoutId={`media-${item.id}`}
                className={`relative cursor-move overflow-hidden rounded-xl bg-surface-2 ${item.span}`}
                onClick={() => !isDragging && setSelectedItem(item)}
                variants={{
                  hidden: { y: 50, scale: 0.9, opacity: 0 },
                  visible: {
                    y: 0,
                    scale: 1,
                    opacity: 1,
                    transition: {
                      type: 'spring',
                      stiffness: 350,
                      damping: 25,
                      delay: index * 0.05,
                    },
                  },
                }}
                whileHover={{ scale: 1.02 }}
                drag
                dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                dragElastic={1}
                onDragStart={() => setIsDragging(true)}
                onDragEnd={(_, info) => {
                  setIsDragging(false);
                  const mesafe = info.offset.x + info.offset.y;
                  if (Math.abs(mesafe) <= 50) return;

                  setItems((onceki) => {
                    const yeni = [...onceki];
                    const hedef =
                      mesafe > 0
                        ? Math.min(index + 1, yeni.length - 1)
                        : Math.max(index - 1, 0);
                    const [tasinan] = yeni.splice(index, 1);
                    if (tasinan) yeni.splice(hedef, 0, tasinan);
                    return yeni;
                  });
                }}
              >
                <MediaItem item={item} className="absolute inset-0 h-full w-full" />
                <div className="absolute inset-0 flex flex-col justify-end p-2 sm:p-3">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent opacity-0 transition-opacity duration-200 hover:opacity-100" />
                  <h3 className="relative line-clamp-1 text-xs font-medium text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 sm:text-sm">
                    {item.title}
                  </h3>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default InteractiveBentoGallery;
