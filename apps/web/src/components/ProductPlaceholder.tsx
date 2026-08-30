/**
 * Görseli olmayan ürün için yer tutucu.
 *
 * Boş bej bir dikdörtgen "eksik" görünür. Bunun yerine ürünün kendi
 * kimliğinden (slug) türeyen sabit bir renk ve yumuşak bir desen çizilir:
 * her kart farklı ama tümü aynı paletten, yani ızgara kasıtlı durur.
 *
 * UYDURMA BİR ÜRÜN GÖRSELİ ÇİZİLMEZ. Yer tutucu, ürünü temsil ettiğini
 * iddia etmez; yalnızca boşluğu tasarlanmış biçimde doldurur.
 *
 * NEDEN AYRI DOSYA
 * Hem sunucu (kart ızgarası) hem istemci (görsel galerisi) bileşenlerinden
 * kullanılır. `ProductCard` içinde kalsaydı, oradan import eden bir istemci
 * bileşeni `node:fs` kullanan fotoğraf çözümleyiciyi de paketine çekerdi ve
 * derleme kırılırdı — nitekim kırıldı.
 */
export function ProductPlaceholder({ seed }: { seed: string }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;

  // Sıcak paletin içinde kal: 18-42 derece (turuncu-amber) arası.
  // Yer tutucu, görsel alanının AÇIK zeminiyle uyumlu kalır: kart koyu diye
  // yer tutucuyu da koyu yapmak, fotoğrafı olan ve olmayan kartları
  // birbirinden kopuk gösterirdi.
  const hue = 18 + (hash % 24);
  const from = `hsl(${hue} 30% 93%)`;
  const to = `hsl(${hue + 10} 26% 86%)`;

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: `linear-gradient(140deg, ${from}, ${to})` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" className="h-1/3 w-1/3 opacity-25" fill="none" stroke="currentColor">
        <path
          d="M32 6 58 19v26L32 58 6 45V19L32 6Z M6 19l26 13 26-13 M32 32v26"
          strokeWidth="2.4"
          strokeLinejoin="round"
          className="text-[#7a4b2a]"
        />
      </svg>
    </div>
  );
}
