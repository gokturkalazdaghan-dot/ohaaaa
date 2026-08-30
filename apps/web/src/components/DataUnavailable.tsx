import Link from 'next/link';

import { AlertIcon } from './Icons';

/**
 * Veri kaynağına ulaşılamadığında gösterilen SUNUCU TARAFI mesaj.
 *
 * `error.tsx` sınırı istemci bileşenidir: Next, sunucu hatasında boş bir
 * kabuk gönderip mesajı tarayıcıda oluşturur. JavaScript kapalıysa veya
 * yüklenmeden önce kullanıcı bomboş bir sayfa görür.
 *
 * Bu bileşen, en çok ziyaret edilen sayfalarda o boşluğu kapatır: hata
 * yakalanır ve gerçek HTML olarak yanıtlanır.
 *
 * ÖRNEK VERİYE DÜŞÜLMEZ. Veritabanı erişilemezken demo fiyat göstermek,
 * kullanıcıya gerçek olmayan bir fiyat söylemektir — sayfayı hiç
 * gösterememekten daha zararlıdır.
 */
export function DataUnavailable({
  title = 'Fiyatları şu an gösteremiyoruz',
  description = 'Veri kaynağımıza geçici olarak ulaşamıyoruz. Size eski veya yanlış bir fiyat göstermektense hiç göstermemeyi tercih ediyoruz.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-warning/12 text-warning">
        <AlertIcon className="h-7 w-7" />
      </span>

      <h1 className="mt-5 text-2xl font-black tracking-tight">{title}</h1>
      <p className="mt-3 leading-relaxed text-muted">{description}</p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-xl bg-gradient-to-r from-brand to-electric px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
        >
          Ana sayfaya dön
        </Link>
        <Link
          href="/sss"
          className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-brand/45"
        >
          Sıkça sorulan sorular
        </Link>
      </div>
    </div>
  );
}
