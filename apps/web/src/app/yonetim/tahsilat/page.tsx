import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { formatMoney, type Currency } from '@ohaaaa/shared';

import { getSessionUser } from '@/lib/auth';
import {
  getPayouts,
  getRevenueSummary,
  getRevenueTargets,
  type RevenueRow,
  type RevenueTarget,
} from '@/data/revenue';

/**
 * TAHSİLAT — sahibin baktığı tek sayı.
 *
 * Direktifin 3. maddesi ana finansal göstergeyi CASH RECEIVED olarak
 * tanımlıyor ve şunları birbirinden ayırmayı şart koşuyor: GMV, tahmini,
 * onaylı, bekleyen, ödenen, tahsil edilen. Bu sayfa o ayrımı korur ve
 * hiçbirini diğerinin yerine koymaz.
 *
 * ÜÇ ŞEYİ KASITLI OLARAK YAPMIYOR:
 *
 * 1) PARA BİRİMLERİNİ TOPLAMIYOR. Kur kaynağı bağlı değil; TRY ile EUR'yu
 *    toplayan tek bir "toplam gelir" sayısı uydurma olurdu. Her para birimi
 *    kendi satırında duruyor.
 *
 * 2) AYLIK HEDEFE YÜZDE VERMİYOR (henüz). Hedef 50.000 USD; gelir başka
 *    para birimlerinde. Çevrim için kaynağı ve zaman damgası kayıtlı bir kur
 *    gerekir — yok. Yüzde uydurmak yerine ne eksik olduğu yazılıyor.
 *
 * 3) BANKA ENTEGRASYONU VARMIŞ GİBİ DAVRANMIYOR. `received` alanı hesap
 *    özetine bakan bir insan tarafından giriliyor; sayfa bunu saklamıyor.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tahsilat',
  robots: { index: false, follow: false },
};

const DURUM_ETIKET: Record<string, string> = {
  beklemede: 'Ödeme bekleniyor',
  beyan_edildi: 'Ağ beyan etti',
  tahsil_edildi: 'Tahsil edildi',
  itirazli: 'İtirazlı',
};

export default async function CashReceivedPage() {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') redirect('/');

  const [ozet, odemeler, hedefler] = await Promise.all([
    getRevenueSummary(30),
    getPayouts(50),
    getRevenueTargets('haftalik'),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Tahsilat</h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted">
          Son 30 gün. <strong className="text-fg">Tahsil edilen</strong>, hesaba gerçekten
          geçmiş ve dekontu kaydedilmiş tutardır — ağın “ödedim” beyanı değil.
        </p>
      </header>

      {ozet === null ? (
        /*
          Okunamadı ile sıfır AYNI ŞEY DEĞİL. Sıfır göstermek "hiç
          kazanmadık" demek olurdu; burada bilmiyoruz.
        */
        <p className="mt-8 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm text-warning">
          Gelir verisi şu an okunamıyor. Size yanlış bir rakam göstermektense hiç
          göstermemeyi tercih ediyoruz.
        </p>
      ) : ozet.length === 0 ? (
        <BosDurum />
      ) : (
        <>
          {ozet.map((satir) => (
            <ParaBirimiKarti key={satir.currency} satir={satir} />
          ))}
          <HedefNotu ozet={ozet} hedefler={hedefler} />
        </>
      )}

      <section className="mt-12">
        <h2 className="text-lg font-bold">Ödeme dönemleri</h2>
        <p className="mt-1 text-xs text-muted">
          Bir dönem ancak dekont numarası, ödeme tarihi ve mutabakat kaydı girildiğinde
          “tahsil edildi” sayılır. Bu kural veritabanı kısıtıyla zorlanır, arayüzle değil.
        </p>

        {odemeler === null ? (
          <p className="mt-5 text-sm text-warning">Tahsilat defteri okunamadı.</p>
        ) : odemeler.length === 0 ? (
          <p className="mt-5 rounded-2xl border border-line bg-surface-2 p-5 text-sm text-muted">
            Henüz ödeme dönemi kaydı yok. İlk ortaklık ağı bağlandığında dönemler burada
            listelenir.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-subtle">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Mağaza</th>
                  <th className="py-2 pr-4 font-semibold">Dönem</th>
                  <th className="py-2 pr-4 text-right font-semibold">Bizim hesabımız</th>
                  <th className="py-2 pr-4 text-right font-semibold">Ağın beyanı</th>
                  <th className="py-2 pr-4 text-right font-semibold">Tahsil edilen</th>
                  <th className="py-2 pr-4 font-semibold">Durum</th>
                  <th className="py-2 font-semibold">Dekont</th>
                </tr>
              </thead>
              <tbody>
                {odemeler.map((odeme) => {
                  const birim = odeme.currency as Currency;
                  return (
                    <tr key={odeme.id} className="border-b border-line/60">
                      <td className="py-3 pr-4">{odeme.merchantName}</td>
                      <td className="py-3 pr-4 text-muted">
                        {odeme.periodStart} → {odeme.periodEnd}
                      </td>
                      <td className="tabular py-3 pr-4 text-right">
                        {formatMoney(odeme.expectedCents, birim)}
                      </td>
                      <td className="tabular py-3 pr-4 text-right text-muted">
                        {/* NULL "henüz bildirmedi" demek; sıfır değil. */}
                        {odeme.declaredCents === null
                          ? '—'
                          : formatMoney(odeme.declaredCents, birim)}
                      </td>
                      <td className="tabular py-3 pr-4 text-right font-semibold">
                        {odeme.receivedCents === null
                          ? '—'
                          : formatMoney(odeme.receivedCents, birim)}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${
                            odeme.status === 'tahsil_edildi'
                              ? 'bg-success/15 text-success'
                              : odeme.status === 'itirazli'
                                ? 'bg-warning/15 text-warning'
                                : 'bg-surface-2 text-muted'
                          }`}
                        >
                          {DURUM_ETIKET[odeme.status] ?? odeme.status}
                        </span>
                      </td>
                      <td className="py-3 text-xs text-muted">
                        {odeme.paymentReference ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ParaBirimiKarti({ satir }: { satir: RevenueRow }) {
  const birim = satir.currency as Currency;

  /*
   * Ağın beyanı ile tahsilat arasındaki fark, defterin varlık sebebi:
   * eksik ödeme buradan görünür. Fark yoksa satır hiç çizilmiyor.
   */
  const eksik = satir.declaredCents - satir.receivedCents;

  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-sm font-semibold text-muted">{satir.currency}</h2>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-3">
        <span className="tabular text-4xl font-black leading-none text-fg">
          {formatMoney(satir.receivedCents, birim)}
        </span>
        <span className="text-sm text-muted">tahsil edildi</span>
      </p>

      {satir.receivedCents === 0 && (
        /*
          "0 TL tahsil edildi" cümlesi tek başına yanıltıcı olabilir:
          okuyucu bir hata sanabilir. Sebebi yazıyoruz.
        */
        <p className="mt-2 text-xs leading-relaxed text-subtle">
          Henüz hesaba geçmiş ve dekontu kaydedilmiş bir ödeme yok. Aşağıdaki kalemler
          beklenen tutarlardır; gelir sayılmazlar.
        </p>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kalem
          etiket="Ciro (GMV)"
          deger={formatMoney(satir.gmvCents, birim)}
          not="Yönlendirdiğimiz satış hacmi — bizim gelirimiz değil"
        />
        <Kalem
          etiket="Onay bekleyen"
          deger={formatMoney(satir.pendingCents, birim)}
          not="İade süresi dolmadı"
        />
        <Kalem
          etiket="Onaylanmış"
          deger={formatMoney(satir.approvedCents, birim)}
          not="Hak edildi, henüz elimizde değil"
        />
        <Kalem
          etiket="Ağın beyanı"
          deger={formatMoney(satir.declaredCents, birim)}
          not="Hesap özetinde yazan"
        />
        <Kalem
          etiket="İptal / iade"
          deger={formatMoney(satir.rejectedCents, birim)}
          not="Komisyon geri alındı"
        />
        <Kalem
          etiket="Tahsil edilen dönem"
          deger={`${satir.receivedPayouts} / ${satir.payoutsCount}`}
          not="Dekontu kaydedilmiş ödeme sayısı"
        />
      </dl>

      {eksik > 0 && (
        <p className="mt-5 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          Ağ <strong>{formatMoney(satir.declaredCents, birim)}</strong> beyan etti, hesaba{' '}
          <strong>{formatMoney(satir.receivedCents, birim)}</strong> geçti —{' '}
          <strong>{formatMoney(eksik, birim)}</strong> fark var. Bu farkı görebilmek,
          defterin var olma sebebi.
        </p>
      )}
    </section>
  );
}

function Kalem({ etiket, deger, not }: { etiket: string; deger: string; not: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{etiket}</dt>
      <dd className="tabular mt-1 text-lg font-bold text-fg">{deger}</dd>
      <p className="mt-0.5 text-2xs leading-relaxed text-subtle">{not}</p>
    </div>
  );
}

/**
 * Hedef notu.
 *
 * Hedef 50.000 USD; gelir başka para birimlerinde olabilir. Kur kaynağı
 * bağlı olmadan yüzde hesaplamak, uydurma bir ilerleme göstergesi üretir.
 * Bu yüzden yüzde YALNIZCA USD satırı varsa ve yalnızca o satır için
 * hesaplanır; diğer para birimleri için ne eksik olduğu yazılır.
 */
function HedefNotu({
  ozet,
  hedefler,
}: {
  ozet: RevenueRow[];
  hedefler: RevenueTarget[] | null;
}) {
  /*
   * HEDEF ARTIK KODDA DEĞİL.
   *
   * Önce `AYLIK_HEDEF_USD = 50_000` diye gömülüydü: hedefi değiştirmek kod
   * değişikliği ve yeni bir dağıtım gerektiriyordu, üstelik tek bir para
   * birimine sabitlenmişti. Birden çok pazarda çalışan bir sistemde bu
   * anlamsız -- Türkiye hedefi ile Almanya hedefi aynı sayı olamaz.
   *
   * ÜÇ AYRI DURUM, ÜÇ AYRI MESAJ:
   *   null       → tablo okunamadı (hedef "yok" DEĞİL, bilinmiyor)
   *   boş dizi   → hedef henüz tanımlanmamış
   *   dolu dizi  → para birimi başına ilerleme
   */
  if (hedefler === null) {
    return (
      <section className="mt-8 rounded-2xl border border-line bg-surface-2 p-6">
        <h2 className="text-sm font-semibold">Hedef</h2>
        <p className="mt-2 text-sm text-muted">
          Hedef tablosu okunamadı. Bu, hedefin tanımlanmadığı anlamına gelmez —
          ilerleme yüzdesi göstermiyoruz çünkü neye göre hesaplayacağımızı
          bilmiyoruz.
        </p>
      </section>
    );
  }

  if (hedefler.length === 0) {
    return (
      <section className="mt-8 rounded-2xl border border-line bg-surface-2 p-6">
        <h2 className="text-sm font-semibold">Hedef</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Haftalık hedef tanımlanmamış.{' '}
          <code className="font-mono text-xs">revenue_targets</code> tablosuna
          para birimi ve tutar eklendiğinde ilerleme burada görünür.
        </p>
      </section>
    );
  }

  /*
   * Hedefi olmayan para birimi için ilerleme gösterilmez ve tahsilatı
   * başka bir para biriminin hedefine SAYILMAZ. Kur kaynağı bağlı değil;
   * uydurma bir çevrim hedefi olduğundan yakın ya da uzak gösterirdi.
   */
  const hedefliBirimler = new Set(hedefler.map((h) => h.currency));
  const hedefsizTahsilat = ozet
    .filter((satir) => satir.receivedCents > 0 && !hedefliBirimler.has(satir.currency))
    .map((satir) => satir.currency);

  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface-2 p-6">
      <h2 className="text-sm font-semibold">Haftalık hedef</h2>

      <ul className="mt-3 space-y-3">
        {hedefler.map((hedef) => {
          const satir = ozet.find((s) => s.currency === hedef.currency);
          const tahsilat = satir?.receivedCents ?? 0;
          const yuzde = Math.floor((tahsilat / hedef.amountCents) * 100);
          const kalan = Math.max(0, hedef.amountCents - tahsilat);

          return (
            <li key={hedef.currency} className="text-sm">
              <span className="text-muted">Hedef: </span>
              <strong className="text-fg">
                {formatMoney(hedef.amountCents, hedef.currency as Currency)}
              </strong>{' '}
              <span className="text-muted">tahsil edilen gelir.</span>
              <br />
              <span className="text-muted">İlerleme: </span>
              <strong className="text-fg">%{yuzde}</strong>
              {kalan > 0 && (
                <>
                  {' '}
                  <span className="text-muted">— kalan </span>
                  <strong className="text-fg">
                    {formatMoney(kalan, hedef.currency as Currency)}
                  </strong>
                </>
              )}
              {hedef.note && (
                <span className="block text-xs text-subtle">{hedef.note}</span>
              )}
            </li>
          );
        })}
      </ul>

      {hedefsizTahsilat.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-subtle">
          {hedefsizTahsilat.join(', ')} cinsindeki tahsilat yukarıdaki
          yüzdelere <strong>dahil edilmedi</strong>: o para birimleri için
          tanımlı bir hedef yok ve çevrim yapmak için kaynağı ve zaman damgası
          kayıtlı bir kur gerekiyor. Şu an bağlı bir kur kaynağı yok.
        </p>
      )}
    </section>
  );
}

function BosDurum() {
  return (
    <section className="mt-10 rounded-2xl border border-line bg-surface-2 p-8">
      <h2 className="text-lg font-bold">Henüz ölçülecek gelir yok</h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        Bu sayfa hiçbir sayı uydurmaz: dönüşüm ve ödeme kaydı biriktikçe dolar. Zincirin
        başlaması için önce bir ortaklık ağı bağlanmalı ve katalog gerçek tekliflerle
        dolmalı.
      </p>
    </section>
  );
}
