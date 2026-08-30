import { missingBusinessFields } from '@/lib/legal';

/**
 * İşletme künyesi tamamlanmadığında yasal sayfaların başına konur.
 *
 * NEDEN GÖRÜNÜR BİR UYARI?
 * Alanlar boşken ekranda yalnızca "—" görünüyor. Bu, eksikliği GİZLER:
 * ziyaretçi tabloyu okur, bilgiyi bulamaz ve sitenin özensiz olduğunu
 * düşünür. Daha kötüsü, mesafeli satış sözleşmesi tarafları adlandırmadan
 * yürürlükteymiş gibi durur.
 *
 * Eksikliği açıkça söylemek hem dürüst hem de güvenli olan yol. Uyarı,
 * bilgiler girildiği anda kendiliğinden kaybolur.
 */
export function LegalIncompleteNotice() {
  const missing = missingBusinessFields().filter((f) => f !== 'KEP adresi');
  if (missing.length === 0) return null;

  return (
    <div
      role="note"
      className="mb-8 rounded-xl border border-warning/40 bg-warning/[0.07] p-4 text-sm leading-relaxed"
    >
      <p className="font-semibold text-fg">İşletme kaydı tamamlanmadı</p>
      <p className="mt-1 text-muted">
        Bu sayfadaki künye bilgileri henüz girilmemiştir; site ticari faaliyete
        hazırlık aşamasındadır. Eksik alanlar:{' '}
        <span className="text-fg">{missing.join(', ')}</span>.
      </p>
      <p className="mt-2 text-muted">
        Bu bilgiler tamamlanana kadar sipariş verilmemesini öneririz.
      </p>
    </div>
  );
}
