#!/usr/bin/env python3
"""Generate the Prysm wordmark SVG.

The wordmark is the lowercase letters "prysm", drawn as straight-edged
geometric letterforms so the result stays crisp at any size. There is no
separate emblem: the word stands alone as the brand.

Usage:
    python3 tools/make-prysm-wordmark.py <output.svg>
"""

import sys

# Brand palette. The lettering is near-black; the accent is used by the
# console's theme tokens rather than by the wordmark itself.
INK = '#0E0E0E'

# Letter geometry, in a 100-unit em. Cap height is 100, x-height 72.
CAP = 100.0
XH = 72.0
STROKE = 15.0
# How far the descenders (p, y) reach below the baseline.
DESCENDER = 22.0

# Horizontal advance of each glyph, including the gap to the next letter.
ADVANCE = {
    'p': 78.0,
    'r': 60.0,
    'y': 76.0,
    's': 68.0,
    'm': 104.0,
}


def rect(x, y, w, h):
    return f'M{x:.2f} {y:.2f}h{w:.2f}v{h:.2f}h{-w:.2f}z'


def glyph_p(x):
    """p: stem with a bowl on the upper right. The stem descends below the baseline."""
    return [
        # stem, running below the baseline
        f'M{x:.2f} {DESCENDER:.2f}v{-(XH + DESCENDER):.2f}h{STROKE:.2f}V{DESCENDER:.2f}z',
        # bowl: top bar, right stem, bottom bar
        rect(x + STROKE, -XH, 40, STROKE),
        f'M{x + 40 + STROKE:.2f} {-XH:.2f}v{XH:.2f}h{STROKE:.2f}V{-XH:.2f}z',
        rect(x + STROKE, -STROKE, 40, STROKE),
    ]


def glyph_r(x):
    """r: stem, shoulder, and a short leg."""
    return [
        rect(x, -XH, STROKE, XH),
        rect(x + STROKE, -XH, 30, STROKE),
        f'M{x + 30 + STROKE:.2f} {-XH:.2f}v{XH - STROKE + 4:.2f}h{STROKE:.2f}V{-XH + STROKE:.2f}h{-30 - STROKE:.2f}z',
    ]


def glyph_y(x):
    """y: two diagonals meeting at the baseline, one leg descending."""
    return [
        # upper-left diagonal
        f'M{x:.2f} {-XH:.2f}L{x + 20:.2f} {-STROKE:.2f}h{STROKE:.2f}L{x + 20 + STROKE:.2f} {-XH:.2f}z',
        # upper-right diagonal
        f'M{x + 46:.2f} {-XH:.2f}L{x + 30:.2f} {-STROKE:.2f}h{STROKE:.2f}L{x + 46 + STROKE:.2f} {-XH:.2f}z',
        # descender
        f'M{x + 10:.2f} {-STROKE:.2f}h{STROKE:.2f}v{XH + DESCENDER - STROKE:.2f}h{STROKE:.2f}z',
    ]


def glyph_s(x):
    """s: an angular s built from three bars and two diagonals."""
    return [
        # top bar
        rect(x + 15, -XH, 38, STROKE),
        # upper-left diagonal
        f'M{x + 15:.2f} {-XH + STROKE:.2f}v{XH - STROKE:.2f}h{STROKE:.2f}V{-XH + STROKE:.2f}z',
        # middle bar
        rect(x, -XH / 2 - STROKE / 2, 45, STROKE),
        # lower-right diagonal
        f'M{x + 45:.2f} {-XH / 2:.2f}v{XH / 2:.2f}h{STROKE:.2f}V{-XH / 2:.2f}z',
        # bottom bar
        rect(x + 8, -STROKE, 38, STROKE),
    ]


def glyph_m(x):
    """m: three stems joined by two shoulders."""
    return [
        rect(x, -XH, STROKE, XH),
        rect(x + 40, -XH, STROKE, XH),
        rect(x + 74, -XH, STROKE, XH),
        rect(x + STROKE, -XH, 27, STROKE),
        rect(x + 40 + STROKE, -XH, 27, STROKE),
    ]


GLYPHS = {
    'p': glyph_p,
    'r': glyph_r,
    'y': glyph_y,
    's': glyph_s,
    'm': glyph_m,
}


def build(word='prysm', height=116.0):
    """Return the SVG source for the wordmark."""
    # The lettering is set in a 100-unit em: the x-height is 72 units and the
    # descenders reach 22 units below the baseline, so the full letter height
    # is 94 units. Scale the em so that band fills most of the canvas, and
    # centre it vertically.
    letter_height = XH + DESCENDER
    scale = (height * 0.82) / letter_height

    # The glyph functions draw with the baseline at y=0, the x-height line at
    # y=-XH and the descenders down to y=+DESCENDER. The baseline therefore
    # sits DESCENDER below the bottom of the letter band, and the band's
    # centre lands on the canvas centre.
    band_height = letter_height * scale
    baseline = height * 0.5 + band_height / 2 - DESCENDER * scale

    letters = []
    pen = 0.0
    for ch in word:
        fn = GLYPHS[ch]
        for d in fn(pen):
            letters.append(d)
        pen += ADVANCE[ch]

    body = ''.join(f'<path d="{d}"/>' for d in letters)
    width = pen * scale

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" '
        f'viewBox="0 0 {width:.0f} {height:.0f}" fill="none">'
        f'<g transform="translate(0 {baseline:.2f}) scale({scale:.4f})" fill="{INK}">{body}</g>'
        f'</svg>\n'
    )


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'prysm-wordmark.svg'
    with open(out, 'w', encoding='utf-8') as handle:
        handle.write(build())
    print(f'wrote {out}')
