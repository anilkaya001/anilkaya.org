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
700 the site uses. The Greek subset is not decoration — the section's own
notation is Γ (dealer gamma) and σ (implied moves), and a numeric label that
falls back to the system stack for one glyph changes width mid-line.

The `latin` subset carries U+2212 MINUS SIGN, which this site uses in place of
a hyphen on every negative number. `tests/contracts.mjs` asserts it is still
there: a subset regenerated without it would silently fall back to the system
font for exactly the character the numeric discipline rests on.

These files retain the SIL Open Font License and are not covered by this
repository's Apache-2.0 license.
