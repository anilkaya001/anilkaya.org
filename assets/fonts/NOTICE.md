# Fonts

`GoogleSans-*.woff2` are **Google Sans** by the Google Sans Project Authors,
distributed under the **SIL Open Font License 1.1** (`GoogleSans-OFL.txt`,
included here as the license requires).

- Project: https://github.com/googlefonts/googlesans
- Source files: https://github.com/google/fonts/tree/main/ofl/googlesans
- License: https://openfontlicense.org

They are subsets of the upstream variable files
`GoogleSans[GRAD,opsz,wght].ttf` and `GoogleSans-Italic[GRAD,opsz,wght].ttf`,
cut with fontTools: the glyphs are subset first, then the `GRAD` axis is
pinned to 0 and the `opsz` axis to 18 (both the upstream defaults), and the
weight axis is kept whole (400 to 700). Keeping `opsz` (17 to 18) made the
Latin file 68.8 KB instead of 44.7 KB, so it is not kept. The upstream `prep`
and `gasp` tables are kept: the glyphs carry no instructions, and without
that `prep` Chromium 149 on Linux, which sets whole-pixel advances, drew one
31-character line at 12 px 174 px wide against 169 px with it (166.6 px is
the unrounded width).
The layout features kept are `kern`, `mark`, `mkmk`, `ccmp`, `locl`, `liga`,
`calt`, `tnum`, `pnum`, `lnum`, `case`, `zero`, `frac`, `numr`, `dnom`,
`sups`, `subs`, `sinf` and `ordn`.

The files are rebuilt with `python3 scripts/build-fonts.py <upstream dir> <out dir> wght`.

| File | Style | Covers |
|---|---|---|
| `GoogleSans-latin.woff2` | upright | Basic Latin, Latin-1, Latin Extended-A, general punctuation, super and subscript digits, the arrows, mathematical operators and geometric shapes the face draws |
| `GoogleSans-greek.woff2` | upright | Greek |
| `GoogleSans-italic-latin.woff2` | italic | as the upright Latin file |
| `GoogleSans-italic-greek.woff2` | italic | Greek |

The exact codepoints are the `unicode-range` of each `@font-face` in
`assets/css/base.css`, which is each file's own character map.

Google Sans is the text and interface face of the whole site: the landing
page, the articles, the Econometrics Lab and Flows. Pages preload
`GoogleSans-latin.woff2` alone; the other three load when a page prints a
Greek letter or an italic.

The Latin files carry the Turkish letters (U+011E, U+011F, U+0130, U+0131,
U+015E, U+015F), U+2212 MINUS SIGN, which this site uses in place of a hyphen
on every negative number, the en and em dashes, the four arrows, U+2197,
U+25B2, U+25A0, U+25CB, U+25CF, U+2713 and U+2715. `tests/contracts.mjs`
asserts the ranges are still declared.

Digits are proportional by default and tabular under the `tnum` feature:
every tabular digit, currency sign and operator (plus, minus, percent and
their kin) is 600 units of 1000 wide at every weight, upright and italic, so
`font-variant-numeric: tabular-nums` aligns columns. Upstream's `tnum` also
widens the space, full stop, comma, colon and semicolon to 300 units. Flows
sets tabular figures on its whole body, where that would loosen every line of
prose, so those five substitutions are removed from the feature before
subsetting: each keeps its one proportional width, which still aligns in a
column.

What the face does not draw falls back to the system font for that glyph:
U+25BC, U+25B6, U+25B8, U+25C2, U+25C0, U+25C6, U+25C7, U+25D4, U+2605,
U+26A0, U+2194, U+21D2, U+2208, U+221D, U+2273, the modifier and subscript
letters the course notation uses (U+1D40, U+1D62, U+209C and their kin) and
the emoji. Neither face that Google Sans replaced drew any of them either.

`JBM-*.woff2` are **JetBrains Mono** by the JetBrains Mono Project Authors,
distributed under the **SIL Open Font License 1.1** (`JBM-OFL.txt`, included
here as the license requires).

- Project: https://github.com/JetBrains/JetBrainsMono
- License: https://openfontlicense.org

These are the `latin` and `greek` subsets Google Fonts serves for the variable
build (v24), taken unmodified. They are the code face of the Lab's editors,
code blocks and the articles' code, and nothing else.

These files retain the SIL Open Font License and are not covered by this
repository's Apache-2.0 license.
