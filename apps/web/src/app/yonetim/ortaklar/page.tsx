import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  type AsamaDurumu,
  type KanitDurumu,
  type OrtakOzeti,
  type OrtakSatiri,
} from '@ohaaaa/shared';

import { getSessionUser } from '@/lib/auth';
import { getPartnerPipeline } from '@/data/partners';

/**
 * ORTAKLAR — bir advertiser'ın para kazandırana kadarki yolu.
 *
 * Bu sayfanın cevapladığı soru "kaç ortağımız var?" değil, ŞU:
 *
 *   Hangi firmada tıkandık ve şimdi ne yapmalıyım?
 *
 * Dokuz sütun, boru hattının dokuz aşamasıdır. Her hücrenin durumu
 * veritabanındaki KANITTAN türetilir (`@ohaaaa/shared/partners`); bu sayfa
 * hiçbir şey hesaplamaz, yalnızca gösterir.
 *
 * ÜÇ ŞEYİ KASITLI OLARAK YAPMIYOR:
 *
 * 1) BİLİNMEYENİ OLUMSUZ GÖSTERMİYOR. "MID alanı boş" ile "bu programın
 *    MID'i yok" farklı cümlelerdir. Panel ikincisini asla söylemez;
 *    doğrulanmamış bir alan "—" ve "doğrulanmadı" olarak görünür. Bu ayrım
 *    doğrudan işi değiştirir: var olan bir MID'i aramak ile yeniden
 *    başvurmak aynı iş değildir.
 *
 * 2) İLERLEME YÜZDESİ VERMİYOR. "%40 tamam" cümlesi aşamaların eşit
 *    ağırlıkta olduğunu varsayar; onay almak ile feed eşlemek aynı iş
 *    değil. Uydurma bir yüzde yerine sayılabilir olgular gösteriliyor.
 *
 * 3) AWIN'E BAĞLANMIYOR. Buradaki hiçbir sayı ağdan çekilmiyor; hepsi
 *    bizim kaydımız. Başvuruları Awin panelinde insan yapar -- otomatik
 *    başvuru göndermek ağın kurallarına aykırıdır ve bu sayfa buna
 *    aracılık etmez.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ortaklar',
  robots: { index: false, follow: false },
};

const SUTUNLAR: { anahtar: keyof OrtakSatiri['asamalar']; baslik: string }[] = [
  { anahtar: 'advertiser', baslik: 'Advertiser' },
  { anahtar: 'mid', baslik: 'Awin MID' },
  { anahtar: 'basvuru', baslik: 'Başvuru' },
  { anahtar: 'onay', baslik: 'Onay' },
  { anahtar: 'feed', baslik: 'Feed' },
  { anahtar: 'eslesme', baslik: 'Eşleme' },
  { anahtar: 'deneme', baslik: 'Deneme' },
  { anahtar: 'yayin', baslik: 'Yayın' },
  { anahtar: 'gelir', baslik: 'Gelir' },
];

/**
 * Durum → görünüm.
 *
 * `dogrulanmadi` ile `baslanmadi` AYRI RENKTE ve AYRI İŞARETLE. Aynı
 * gösterilseler panelin tek işi olan ayrımı kaybederdi.
 */
const GORUNUM: Record<KanitDurumu, { isaret: string; sinif: string; etiket: string }> = {
  dogrulandi: { isaret: '✓', sinif: 'bg-success/15 text-success', etiket: 'doğrulandı' },
  beklemede: { isaret: '⏳', sinif: 'bg-warning/15 text-warning', etiket: 'bekliyor' },
  engelli: { isaret: '✕', sinif: 'bg-danger/15 text-danger', etiket: 'engelli' },
  baslanmadi: { isaret: '·', sinif: 'bg-surface-2 text-muted', etiket: 'başlanmadı' },
  dogrulanmadi: { isaret: '?', sinif: 'bg-surface-2 text-subtle ring-1 ring-line', etiket: 'doğrulanmadı' },
};

