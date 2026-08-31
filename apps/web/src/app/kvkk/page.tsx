import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'KVKK aydınlatma metni',
  description:
    'Ohaaaa’da kişisel verilerin hangi amaçla işlendiği, kimlerle paylaşıldığı ve '
    + 'haklarınızı nasıl kullanacağınız.',
  alternates: { canonical: '/kvkk' },
};

export default function KvkkPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 text-left sm:px-6">
      <h1 className="text-2xl font-bold">KVKK aydınlatma metni</h1>
      <p className="mt-4 text-sm text-muted">
        Veri sorumlusu: Armanalabs. İletişim: gokturkalazdaghan@gmail.com
      </p>
      <p className="mt-4 text-sm leading-relaxed text-fg">
        Ohaaaa üzerinden hesap açtığınızda ad, e-posta ve sipariş bilgileriniz
        hizmeti sunmak, siparişi iletmek ve yasal yükümlülükleri yerine getirmek
        için işlenir. Pazarlama iletileri için ayrıca onay alınır.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-fg">
        6698 sayılı Kanun kapsamındaki haklarınız (erişim, düzeltme, silme,
        itiraz) için aynı e-posta adresine yazabilirsiniz.
      </p>
    </article>
  );
}
