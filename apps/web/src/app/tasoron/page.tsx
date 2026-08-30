import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Satıcı olun',
  description:
    'Ohaaaa’da satış: listeleme bedeli yok, komisyon yalnızca gerçekleşen satıştan kesilir. Başvurun, API ile kataloğunuzu bağlayın.',
};

/*
 * Satici kazanma sayfasi.
 *
 * Bu sayfa isin can damari: katalog magazalardan gelir, magaza da buradan.
 * Onceki hali bir baslik, iki cumle ve alti cizili bir "Basvuru formu"
 * bagliantisindan ibaretti - sayfanin yarisi bostu ve bir dukkan sahibini
 * ikna edecek hicbir sey yoktu.
 *
 * Iddialar somut ve dogrulanabilir tutuldu: rakam uydurulmadi ("binlerce
 * ziyaretci", "%40 ciro artisi" gibi ifadeler yok), cunku site yeni ve boyle
 * bir veri yok. Anlatilan sey sartlar: ne odenir, ne zaman odenir, nasil
 * baglanir.
 */

const TERMS = [
  {
    title: 'Listeleme bedeli yok',
    body: 'Ürünlerinizi yayınlamak için aylık ücret ya da kurulum bedeli almıyoruz. Maliyet yalnızca satış gerçekleşirse doğar.',
  },
  {
    title: 'Komisyon satıştan sonra',
    body: 'Komisyon, sipariş tamamlandığında hesaplanır. İptal ve iadelerde komisyon da geri alınır.',
  },
  {
    title: 'Fiyatı siz belirlersiniz',
    body: 'Fiyat ve stok sizin sisteminizden gelir. Ohaaaa fiyatınıza müdahale etmez, yalnızca kargo dahil toplamla karşılaştırır.',
  },
  {
    title: 'Kargo kuralları sizin',
    body: 'Kargo ücretini ve ücretsiz kargo eşiğinizi siz tanımlarsınız; karşılaştırmada bunlar hesaba katılır.',
  },
];

const STEPS = [
  {
    n: '1',
    title: 'Başvurun',
    body: 'Mağaza adı, vergi bilgisi ve iletişim. Birkaç dakika sürer.',
  },
  {
    n: '2',
    title: 'Onay ve API anahtarı',
    body: 'Başvurunuz değerlendirilir. Onay sonrası panelden kendi API anahtarınızı üretirsiniz.',
  },
  {
    n: '3',
    title: 'Kataloğu bağlayın',
    body: 'Tek POST isteğiyle 500 ürüne kadar gönderirsiniz. Fiyat ve stok güncellemeleri aynı uçtan geçer.',
  },
];

export default function VendorLandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      {/* --- Giris --- */}
      <section className="py-10 sm:py-14">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">Satıcı olun</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-fg sm:text-5xl">
          Mağazanızı Ohaaaa’da yayın
        </h1>
        <p className="mt-4 max-w-xl text-base text-muted sm:text-lg">
          Listeleme bedeli yok. Fiyat ve stok sizin sisteminizden gelir.
          Komisyon yalnızca satış olursa kesilir.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href="/tasoron/basvuru"
            className="rounded-full bg-brand px-6 py-3 text-sm font-bold text-[#fffaf5] transition-colors hover:bg-brand-strong"
          >
            Başvuru formunu doldur
          </Link>
          <Link href="/tasoron/api" className="chip">
            API belgeleri
          </Link>
        </div>
      </section>

      {/* --- Sartlar --- */}
      <section>
        <h2 className="border-b border-line pb-3 text-xl font-bold tracking-tight text-fg">
          Şartlar
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {TERMS.map((item) => (
            <li key={item.title} className="card p-5">
              <h3 className="text-sm font-bold text-fg">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* --- Adimlar --- */}
      <section className="mt-12">
        <h2 className="border-b border-line pb-3 text-xl font-bold tracking-tight text-fg">
          Nasıl başlanır
        </h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.n} className="card p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-extrabold text-[#fffaf5]">
                {step.n}
              </span>
              <h3 className="mt-3 text-sm font-bold text-fg">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* --- Kapanis --- */}
      <section className="mt-12 card flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-fg">Sorunuz mu var?</h2>
          <p className="mt-1 text-sm text-muted">
            Başvurmadan önce şartları konuşmak isterseniz bize yazın.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/iletisim" className="chip">
            İletişim
          </Link>
          <Link
            href="/tasoron/basvuru"
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-[#fffaf5] transition-colors hover:bg-brand-strong"
          >
            Başvur
          </Link>
        </div>
      </section>
    </div>
  );
}