export default async function OrtaklarPage() {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') redirect('/');

  const tablo = await getPartnerPipeline();

  return (
    <div>
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Ortaklar</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
          Bir advertiser&apos;ın başvurudan ilk komisyona kadarki yolu. Her hücre
          elimizdeki <strong className="text-fg">kanıttan</strong> türetilir:{' '}
          <Rozet durum="dogrulanmadi" /> işareti “bilmiyoruz” demektir,{' '}
          <Rozet durum="baslanmadi" /> ise “henüz yapmadık”. İkisi aynı şey değildir.
        </p>
      </header>

      {tablo === null ? (
        /*
          Okunamadı ile boş AYNI ŞEY DEĞİL. Boş bir tablo çizmek "hiç
          ortağımız yok" iddiasıdır; burada bilmiyoruz.
        */
        <p className="mt-8 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm text-warning">
          Ortaklık verisi şu an okunamıyor. Size boş bir liste göstermektense hiç
          göstermemeyi tercih ediyoruz — boş liste “ortağımız yok” demek olurdu.
        </p>
      ) : tablo.satirlar.length === 0 ? (
        <BosDurum />
      ) : (
        <>
          <Ozet ozet={tablo.ozet} gelirOkunabildi={tablo.gelirOkunabildi} />
          <Tablo satirlar={tablo.satirlar} />
          <SiradakiIsler satirlar={tablo.satirlar} />
          <Aciklama />
        </>
      )}
    </div>
  );
}

function Ozet({ ozet, gelirOkunabildi }: { ozet: OrtakOzeti; gelirOkunabildi: boolean }) {
  return (
    <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <Kutu etiket="Kayıtlı" deger={ozet.toplam} not="Boru hattındaki firma" />
      <Kutu etiket="Başvurulmadı" deger={ozet.basvurulmadi} not="Bizde duran iş" />
      <Kutu etiket="Cevap bekliyor" deger={ozet.cevapBekleyen} not="Ağda duran iş" />
      <Kutu etiket="Onaylı" deger={ozet.onayli} not="Karar tarihi kayıtlı" />
      <Kutu etiket="Yayında" deger={ozet.yayinda} not="Link üretiyor" />
      <Kutu
        etiket="Gelir getiren"
        deger={gelirOkunabildi ? ozet.gelirGetiren : '—'}
        not={gelirOkunabildi ? 'Tahsil edilmiş komisyon' : 'Gelir verisi okunamadı'}
      />
    </section>
  );
}

function Kutu({ etiket, deger, not }: { etiket: string; deger: number | string; not: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs text-muted">{etiket}</p>
      <p className="tabular mt-1 text-2xl font-black leading-none text-fg">{deger}</p>
      <p className="mt-1 text-2xs leading-relaxed text-subtle">{not}</p>
    </div>
  );
}

