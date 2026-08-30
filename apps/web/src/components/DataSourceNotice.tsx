import Link from 'next/link';

import { AlertIcon } from './Icons';

/**
 * Panelde gösterilen verinin gerçek mi örnek mi olduğunu bildirir.
 *
 * Bir satıcının örnek ciroyu kendi cirosu sanması, bu projede
 * yapılabilecek en pahalı yanlış anlaşılmadır — bu yüzden uyarı
 * gizlenebilir değildir.
 */
export function DataSourceNotice({
  isLive,
  vendorStatus,
}: {
  isLive: boolean;
  vendorStatus?: 'pending' | 'approved' | 'rejected' | 'suspended' | null;
}) {
  if (isLive) return null;

  const message =
    vendorStatus === 'pending'
      ? 'Başvurunuz değerlendiriliyor. Onaylandığında burada gerçek verileriniz görünecek; şu an örnek veri gösteriliyor.'
      : vendorStatus == null
        ? 'Henüz bir mağaza kaydınız yok. Panel, nasıl görüneceğini anlamanız için örnek veriyle dolduruldu.'
        : 'Örnek veri gösteriliyor.';

  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/8 p-4 text-xs text-warning">
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="leading-relaxed">
        <strong className="font-semibold">Örnek veri.</strong> {message}
        {vendorStatus == null && (
          <>
            {' '}
            <Link href="/tasoron/basvuru" className="underline underline-offset-2">
              Başvuru yapın
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
