import { AlertIcon } from './Icons';

/**
 * Supabase yapılandırılmadığında gösterilir.
 *
 * Demo verinin canlı veri sanılması, bu projede yapılabilecek en pahalı
 * yanlış anlaşılmadır; bu yüzden uyarı gizlenebilir değildir.
 */
export function DemoBanner() {
  return (
    <div className="border-b border-warning/25 bg-warning/10">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 text-xs text-warning sm:px-6">
        <AlertIcon className="h-4 w-4 shrink-0" />
        <p>
          <strong className="font-semibold">Demo modu.</strong>{' '}
          Supabase yapılandırılmadığı için yerleşik örnek veri gösteriliyor.
          Canlı veriye geçmek için <code className="font-mono">.env.example</code> dosyasını{' '}
          <code className="font-mono">.env</code> olarak kopyalayıp doldurun.
        </p>
      </div>
    </div>
  );
}