function Tablo({ satirlar }: { satirlar: OrtakSatiri[] }) {
  return (
    <div className="mt-8 overflow-x-auto">
      <table className="w-full min-w-[64rem] text-left text-sm">
        <caption className="sr-only">
          Ortaklık boru hattı: her satır bir advertiser, her sütun bir aşama.
        </caption>
        <thead className="border-b border-line text-xs uppercase tracking-wide text-subtle">
          <tr>
            <th scope="col" className="py-2 pr-4 font-semibold">
              Sıra
            </th>
            {SUTUNLAR.map((s) => (
              <th key={s.anahtar} scope="col" className="py-2 pr-4 font-semibold">
                {s.baslik}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {satirlar.map((satir) => (
            <tr key={satir.girdi.slug} className="border-b border-line/60 align-top">
              <td className="tabular py-3 pr-4 text-muted">
                {satir.girdi.partnerRank ?? '—'}
              </td>

              <th scope="row" className="py-3 pr-4 font-medium text-fg">
                {satir.girdi.displayName}
                <span className="block text-2xs font-normal text-subtle">
                  {satir.girdi.network}
                </span>
              </th>

              {SUTUNLAR.slice(1).map((s) => (
                <td key={s.anahtar} className="py-3 pr-4">
                  <Hucre asama={satir.asamalar[s.anahtar]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Bir hücre.
 *
 * Gerekçe `title` ile değil GÖRÜNÜR metinle veriliyor: `title` dokunmatik
 * cihazda hiç açılmaz ve ekran okuyucularda güvenilmezdir. Panelin tek
 * işi "neden bu renk?" sorusunu cevaplamaksa, cevap ekranda olmalıdır.
 */
function Hucre({ asama }: { asama: AsamaDurumu }) {
  const g = GORUNUM[asama.durum];
  return (
    <div className="max-w-[13rem]">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ${g.sinif}`}
      >
        <span aria-hidden="true">{g.isaret}</span>
        {g.etiket}
      </span>
      <span className="mt-1 block text-2xs leading-relaxed text-subtle">{asama.gerekce}</span>
    </div>
  );
}

/**
 * Sıradaki işler.
 *
 * Dokuz sütunlu bir tabloyu okuyup ne yapacağına karar vermek operatörün
 * işi olmamalı. Bu bölüm her firma için TEK bir sonraki adım verir ve
 * sıralama zaten "önce iş olanlar" düzeninde.
 */
function SiradakiIsler({ satirlar }: { satirlar: OrtakSatiri[] }) {
  const isler = satirlar.filter((s) => !s.sonrakiAdim.startsWith('Zincir tamam'));

  if (isler.length === 0) {
    return (
      <p className="mt-10 rounded-2xl border border-success/30 bg-success/10 p-5 text-sm text-success">
        Boru hattında bekleyen iş yok.
      </p>
    );
  }

  return (
    <section className="mt-12">
      <h2 className="text-lg font-bold">Sıradaki işler</h2>
      <p className="mt-1 text-xs text-muted">
        Her firma için <strong>en erken</strong> tıkanıklık. Sonraki aşamalara ait
        işler burada görünmez: onaylanmamış bir programdan feed istenmez.
      </p>

      <ol className="mt-5 space-y-2">
        {isler.map((satir) => (
          <li
            key={satir.girdi.slug}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-4 py-3 text-sm"
          >
            <span className="tabular text-xs text-subtle">
              {satir.girdi.partnerRank ?? '—'}
            </span>
            <span className="font-medium text-fg">{satir.girdi.displayName}</span>
            <span className="text-muted">{satir.sonrakiAdim}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Rozet({ durum }: { durum: KanitDurumu }) {
  const g = GORUNUM[durum];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ${g.sinif}`}
    >
      <span aria-hidden="true">{g.isaret}</span>
      {g.etiket}
    </span>
  );
}

function Aciklama() {
  return (
    <section className="mt-12 rounded-2xl border border-line bg-surface-2 p-6">
      <h2 className="text-sm font-semibold">Bu tablo neyi göstermez</h2>
      <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted">
        <li>
          <strong className="text-fg">Awin&apos;den canlı veri çekmez.</strong> Buradaki her
          şey bizim kaydımızdır. Başvuru durumu, ağın panelinde değişmiş olabilir;
          değişiklik buraya elle işlenene kadar görünmez.
        </li>
        <li>
          <strong className="text-fg">Başvuru göndermez.</strong> Join işlemini Awin
          panelinde bir insan yapar. Otomatik başvuru göndermek ağın kurallarına
          aykırıdır.
        </li>
        <li>
          <strong className="text-fg">Komisyon oranı ve çerez penceresi göstermez.</strong>{' '}
          Bu iki değerin şema varsayılanı vardır (%3 ve 1 gün) ama bunlar programın
          gerçek şartları değildir. Doğrulanana kadar gösterilmezler — çerez penceresi
          dönüşüm eşleştirmesinde <em>gerçekten kullanılır</em>, yanlış bir değer
          hak edilmiş komisyonu sessizce reddettirir.
        </li>
      </ul>
    </section>
  );
}

function BosDurum() {
  return (
    <section className="mt-10 rounded-2xl border border-line bg-surface-2 p-8">
      <h2 className="text-lg font-bold">Boru hattında henüz firma yok</h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        Bir advertiser kaydedildiğinde başvurudan ilk komisyona kadarki yolu burada
        adım adım görünür.
      </p>
    </section>
  );
}
