"""Builds every app icon from one square logo PNG.

Usage:  python tools/make-icons.py [logo.png]
Writes src/assets/icon.png (256), icon@2x.png (512), icon.ico (16-256),
and src/assets/tray/tray-*.png (the logo with a red unread badge).
The overlay-*.png taskbar badges have no logo in them, so they are left alone.
"""
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'src', 'assets')
TRAY = os.path.join(ASSETS, 'tray')
TRAY_SIZE = 32
BADGE = 21  # badge diameter on the 32px tray icon, matching the old icons


def fit(img, size):
    return img.resize((size, size), Image.LANCZOS)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'Logo1')
    logo = Image.open(src).convert('RGBA')
    if logo.width != logo.height:
        raise SystemExit('Logo must be square, got %dx%d' % logo.size)

    fit(logo, 256).save(os.path.join(ASSETS, 'icon.png'))
    fit(logo, 512).save(os.path.join(ASSETS, 'icon@2x.png'))
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    fit(logo, 256).save(os.path.join(ASSETS, 'icon.ico'), sizes=[(s, s) for s in sizes])

    base = fit(logo, TRAY_SIZE)
    base.save(os.path.join(TRAY, 'tray-0.png'))
    for n in [str(i) for i in range(1, 10)] + ['9plus']:
        # Reuse the existing red number badge, framed by a thin white ring.
        badge = fit(Image.open(os.path.join(TRAY, 'overlay-%s.png' % n)).convert('RGBA'), BADGE * 4)
        ring = Image.new('RGBA', badge.size, (0, 0, 0, 0))
        white = Image.new('RGBA', badge.size, (255, 255, 255, 255))
        ring.paste(white, (0, 0), badge.split()[3])
        big = Image.new('RGBA', ((BADGE + 2) * 4,) * 2, (0, 0, 0, 0))
        big.paste(fit(ring, (BADGE + 2) * 4), (0, 0), fit(ring, (BADGE + 2) * 4))
        big.alpha_composite(badge, (4, 4))
        small = big.resize((BADGE + 2, BADGE + 2), Image.LANCZOS)
        out = base.copy()
        out.alpha_composite(small, (TRAY_SIZE - BADGE - 2, TRAY_SIZE - BADGE - 2))
        out.save(os.path.join(TRAY, 'tray-%s.png' % n))
    print('Icons written from', src)


if __name__ == '__main__':
    main()
