# Fonts

`LM-*.woff2` are the **Latin Modern** typefaces by the GUST e-foundry,
distributed under the **GUST Font License (GFL)** — a free, OFL-compatible
license that permits redistribution and web embedding.

- Project: https://www.gust.org.pl/projects/e-foundry/latin-modern
- License: https://www.gust.org.pl/projects/e-foundry/licenses

The woff2 builds here were taken from the `latex.css` package
(https://github.com/vincentdoerig/latex-css), which repackages the GUST
originals for the web. These files retain the GUST Font License and are not
covered by this repository's Apache-2.0 license.

`JBM-*.woff2` are **JetBrains Mono** by the JetBrains Mono Project Authors,
distributed under the **SIL Open Font License 1.1** (`JBM-OFL.txt`, included
here as the license requires).

- Project: https://github.com/JetBrains/JetBrainsMono
- License: https://openfontlicense.org

These are the `latin` and `greek` subsets Google Fonts serves for the variable
build (v24), taken unmodified. Two files rather than four: the build is
variable on the weight axis, so one file per subset covers both the 400 and
700 the site uses.

**They serve the Academy, not Flows.** Flows is set entirely in Latin Modern
(`assets/css/flows.css` defines `--font-figure`), and `tests/contracts.mjs`
asserts that no Flows rule reaches for the mono token. What still loads these:
`lab.css`, `article.css`, `placement.css`, `review.css`.

The Greek subset is not decoration — the Academy's notation is σ, β and ε, and
Latin Modern draws none of the three, so a label that fell back to the system
stack for one glyph would change width mid-line. Flows once needed it for the
same reason (σ on its ATR-normalised distances); those read `2.00 ATR` now,
because Latin Modern does not draw σ and the honest fix was to spell the unit
rather than ship a second family for one character.

The `latin` subset carries U+2212 MINUS SIGN, which this site uses in place of
a hyphen on every negative number. `tests/contracts.mjs` asserts it is still
there: a subset regenerated without it would silently fall back to the system
font for exactly the character the numeric discipline rests on.

These files retain the SIL Open Font License and are not covered by this
repository's Apache-2.0 license.
