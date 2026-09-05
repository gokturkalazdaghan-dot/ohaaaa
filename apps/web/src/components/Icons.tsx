/**
 * Satır içi (inline) SVG ikon seti.
 *
 * Harici ikon kütüphanesi yerine gerekli ~20 ikon elle tanımlandı: paket
 * bağımlılığı, ağaç sarsma (tree-shaking) belirsizliği ve ~50KB JS yükü
 * ortadan kalkıyor. Tümü `currentColor` kullanır, böylece tema ile uyumlu.
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const HeartIcon = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => (
  <Icon {...p}>
    <path
      d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3Z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Icon>
);

export const CameraIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-2h8.4l1.1 2h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
    <circle cx="12" cy="13" r="3.4" />
  </Icon>
);

export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5 11.5a7 7 0 0 0 14 0" />
    <path d="M12 18.5V21.5" />
  </Icon>
);

export const BarcodeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 5.5v13M7 5.5v13M10.5 5.5v13M14 5.5v13M17.5 5.5v13M20.5 5.5v13" />
  </Icon>
);

export const CartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 3h2l2.2 11.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.55L20.5 7H6" />
    <circle cx="9.5" cy="20" r="1.4" />
    <circle cx="17.5" cy="20" r="1.4" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Icon>
);

export const BoltIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
  </Icon>
);

export const StarIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8L12 3Z" />
  </Icon>
);

export const TruckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 6.5h11v10H2zM13 10h4l3 3v3.5h-7z" />
    <circle cx="6" cy="18" r="1.6" />
    <circle cx="17" cy="18" r="1.6" />
  </Icon>
);

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.5 4.5 5.5v6c0 4.7 3.2 8.6 7.5 10 4.3-1.4 7.5-5.3 7.5-10v-6L12 2.5Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const StoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 9.5V20h17V9.5" />
    <path d="M2.5 9.5 4.5 4h15l2 5.5a3 3 0 0 1-5.6 1.5 3 3 0 0 1-5.6 0 3 3 0 0 1-5.6 0 3 3 0 0 1-2.2-1.5Z" />
    <path d="M9.5 20v-5.5h5V20" />
  </Icon>
);

export const ChainIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.4 1.4" />
    <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.4-1.4" />
  </Icon>
);

export const ChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 20.5h17" />
    <path d="M6.5 20V11m5 9V4.5m5 16v-6" />
  </Icon>
);

export const KeyIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7.5" cy="15.5" r="4" />
    <path d="m10.5 12.5 8-8 2 2-1.5 1.5 1.5 1.5-2.5 2.5-1.5-1.5-1.5 1.5" />
  </Icon>
);

export const BoxIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14m-6-6 6 6-6 6" />
  </Icon>
);

export const ShareIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
    <path d="M15.5 5.5A2 2 0 0 0 13.5 3.5h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.2v.3" />
  </Icon>
);

export const CodeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8.5 8-4 4 4 4m7-8 4 4-4 4M13.5 5l-3 14" />
  </Icon>
);

export const CpuIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
    <path d="M10 2.5v4m4-4v4m-4 11v4m4-4v4M2.5 10h4m-4 4h4m11-4h4m-4 4h4" />
  </Icon>
);

export const ShirtIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3.5 4 6l1.5 4L8 9v11.5h8V9l2.5 1L20 6l-4-2.5-2 2h-4l-2-2Z" />
  </Icon>
);

export const SofaIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3" />
    <path d="M2.5 12.5a2 2 0 0 1 4 0V16h11v-3.5a2 2 0 0 1 4 0V19H2.5v-6.5Z" />
  </Icon>
);

export const DumbbellIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9v6M7 7v10m10-10v10m3-8v6M7 12h10" />
  </Icon>
);

export const SparklesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m10 3 1.7 4.3L16 9l-4.3 1.7L10 15l-1.7-4.3L4 9l4.3-1.7L10 3Zm7.5 9 .9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" />
  </Icon>
);

export const BasketIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 9.5h18l-1.7 9a2 2 0 0 1-2 1.5H6.7a2 2 0 0 1-2-1.5L3 9.5Z" />
    <path d="m8 9.5 2-6m6 6-2-6M9.5 13.5v3m5-3v3" />
  </Icon>
);

/*
 * Kategori ikonları.
 *
 * Anahtar, veritabanındaki `categories.icon` ALANIDIR — slug değil.
 * Önceki hali slug'a göre anahtarlanmıştı ve bu, veri modeliyle çelişiyordu:
 * satırda `icon: 'cpu'` yazması hiçbir işe yaramıyor, ikon yalnızca slug
 * tesadüfen listedeki adlardan biriyse çıkıyordu. Yani yeni bir kategori
 * eklendiğinde, ikonunu doğru ayarlasa bile ikonsuz kalırdı.
 *
 * (Uygulamada hiç fark etmiyordu, çünkü harita hiçbir yerde kullanılmıyordu.)
 */
const iconsByName: Record<string, (p: IconProps) => React.ReactElement> = {
  cpu: CpuIcon,
  shirt: ShirtIcon,
  sofa: SofaIcon,
  dumbbell: DumbbellIcon,
  sparkles: SparklesIcon,
  basket: BasketIcon,
};

/*
 * Slug yedeği: `icon` alanı boş bırakılmış eski satırlar için. Kategori
 * taksonomisi elle kurulduğu için bu alanın dolu olması garanti değil ve
 * ikonsuz bir çip, YANLIŞ ikonlu bir çipten iyidir ama doğru ikondan kötüdür.
 */
const iconsBySlug: Record<string, (p: IconProps) => React.ReactElement> = {
  elektronik: CpuIcon,
  moda: ShirtIcon,
  'ev-yasam': SofaIcon,
  'spor-outdoor': DumbbellIcon,
  kozmetik: SparklesIcon,
  supermarket: BasketIcon,
};

/**
 * Bir kategorinin ikonunu çözer; tanınmayan kategoride `null` döner.
 *
 * `null` dönmesi bir hata değil, beklenen durumdur: taksonomi büyüdükçe
 * ikonu olmayan kategoriler olacaktır ve çip metniyle zaten anlaşılır.
 * Rastgele bir "genel" ikon koymak, kategoriler arasındaki ayrımı
 * zayıflatmaktan başka bir işe yaramaz.
 */
export function categoryIcon(category: {
  icon?: string | null;
  slug: string;
}): ((p: IconProps) => React.ReactElement) | null {
  return (
    (category.icon ? iconsByName[category.icon] : undefined) ??
    iconsBySlug[category.slug] ??
    null
  );
}
