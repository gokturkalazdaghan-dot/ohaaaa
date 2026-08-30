import type { Metadata } from 'next';
import { LegalIncompleteNotice } from '@/components/LegalIncompleteNotice';
import { business } from '@/lib/legal';
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
      <LegalIncompleteNotice />

      <ul className="divide-y divide-line border-y border-line">
        {CHANNELS.map((channel) => (
          <li key={channel.email} className="py-5">
            <h2 className="!mt-0 text-base font-semibold">{channel.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{channel.description}</p>
            <p className="mt-2 text-sm">
              <a href={`mailto:${channel.email}`}>{channel.email}</a>
              <span className="text-subtle"> — {channel.responseTime}</span>
            </p>
            {'action' in channel && channel.action && (
              <p className="mt-2 text-sm">
                <Link href={channel.action.href}>{channel.action.label}</Link>
              </p>
            )}
          </li>
        ))}
      </ul>

      <h2>Mesaj gönderin</h2>
      <ContactForm />

      <h2>İşletme bilgileri</h2>
      <table>
        <tbody>
          <tr>
            <td style={{ width: '38%' }}>Ticari unvan</td>
            <td>
              {business.legalName.value}
              <br />
              <span className="text-xs text-subtle">
                Şahıs firmalarında ticari unvan, işletme sahibinin adı ve soyadıdır.
              </span>
            </td>
          </tr>
          <tr>
            <td>İşletme adı</td>
            <td>Armanalabs</td>
          </tr>
          <tr>
            <td>Adres</td>
            <td>{business.address.value}</td>
          </tr>
          <tr>
            <td>Vergi dairesi</td>
            <td>{business.taxOffice.value}</td>
          </tr>
          <tr>
            <td>Vergi / TC kimlik no</td>
            <td>{business.taxNumber.value}</td>
          </tr>
          <tr>
            <td>Ticaret sicil no</td>
            <td>
              {business.registryNumber.value} <span className="text-xs text-subtle">— kayıtlıysa</span>
            </td>
          </tr>
          <tr>
            <td>ETBİS kayıt no</td>
            <td>{business.etbisNumber.value}</td>
          </tr>
          <tr>
            <td>E-posta</td>
            <td>
              <a href="mailto:destek@ohaaaa.com">destek@ohaaaa.com</a>
            </td>
          </tr>
          <tr>
            <td>Telefon</td>
            <td>{business.phone.value}</td>
          </tr>
        </tbody>
      </table>

      <p className="text-sm">
        <strong>Not:</strong> Köşeli parantezli alanlar işletme bilgileriyle
        doldurulmalıdır. 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun ve
        Mesafeli Sözleşmeler Yönetmeliği, bu bilgilerin sitede kolayca erişilebilir
        olmasını zorunlu kılar.
      </p>
    </ContentPage>
  );
}
