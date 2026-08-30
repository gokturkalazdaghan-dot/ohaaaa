import type { Metadata } from 'next';
import Link from 'next/link';

import { ContentPage } from '@/components/ContentPage';
import { ContactForm } from '@/components/ContactForm';

export const metadata: Metadata = {
  title: 'Bize Ulaşın',
  description:
    'Ohaaaa ile iletişime geçin: yanlış fiyat bildirimi, satıcı başvurusu, ' +
    'basın ve iş birliği talepleri.',
  alternates: { canonical: '/iletisim' },
};

/** Konu bazlı yönlendirme — tek bir "info@" adresi her talebi yavaşlatır. */
const CHANNELS = [
  {
    title: 'Yanlış fiyat veya ürün bildirimi',
    email: 'duzeltme@ohaaaa.com',
    description:
      'Bir fiyat güncel değilse ya da iki farklı ürün aynı kartta birleşmişse bize yazın. ' +
      'Ürün bağlantısını eklemeniz yeterli.',
    responseTime: '1 iş günü',
  },
  {
    title: 'Satıcı ve mağaza başvurusu',
    email: 'satici@ohaaaa.com',
    description:
      'Ürünlerinizi Ohaaaa’da listelemek istiyorsanız. Başvuru formunu doldurmanız daha hızlıdır.',
    responseTime: '2 iş günü',
    action: { label: 'Başvuru formu', href: '/tasoron/basvuru' },
  },
  {
    title: 'Sipariş ve teslimat',
    email: 'destek@ohaaaa.com',
    description:
      'Ohaaaa üzerinden verdiğiniz siparişler için. Ortak mağazadan aldıysanız o mağazanın ' +
      'kendi destek hattına yazmanız gerekir.',
    responseTime: '1 iş günü',
  },
  {
    title: 'Kişisel veri talepleri (KVKK)',
    email: 'kvkk@ohaaaa.com',
    description:
      'Verilerinize erişim, düzeltme veya silme talepleriniz için. Mevzuat gereği en geç ' +
      '30 gün içinde yanıtlıyoruz.',
    responseTime: '30 gün (yasal süre)',
  },
] as const;

export default function ContactPage() {
  return (
    <ContentPage
      title="Bize Ulaşın"
      description="Talebinizi doğru kişiye ulaştırmak için konuya göre ayrı kanallarımız var."
      breadcrumb="İletişim"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {CHANNELS.map((channel) => (
          <article key={channel.email} className="card p-5">
            <h2 className="!mt-0 text-base font-semibold">{channel.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{channel.description}</p>

            <a
              href={`mailto:${channel.email}`}
              className="mt-3 block font-mono text-sm text-brand-soft"
            >
              {channel.email}
            </a>

            <p className="mt-1 text-[11px] text-subtle">
              Yanıt süresi: {channel.responseTime}
            </p>

            {'action' in channel && channel.action && (
              <Link
                href={channel.action.href}
                className="mt-3 inline-block rounded-lg border border-line px-3 py-1.5 text-xs font-medium !text-fg no-underline transition-colors hover:border-brand/50"
              >
                {channel.action.label}
              </Link>
            )}
          </article>
        ))}
      </div>

      <h2>Mesaj gönderin</h2>
      <ContactForm />

      <h2>Şirket bilgileri</h2>
      <table>
        <tbody>
          <tr>
            <td style={{ width: '35%' }}>Unvan</td>
            <td>[Şirket ticari unvanı]</td>
          </tr>
          <tr>
            <td>Adres</td>
            <td>[Açık adres]</td>
          </tr>
          <tr>
            <td>Vergi dairesi / no</td>
            <td>[Vergi dairesi] / [Vergi no]</td>
          </tr>
          <tr>
            <td>MERSİS</td>
            <td>[MERSİS numarası]</td>
          </tr>
          <tr>
            <td>KEP adresi</td>
            <td>[KEP adresi]</td>
          </tr>
        </tbody>
      </table>

      <p className="text-sm">
        <strong>Not:</strong> Köşeli parantezli alanlar şirket kuruluş bilgileriyle
        doldurulmalıdır. E-Ticaret Kanunu (6563) ve Mesafeli Sözleşmeler Yönetmeliği bu
        bilgilerin sitede erişilebilir olmasını zorunlu kılar.
      </p>
    </ContentPage>
  );
}
