#!/usr/bin/env python3
"""
Generates the QR image-import regression fixtures in src/test/fixtures/qr/.

Why: the QR import regression (Iteration 4B) must be tested with real image
files that resemble what users import — app screenshots with surrounding UI,
stylised "custom artwork" QR codes, dark mode, JPEG-recompressed photos — not
only with clean in-memory bitmaps. No customer screenshots are stored in the
repository, so these sanitized stand-ins are generated from editable source.

Requirements: `qrencode` (CLI, 4.x) for the symbol matrix and Python 3 with
Pillow and NumPy for compositing and sensor-like noise. Output is 8-bit RGB, RGBA or greyscale PNG (what src/test/png.ts reads).
JPEG variants are compressed as JPEG and then stored as PNG so the JPEG
artefacts are preserved without needing a JPEG decoder in host tests.

The script is deterministic (fixed text, fixed noise seed); re-running it
reproduces the committed files. Each fixture's exact encoded value is listed in
src/test/fixtures/qr/manifest.json, which the tests read.

Usage: python3 scripts/generate-qr-fixtures.py
"""
import io
import json
import os
import random
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'test', 'fixtures', 'qr')
# iPhone 15/16 Pro screenshot size (portrait, native pixels).
SCREEN = (1179, 2556)


def matrix(text, level='M'):
    """Module matrix (True = dark) from qrencode, without quiet zone."""
    ascii_art = subprocess.run(
        ['qrencode', '-t', 'ASCII', '-m', '0', '-l', level, '-o', '-', text],
        check=True, capture_output=True, text=True,
    ).stdout
    rows = [line for line in ascii_art.split('\n') if line]
    # qrencode's ASCII output uses two characters per module.
    return [[row[i] == '#' for i in range(0, len(row), 2)] for row in rows]


def is_finder(x, y, n):
    return (x < 7 and y < 7) or (x >= n - 7 and y < 7) or (x < 7 and y >= n - 7)


def draw_qr(mods, module, style='square', fg=(0, 0, 0), bg=(255, 255, 255), quiet=4, finder_fg=None):
    """Renders a matrix. Styles: square, dots (round data modules), rounded."""
    n = len(mods)
    size = (n + 2 * quiet) * module
    img = Image.new('RGB', (size, size), bg)
    d = ImageDraw.Draw(img)
    for y, row in enumerate(mods):
        for x, dark in enumerate(row):
            if not dark:
                continue
            x0 = (x + quiet) * module
            y0 = (y + quiet) * module
            colour = finder_fg if (finder_fg and is_finder(x, y, n)) else fg
            if style == 'dots' and not is_finder(x, y, n):
                inset = module * 0.08
                d.ellipse([x0 + inset, y0 + inset, x0 + module - inset, y0 + module - inset], fill=colour)
            elif style == 'rounded' and not is_finder(x, y, n):
                d.rounded_rectangle([x0, y0, x0 + module - 1, y0 + module - 1], radius=module * 0.35, fill=colour)
            else:
                d.rectangle([x0, y0, x0 + module - 1, y0 + module - 1], fill=colour)
    return img


