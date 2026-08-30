#!/usr/bin/env python3
"""
OHAAAA - koli bandi baski gorseli.

    python3 scripts/make-tape.py <cikti.png> [--width-mm 48] [--repeat-mm 200]

NEDEN AYRI BIR BETIK
Bant, ekranda degil MATBAADA uretilir. Ekran varliklarindan farkli
gereksinimleri var:

  * Cozunurluk 300 dpi olmali; ekran icin yeterli 72 dpi baskida bulanik cikar.
  * Desen YATAYDA KUSURSUZ TEKRARLAMALI. Bant metrelerce uzar; birlesme yeri
    goze carparsa is amatorce gorunur ve markanin degerini dusurur.
  * Kenarlarda "guvenli alan" birakilmali: kesim ve sarim toleransi nedeniyle
    ust ve alt birkac milimetre kaybolabilir.

CIKTI
Tek tekrar birimi, saydam degil DOLU zeminle (bant opak basilir).
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

DPI = 300
MM = DPI / 25.4                      # 1 mm kac piksel
FONT = Path('/mnt/skills/examples/canvas-design/canvas-fonts/Outfit-Bold.ttf')

BRAND = 'O' + 'h' + 'a' * 4
KERN_OH = 0.135                      # make-badge.py ile ayni
WORDMARK = BRAND + '.com'      # Ohaaaa.com

# Bant SIYAH zemin, BEYAZ yazi.
#
# Baskida "zengin siyah" (CMYK dort renk) yerine tek renk siyah tercih edilir:
# bant makinesinde dort rengin ust uste tam oturmasi zordur ve kayma olursa
# beyaz yazinin kenarinda renkli hayalet cikar. Bu yuzden zemin duz, notr ve
# tam siyaha yakin.
BLACK = (12, 12, 14)
WHITE = (255, 255, 255)

# Kesim ve sarim toleransi. Bu seride kritik hicbir sey durmamali.
SAFE_MM = 4


def draw_word(size_px: int, word: str, kern: float = 0.0) -> Image.Image:
    """Harfleri tek tek cizer; kern verilirse ilk ciftte yaklastirir."""
    font = ImageFont.truetype(str(FONT), size_px)
    pad = size_px
    tmp = Image.new('L', (int(size_px * len(word) * 1.2) + pad * 2, size_px * 3), 0)
    d = ImageDraw.Draw(tmp)
    x = float(pad)
    for i, ch in enumerate(word):
        d.text((x, pad), ch, font=font, fill=255)
        x += font.getlength(ch)
        if i == 0 and kern:
            x -= size_px * kern
    box = tmp.getbbox()
    return tmp.crop(box) if box else tmp


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    out = Path(args[0]) if args else Path('ohaaaa-bant.png')

    def opt(name: str, default: float) -> float:
        if name in sys.argv:
            return float(sys.argv[sys.argv.index(name) + 1])
        return default

    width_mm = opt('--width-mm', 48)     # standart koli bandi
    repeat_mm = opt('--repeat-mm', 200)

    H = int(round(width_mm * MM))
    W = int(round(repeat_mm * MM))
    safe = int(round(SAFE_MM * MM))

    # Tekrar sayisi 2. Uc tekrarda kelime, kendi yuvasina sigmak icin
    # kuculuyordu: bagimsiz sinir YUKSEKLIK degil GENISLIK oluyor ve yazi
    # bant yuksekliginin ancak dortte birini dolduruyordu. Iki tekrarla
    # kelime her ~100 mm'de bir ve okunakli boyutta cikiyor.
    repeats = int(opt('--repeats', 2))

    # --- Zemin: duz siyah -----------------------------------------------------
    # Gradyan YOK. Tek renk zemin hem baskida daha az sorun cikarir hem de
    # tekrar sirasinda birlesme yerinde hicbir gecis olmaz.
    tape = Image.new('RGB', (W, H), BLACK)
    d = ImageDraw.Draw(tape)

    usable = H - 2 * safe
    step = W // repeats
    max_w = int(step * 0.84)      # tekrarlar arasinda nefes payi

    # --- Kelime isareti -------------------------------------------------------
    word = draw_word(int(usable * 1.05), WORDMARK, KERN_OH)
    scale = min((usable * 0.58) / word.height, max_w / word.width)
    word = word.resize((max(1, int(word.width * scale)), max(1, int(word.height * scale))),
                       Image.LANCZOS)

    top = (H - word.height) // 2
    for k in range(repeats):
        cx = k * step + step // 2
        tape.paste(Image.new('RGB', word.size, WHITE), (cx - word.width // 2, top), word)

    tape.save(out, 'PNG', dpi=(DPI, DPI))

    # --- Tekrarlama kontrolu -------------------------------------------------
    # Sol ve sag kenar sutunlari birbirine yakin olmali; degilse bant boyunca
    # birlesme yeri cizgi gibi gorunur. Bunu gozle fark etmek zordur, olcmek
    # kolaydir.
    a = np.asarray(tape).astype(int)
    seam = float(np.abs(a[:, 0, :] - a[:, -1, :]).mean())

    print(f'{out}  {W}x{H} px  ({repeat_mm:.0f}x{width_mm:.0f} mm @ {DPI} dpi)')
    print(f'  guvenli alan: ustte ve altta {SAFE_MM} mm')
    print(f'  birlesme farki: {seam:.2f}/255', '- kusursuz' if seam < 2 else '- KONTROL EDIN')


if __name__ == '__main__':
    main()
