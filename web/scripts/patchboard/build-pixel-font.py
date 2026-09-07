"""Rebuild the local LCD alphabet: python -m pip install fonttools; python scripts/patchboard/build-pixel-font.py."""
import re
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

root = Path(__file__).resolve().parents[2]
source = (root / 'src/lib/patchboard/terminal-artwork.ts').read_text().split('const GLYPHS:')[1].split('};')[0]
letters = {(quoted or bare): bits for quoted, bare, bits in re.findall(r'(?:"([^"]+)"|([A-Z0-9])):"([0-9a-f]{10})"', source)}
font = FontBuilder(1000, isTTF=True)
glyphs = {'.notdef': TTGlyphPen(None).glyph()}
widths = {'.notdef': (600, 0)}
cmap = {}
for letter, bits in letters.items():
    name = f'uni{ord(letter):04X}'
    pen = TTGlyphPen(None)
    for column in range(5):
        mask = int(bits[column * 2:column * 2 + 2], 16)
        for row in range(7):
            if mask & (1 << row):
                x, y = column * 100, (6 - row) * 100
                pen.moveTo((x, y)); pen.lineTo((x, y + 100)); pen.lineTo((x + 100, y + 100)); pen.lineTo((x + 100, y)); pen.closePath()
    glyphs[name] = pen.glyph()
    widths[name] = (600, 0)
    cmap[ord(letter)] = name
    if letter.isalpha() and len(letter.lower()) == 1:
        cmap[ord(letter.lower())] = name
font.setupGlyphOrder(list(glyphs))
font.setupCharacterMap(cmap)
font.setupGlyf(glyphs)
font.setupHorizontalMetrics(widths)
font.setupHorizontalHeader(ascent=800, descent=-200)
font.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
font.setupNameTable({'familyName': 'Patchboard Pixel', 'styleName': 'Regular', 'uniqueFontIdentifier': 'PatchboardPixel-Regular', 'fullName': 'Patchboard Pixel Regular', 'psName': 'PatchboardPixel-Regular'})
font.setupPost()
font.setupMaxp()
font.save(root / 'public/fonts/patchboard-pixel.ttf')
