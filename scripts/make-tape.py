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
DOMAIN = 'ohaaaa.com'

ORANGE_HI = (233, 105, 42)
ORANGE_LO = (193, 53, 21)
CREAM = (255, 250, 245)

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

    # --- Zemin: yatayda DUZ, dikeyde hafif gradyan ---------------------------
    # Yatay gradyan kullanilamaz: desen tekrarlarken birlesme yerinde koyu ile
    # acik yan yana gelir ve bant boyunca cizgi cizgi gorunur.
    y = np.linspace(0, 1, H)[:, None]
    hi = np.array(ORANGE_HI, dtype=float)
    lo = np.array(ORANGE_LO, dtype=float)
    field = hi + (lo - hi) * (y ** 1.2)
    bg = np.repeat(field[:, None, :], W, axis=1)
    tape = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8), 'RGB')
    d = ImageDraw.Draw(tape)

    usable = H - 2 * safe

    # --- Marka adi -----------------------------------------------------------
    # Olcek HEM yukseklikten HEM genislikten sinirlanir. Yalnizca yukseklige
    # gore olceklenseydi kelime kendi yuvasindan tasar, tekrar biriminin
    # kenarindan disari sarkardi ve doseme bozulurdu.
    slots = 2
    step = W // slots
    max_w = int(step * 0.72)

    word = draw_word(int(usable * 1.05), BRAND, KERN_OH)
    scale = min(int(usable * 0.62) / word.height, max_w / word.width)
    word = word.resize((max(1, int(word.width * scale)), max(1, int(word.height * scale))),
                       Image.LANCZOS)

    # --- Alt satir: alan adi -------------------------------------------------
    dom = draw_word(int(usable * 0.5), DOMAIN)
    dom_scale = min((usable * 0.20) / dom.height, max_w / dom.width)
    dom = dom.resize((max(1, int(dom.width * dom_scale)), max(1, int(dom.height * dom_scale))),
                     Image.LANCZOS)

    block_w = max(word.width, dom.width)
    gap = int(usable * 0.10)
    block_h = word.height + gap + dom.height
    top = (H - block_h) // 2

    # --- Yerlestirme: tekrar birimi icinde IKI kez ---------------------------
    # Tek kez konsaydi metrelerce bantta marka seyrek kalirdi. Iki tekrar,
    # 200 mm'lik birimde her ~100 mm'de bir marka demek.
    for k in range(slots):
        cx = k * step + step // 2
        tape.paste(Image.new('RGB', word.size, CREAM), (cx - word.width // 2, top), word)
        tape.paste(Image.new('RGB', dom.size, CREAM),
                   (cx - dom.width // 2, top + word.height + gap), dom)



    # --- Ayrac cizgileri -----------------------------------------------------
    # Cizgiler bloklarin ARASINA gelir: bloklar step/2 ve 3*step/2'de, cizgiler
    # 0, step ve W'de. Ilk denemede cizgi blogun tam ortasindan geciyordu -
    # konumlari cakismisti; iki birim yan yana konup gozle bakilinca goruldu.
    #
    # Birlesme yerindeki cizgi YARIM-YARIM cizilir: yarisi sol kenarda,
    # yarisi sag kenarda. Iki birim yan yana geldiginde tam kalinlikta bir
    # cizgi olusur; tek birimde tam cizilseydi doseme sirasinda cift
    # kalinlikta gorunurdu.
    lw = max(2, int(0.6 * MM))
    d.line([(step, safe), (step, H - safe)], fill=CREAM, width=lw)
    d.rectangle([0, safe, lw // 2 - 1, H - safe], fill=CREAM)
    d.rectangle([W - lw // 2, safe, W - 1, H - safe], fill=CREAM)

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