def font(size):
    for path in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def screenshot(qr, bg=(242, 242, 247), card=(255, 255, 255), header=(208, 2, 27), title='ACME REWARDS', dark_text=False):
    """Places a QR on a loyalty-app style card inside a phone screenshot."""
    img = Image.new('RGB', SCREEN, bg)
    d = ImageDraw.Draw(img)
    # Status bar and app chrome text (glyphs give the finder-pattern search distractors).
    text_colour = (20, 20, 20) if dark_text else (235, 235, 240)
    d.text((70, 50), '9:41', fill=text_colour, font=font(48))
    d.text((70, 180), 'My Cards', fill=text_colour, font=font(84))
    top = 520
    d.rounded_rectangle([70, top, SCREEN[0] - 70, top + 1500], radius=48, fill=card)
    d.rounded_rectangle([70, top, SCREEN[0] - 70, top + 220], radius=48, fill=header)
    d.rectangle([70, top + 170, SCREEN[0] - 70, top + 220], fill=header)
    d.text((130, top + 70), title, fill=(255, 255, 255), font=font(72))
    img.paste(qr, ((SCREEN[0] - qr.width) // 2, top + 300))
    d.text((130, top + 330 + qr.height), 'Member 0001234567', fill=(110, 110, 120), font=font(48))
    d.text((130, top + 400 + qr.height), 'Show this code at checkout', fill=(110, 110, 120), font=font(40))
    return img


def add_logo(qr, colour=(10, 132, 255), fraction=0.22):
    img = qr.copy()
    side = int(img.width * fraction)
    logo = Image.new('RGB', (side, side), colour)
    ImageDraw.Draw(logo).text((side * 0.3, side * 0.18), 'A', fill=(255, 255, 255), font=font(int(side * 0.6)))
    img.paste(logo, ((img.width - side) // 2, (img.height - side) // 2))
    return img


def jpeg_roundtrip(img, quality, scale=1.0, blur=0.0):
    if scale != 1.0:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=quality)
    buf.seek(0)
    return Image.open(buf).convert('RGB')


def smooth_upscale(qr, factor):
    """Enlarges a small QR bitmap with bilinear smoothing, as apps and web pages do."""
    return qr.resize((qr.width * factor, qr.height * factor), Image.BILINEAR)


def noisy_photo(qr, size, noise, blur, angle, seed):
    """A photographed card: tilted QR on a card on a table, blurred, sensor noise, JPEG."""
    tilted = qr.rotate(angle, expand=True, fillcolor=(245, 245, 240))
    table = Image.new('RGB', size, (150, 130, 110))
    card = Image.new('RGB', (tilted.width + 200, tilted.height + 320), (245, 245, 240))
    card.paste(tilted, (100, 100))
    table.paste(card, ((size[0] - card.width) // 2, (size[1] - card.height) // 2))
    pixels = np.asarray(table.filter(ImageFilter.GaussianBlur(blur))).astype(float)
    pixels += np.random.default_rng(seed).normal(0, noise, pixels.shape)
    # Stored as greyscale: noise does not compress, and the decoder only uses luminance.
    return jpeg_roundtrip(Image.fromarray(np.clip(pixels, 0, 255).astype('uint8')), 80).convert('L')


def main():
    os.makedirs(OUT, exist_ok=True)
    random.seed(4)
    url = 'https://example.com/loyalty?member=000123456&src=App'
    member = 'MEMBER 0001234567 Gold'
    padded = '  0000123  case-Sensitive  '
    fixtures = {}

    def save(name, img, value, note):
        img.save(os.path.join(OUT, name), 'PNG', optimize=True)
        fixtures[name] = {'value': value, 'note': note}

    save('plain-qrencode.png', draw_qr(matrix(url), 8), url, 'Plain QR, 8 px modules, 4-module quiet zone')
    save('screenshot-app-card.png', screenshot(draw_qr(matrix(member), 22, quiet=2)), member,
         'Phone screenshot: QR on an app card with a 2-module quiet zone, UI text around it')
    save('screenshot-dark-app.png',
         screenshot(draw_qr(matrix(member), 20, quiet=1), bg=(28, 28, 30), card=(255, 255, 255), header=(48, 79, 254)),
         member, 'Dark app chrome around a white card; 1-module quiet zone')
    save('screenshot-logo-artwork.png', screenshot(add_logo(draw_qr(matrix(url, 'H'), 16, quiet=3))), url,
         'Custom artwork: high-EC QR with a centred logo')
    save('screenshot-dots-artwork.png',
         screenshot(draw_qr(matrix(url, 'Q'), 18, style='dots', fg=(30, 30, 90), finder_fg=(208, 2, 27), quiet=3)),
         url, 'Custom artwork: round dot modules, navy data, red finder patterns')
    save('screenshot-rounded-artwork.png',
         screenshot(draw_qr(matrix(member, 'Q'), 24, style='rounded', fg=(0, 90, 60), quiet=3)), member,
         'Custom artwork: rounded green modules')
    save('screenshot-exact-whitespace.png', screenshot(draw_qr(matrix(padded), 22, quiet=4)), padded,
         'Value with leading/trailing spaces, leading zeros and mixed case')
    dark = screenshot(draw_qr(matrix(member), 22, quiet=3, fg=(255, 255, 255), bg=(0, 0, 0)), bg=(0, 0, 0), card=(0, 0, 0),
                      header=(60, 60, 60))
    save('screenshot-dark-mode-inverted.png', dark, member, 'Dark mode: light modules on black (needs inversion)')
    save('photo-jpeg-q50.png', jpeg_roundtrip(screenshot(add_logo(draw_qr(matrix(url, 'H'), 16, quiet=3))), 50, 0.6, 1.0),
         url, 'Downscaled, blurred, JPEG quality 50 copy of the logo screenshot')
    transparent = draw_qr(matrix(member), 12).convert('RGBA')
    transparent.putdata([(0, 0, 0, 0) if px[0] > 128 else (0, 0, 0, 255) for px in transparent.getdata()])
    save('transparent-background.png', transparent, member,
         'RGBA: dark modules on a fully transparent background (decoded as if on white)')
    # The two classes below fail ZXing's QR finder at native resolution and
    # are the regression fixtures for Iteration 4B (see README).
    save('screenshot-upscaled-smooth.png', screenshot(smooth_upscale(draw_qr(matrix(url), 2), 5)), url,
         'Small QR bitmap enlarged 5x with bilinear smoothing inside a screenshot (soft module edges)')
    save('screenshot-upscaled-smooth-large.png', screenshot(smooth_upscale(draw_qr(matrix(url), 2), 7)), url,
         'Small QR bitmap enlarged 7x with bilinear smoothing inside a screenshot (soft module edges)')
    save('photo-noisy-card.png', noisy_photo(draw_qr(matrix(url), 7), (1000, 760), 14, 1.6, -4, 7), url,
         'Photographed card: tilted, blurred, sensor noise, JPEG quality 80')

    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(fixtures, f, indent=2, ensure_ascii=False)
        f.write('\n')


if __name__ == '__main__':
    main()
