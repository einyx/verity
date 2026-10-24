# Embedded PDF fonts

Unmodified Noto fonts, distributed under the
SIL Open Font License 1.1. See both bundled OFL files for copyright, reserved names
and redistribution terms. `provenance.json` records official notofonts repository
URLs pinned to commit, exact byte counts and SHA-256 hashes for fonts and licenses.
No runtime download or operating-system fonts are used.

Copyright notices retained in the original font name tables:

- Noto Sans regular/bold and Noto Sans Arabic: Copyright 2015-2021 Google LLC. All Rights Reserved.
- Noto Sans Thai: Copyright 2016 Google Inc. All Rights Reserved.
- Noto Sans CJK SC: © 2014-2021 Adobe (http://www.adobe.com/).
- The upstream Noto fonts OFL text also names Copyright 2018 The Noto Project Authors.

These notices are accompanied by the original OFL license texts, not replaced by
this attribution summary. The fonts themselves are unmodified.

Noto Sans regular/bold covers Latin, extended Latin, Greek and Cyrillic. Noto Sans
Arabic covers Arabic/Persian, Noto Sans Thai covers Thai, and Noto Sans CJK SC
provides pan-CJK Han, kana and Hangul coverage (SC regional Han glyph forms).
Fallback faces are regular weight; only the main sans has a separate bold face.

Fonts total **17,860,520 bytes**. Each document embeds its own subsets, except
the CJK OTF: fontkit generates an unreadable CID-keyed CFF subset, so documents
requiring CJK embed the full original font (approximately 13.8 MB compressed).
Documents using only the other scripts do not embed the CJK font. The PDF
retains meshX branding through its wordmark and palette; Noto is an intentional
PDF typeface, independent of the portable Arial PPTX theme.

`bidi.mjs` is the unmodified bidi-js 1.0.3 distribution (Unicode 13 UAX #9),
copyright 2021 Jason Johnston, distributed under the bundled MIT license.
Its npm tarball SHA-512 integrity was verified before extraction; provenance
includes the distribution SHA-256. It has no external dependencies. The small
adjacent declaration describes only the APIs used by this renderer.
