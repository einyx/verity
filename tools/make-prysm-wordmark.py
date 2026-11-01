#!/usr/bin/env python3
"""Generate the Prysm wordmark SVG.

The wordmark is the brand mark followed by the lowercase letters "prysm",
drawn as straight-edged geometric letterforms so the result matches the
angular character of the mark itself. Every glyph is built from rectangles and
diagonals, so the output stays crisp at any size.

Usage: python3 tools/make-prysm-wordmark.py <output.svg>
"""

import sys

# Brand palette. The mark keeps the shape of the previous logo but in the
# Prysm indigo; the lettering is near-black.
INDIGO = '#4F46E5'
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
    parts = [
        # stem, running below the baseline
        f'M{x:.2f} {DESCENDER:.2f}v{-(XH + DESCENDER):.2f}h{STROKE:.2f}V{DESCENDER:.2f}z',
        # bowl: top bar, right stem, bottom bar
        rect(x + STROKE, -XH, 40, STROKE),
        f'M{x + 40 + STROKE:.2f} {-XH:.2f}v{XH:.2f}h{STROKE:.2f}V{-XH:.2f}z',
        rect(x + STROKE, -STROKE, 40, STROKE),
    ]
    return parts


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


def build(word='prysm', mark_gap=40.0, mark_width=82.0, height=116.0):
    """Return the SVG source for the wordmark."""
    # The lettering is set in a 100-unit em: the x-height is 72 units and the
    # descenders reach 22 units below the baseline, so the full letter height
    # is 94 units. Scale the em so that band fits the canvas with a small
    # margin, and centre it vertically.
    letter_height = XH + DESCENDER
    scale = (height * 0.66) / letter_height
    # The mark is drawn in the same vertical band as the lettering.
    mark_height = height * 0.62
    mark_scale = mark_height / 116.0

    paths = [
        # The brand mark: the same angular chevron pair, in Prysm indigo.
        f'<g transform="translate(0 {height * 0.19:.2f}) scale({mark_scale:.4f})">'
        f'<path d="M82 37V19L41 45 0 18v19l27 17 14 9 14-9zM82 89v18L41 81 0 108V89l27-17 14-9 14 9z" fill="{INDIGO}"/>'
        f'</g>'
    ]

    # Lettering, vertically centred against the mark.
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

    # Wrap the letters in a group so the whole word can be placed at once.
    # Each glyph contributes raw path data; wrap it in a <path> element.
    body = ''.join(f'<path d="{d}"/>' for d in letters)
    paths.append(
        f'<g transform="translate({mark_width + mark_gap:.2f} {baseline:.2f}) '
        f'scale({scale:.4f})" fill="{INK}">{body}</g>'
    )

    width = mark_width + mark_gap + pen * scale
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" '
        f'viewBox="0 0 {width:.0f} {height:.0f}" fill="none">'
        f'{"".join(paths)}'
        f'</svg>\n'
    )


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'prysm-wordmark.svg'
    with open(out, 'w', encoding='utf-8') as handle:
        handle.write(build())
    print(f'wrote {out}')
