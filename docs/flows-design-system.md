# Flows design system v2

This document is the contract for the tokens, the state set and the kit test
that ship with `assets/css/flows.css` (P1-57). Nothing on an existing page
changes until that page adopts a `ds-` class: every added rule is either a
custom property on `:root` or a `.ds-` selector, and `tests/flows-kit-render.mjs`
holds that.

The direction is the one the owner approved from the rendered concepts of
OD-39: opaque surface steps over the near-black ground, hairline borders, one
blue accent, compact density on a desktop pointer and comfortable density on a
phone, tabular figures, and a state chip and a provenance footer on every
module.

## Tokens

All tokens are added; no existing value moved.

| Group | Tokens | Use |
|---|---|---|
| Surfaces | `--surface-0` (the ground), `--surface-1`, `--surface-2`, `--surface-3` | Opaque steps for a module, a nested panel and a control. Text on `--surface-3` uses `--label-1` or `--label-2`. |
| Elevation | `--lift-1`, `--lift-2`, existing `--lift-3` | Module, popover, dialog. |
| Focus | `--focus-ring` | `outline: var(--focus-ring); outline-offset: 2px`. An outline, not a shadow, so forced-colors mode keeps it. |
| Hit area | `--min-hit` | 44 px. A control drawn shorter reaches this through its `::after`. |
| Density | `--row-h`, `--cell-px`, `--mod-pad` | 44 px, 12 px, 16 px by default. `[data-density="compact"]` sets 32 px, 10 px, 14 px, and a coarse pointer sets the default back. |
| Data type | `--t-data` (13 px), `--t-data-sm` (12 px), `--t-overline` (11 px caps) | Figures are tabular. 11 px is the floor; nothing is set below it. |
| Sequential | `--seq-1`, `--seq-2`, `--seq-3`, `--seq-4`, `--seq-5` | One blue ramp from dark to light for heat maps and density. |

`data-density` is set on `<html>` or on a module from the stored preference,
server side, so there is no flash. Nothing sets it yet.

### Data-visualisation palette

There is one palette, in `:root`: series `--s-blue`, `--s-orange`, `--s-purple`,
`--s-teal`, `--s-yellow`, `--s-gray`; dealer gamma `--g-long` and `--g-short`;
direction `--up` and `--down` with `--up-mark` and `--down-mark` for filled
marks; levels `--lvl-flip`, `--lvl-call`, `--lvl-put`, `--lvl-pain`; sectors
`--sect-*`; and the sequential ramp above.

The colour-vision rule: any encoding that uses two colours to say two things
carries a second cue. Under deuteranopia `--up` against `--down` falls well
below a distance of 20 (CIEDE2000), so a rise is always printed with `+` and a
fall with U+2212, and `.ds-sg` draws an up triangle, a down triangle or a bar
beside the figure. Blue and orange pairs (`--g-long` and `--g-short`,
`--s-blue` and `--s-orange`) stay apart under all three simulations; a chart
that uses them still labels its series directly. The kit test computes the
distance of every listed pair under protanopia, deuteranopia and tritanopia
(Machado, severity 1) and fails a pair that is under 20 without a stated cue.

## Materials v3: liquid glass

OD-39 note. The owner approved opaque surface steps for the `.ds-` kit; the
bento tiles and the shell chrome of design v3 become dense liquid glass instead.
The `.ds-` kit stays opaque, as do the data canvases (the flow network, the
skyline, the surface and terrain, the floor and the river), which paint their
own backgrounds. Glass applies to `.ui-card` and the three ticker panels
(`.ft-strip`, `.ft-rail`, `.ft-gchart`), to the sidebar `.fx-side`, the top bar
`.fx-bar::before`, the bar controls (`.fx-search`, `.ak-dock-tab`, `.ui-fresh`,
`.fx-iconbtn:hover`), the segmented control `.ui-seg` and the sidebar's two
switchers `.fx-site`, which wear its well and its knob, and the scrolling sheets
(`.ui-pop`, `.ui-pal`, `.ak-dock-panel`), which take the thick material with a
box-shadow edge and no pseudo rim because their content scrolls under it.

### Tokens

All in the first `:root` of `assets/css/flows.css`.

| Token | Value and use |
|---|---|
| `--glass-sheen` | A 3% white top sheen fading out by 30% of the height; the first background layer of every glass surface. |
| `--glass-rim` | The 1 px specular rim: a 150deg gradient bright top-left (0.40), faint in the middle (0.03) and bright bottom-right (0.24), drawn by `.ui-card::before` as a masked ring. `--glass-rim-w` is its width. |
| `--glass-caustic` | An inset bottom glow in cool blue at 16%. |
| `--glass-lift` | A 0.5 px outer dark hairline and a three-step drop shadow. |
| `--glass-chrome-edge` | The inset top highlight and 0.5 px hairline of the chrome: sidebar, bar controls, sheets. |
| `--glass-track`, `--glass-track-edge` | The segmented control's track: a dark well with an inset shadow. |
| `--glass-knob`, `--glass-knob-edge` | The segmented control's knob: 14% white with a top highlight and a soft drop. |
| `--glass-ctl`, `--glass-ctl-hover` | The bar controls at rest (6% white) and on hover (10%). |
| `--glass-lens` | The backdrop filter of the four refracting surfaces: `blur(12px) saturate(160%)` everywhere, `url("#fx-lens") blur(12px) saturate(160%)` where `@supports (backdrop-filter: url("#fx-lens"))` holds, `none` under reduced transparency, high contrast and forced colours. A surface writes `-webkit-backdrop-filter: var(--glass-lens); backdrop-filter: var(--glass-lens)` and nothing else. |
| `--glass-solid`, `--glass-solid-thick`, `--glass-solid-chrome` | The opaque colours the materials fall back to where `backdrop-filter` is not supported. |
| `--mask-on`, `--mask-mid` | Mask stops for the rim ring, so no colour literal sits inside a `mask` function. |
| `--aur-1`, `--aur-2`, `--aur-3` | The three static aurora pools (blue, violet, cyan) painted on top of the ground, under the overlay; they never move. |
| `--num-ice-a`, `--num-ice-b` | The resting `.ui-num` gradient: white to a light blue. |
| `--num-up-a`, `--num-up-b`, `--num-down-a`, `--num-down-b` | The `.ui-num` gradients for `data-tone` `up`/`long` and `down`/`short`. |
| `--r-tile` | The bento tile radius, 22 px. |

Re-pointed in place: `--label-3` rises from 0.52 to 0.58 (the 0.52 value falls
to 4.4:1 in a tile's top band), `--mat-thin`, `--mat-regular` (0.72),
`--mat-thick` (0.84), `--mat-chrome` and `--mat-side` (0.58), `--mat-blur`
(blur 24, saturate 180%, brightness 0.96) and `--mat-blur-thick` (blur 40,
saturate 190%, brightness 0.90). `--mat-edge` is unchanged; small elements read
it. Retired, with no reader left: `--bar-blur`, `--bar-glass`, `--flows-ground`,
`--blue-mystic`, `--panel-glass`, `--panel-head-glass`, `--glass-filter`,
`--glass-edge`, `--t-panel`, `--acc-jade`, `--acc-amber`, `--acc-violet`,
`--flow-mag`, `--flow-mag-dim`, `--flow-surface`, `--panel-recessed`, `--call`,
`--put`, `--word`, and the dead `.ak-nn` rules.

### The seven layers of `.ui-card`

From back to front:

1. the backdrop: blur 24, saturate 180%, brightness 0.96 (`--mat-blur`);
2. the translucent tint at 0.72 (`--mat-regular`);
3. the top sheen at 3%, fading out by 30% of the height (`--glass-sheen`);
4. the inner top highlight and hairline (`--mat-edge`);
5. the bottom caustic glow (`--glass-caustic`);
6. the 0.5 px outer dark hairline and the three-step drop shadow (`--glass-lift`);
7. the 1 px gradient specular rim, a masked ring drawn by `::before`
   (`-webkit-mask` and `-webkit-mask-composite: xor` before `mask` and
   `mask-composite: exclude`), bright top-left, faint in the middle, bright
   bottom-right. It follows the squircle where `corner-shape` is supported.

The rim is on `.ui-card`, `.ft-strip`, `.ft-rail` and `.ft-gchart` only. None of
the classes that co-occur with `ui-card` draws a `::before` or `::after` of its
own, and none is a scroll container; a `.ui-card` that becomes one takes
`.is-scroll`, which drops the rim, because the pseudo-element would scroll with
the content. The scrolling sheets and the sidebar carry their edge as a
box-shadow for the same reason.

`.ui-num` paints a numeral with a vertical gradient clipped to the glyphs
through `-webkit-text-fill-color: transparent`, not `color: transparent`, so the
computed `color` stays the tone and every test that reads `color` keeps working;
the sign is always printed, `data-tone="silent"` drops the gradient, and the
gradient goes on each digit span of a rolling figure rather than on the
transformed `.ui-roll` parent.

### Refraction on four surfaces

Where a glass piece sits over something it can bend without harming legibility
it refracts its backdrop for real: an SVG displacement filter, `#fx-lens`, in
`backdrop-filter`. `shared/flows-pages.js` emits the filter once on every
shell page, right after the glyph sprite, as a zero-size `.ui-sprite` svg (the
sprite's own pattern: a `display: none` svg is not safe for a filter reference
in every engine). Its `feImage` carries the displacement map from `lensMap()`,
a 100 by 100 svg data URI in which the red channel is a horizontal ramp and the
green channel a vertical one, both flat at 128 across the middle 56% of the box
and running to 40 at the left and top edges and 216 at the right and bottom
edges, so the backdrop is left alone in the middle and bent by up to 4.8 px
(`scale="14"`) at the rim, the way the bevel of a glass lens bends what lies
beyond it. Chromium displaces whole pixels, so on a 140 px knob the rim moves
what is behind it by 2 to 3 px, the next 8 px by 1 and the rest by none. The filter region is the box plus 5% on every side, and the map is
stretched over it with `preserveAspectRatio="none"`, so one map serves every
size.

The surfaces are exactly four: the segmented knob `.ui-seg-knob`, the dock's
head `.ak-dock-head` (its own box only), and, when Home lands, the pager's
selected button `.hm-pager button[aria-current]` and the Neuron tile's pill
`.hm-ask`, which take `var(--glass-lens)` and no other backdrop filter of their
own. No running text sits under any of them. The gate is `@supports`, never an
engine test: where the property does not parse with a `url()` the token stays
`blur(12px) saturate(160%)`, which is the plain glass control of the bar. Under
reduced transparency, high contrast and forced colours the token is `none`.

`tests/flows-glass-render.mjs` renders the real segmented knob over a hairline
grid and measures where the lines land with and without the lens: at least
2 px of displacement within 10 px of the knob's edge and under 0.5 px at its
centre. It first proves the engine can displace a backdrop at all with a
control filter; where it cannot (the gate is a feature test, so the page is
unchanged there) it records the fallback and passes.

### The three fallbacks

- `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))`
  re-points `--mat-regular`, `--mat-thick`, `--mat-chrome`, `--mat-side` and
  `--mat-thin` to the `--glass-solid*` opaque colours.
- `@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)`
  already made the materials opaque and the ground flat; it now also sets the
  aurora pools to `transparent`, the sheen to a flat transparent gradient, the
  rim to a solid `--sep-strong` line, the caustic to nothing, and the bar
  controls and the knob to `--fill-3` and `--fill-1`.
- `@media (forced-colors: active)` hides the rims, gives `.ui-card` a
  `CanvasText` border, paints `.ui-num` in `CanvasText` with no gradient, and
  keeps the segmented knob in `Highlight`.

Under reduced motion only the segmented control's press (`scale: 1.04`, inside
a `no-preference` query) stands down; nothing else in the material moves.

### Contrast budget

Worked from the tokens; `tests/flows-glass-render.mjs` measures the same
figures from pixels on four pages at three viewports and is the authority. The
brightest backdrop under any tile is the aurora's blue peak over the overlay,
about rgb(40, 55, 95) after saturate and brightness.

| Surface | Composite (approx.) | Relative luminance |
|---|---|---|
| Tile body (tint 0.72) | rgb(23, 28, 45) | 0.012 |
| Tile top band (sheen 3%) | rgb(30, 35, 51) | 0.016 |

| Text | On tile body | In the top band |
|---|---|---|
| `--label-1` | 17:1 | 15:1 |
| `--label-2` (0.64) | 6.6:1 | 6.0:1 |
| `--label-3` (0.58) | 5.5:1 | 5.1:1 |
| `--down` | 4.95:1 | 4.67:1 |
| `--accent-ink` | 6.0:1 | 5.5:1 |
| `--num-down-b` | 5.9:1 | 5.4:1 |
| `--num-up-b` | 7.5:1 | 7.0:1 |
| `--num-ice-b` | 10.4:1 | 9.6:1 |

The sidebar's text sits over the left sky under the 0.88 overlay, at most
rgb(37, 37, 35); the `--mat-side` composite is about rgb(23, 24, 28), giving
`--label-2` 6.6:1 and `--label-3` 5.5:1.

The dials, in order, if a measurement fails: `--mat-regular` 0.72 to 0.78;
`--aur-1` 0.16 to 0.12; the sheen 0.03 to 0.

## The state set

A module has one state at a time, set as `data-s` on `.ds-mod`, and its chip
`.ds-st` repeats it. The chip always carries the state's name as text and its
own glyph, so colour is never the only cue. The tone is a custom property,
`--ds-tone`, shared by the chip and the module's left rule.

| State | Name on the chip | Glyph | Tone | Meaning and body |
|---|---|---|---|---|
| `loading` | Loading | turning arc | neutral | The first read is on its way. The body reserves `--ds-reserve` (96 px by default) with `.ds-sk` bars so nothing jumps when it arrives. |
| `quiet` | Quiet | small ring | neutral | The read succeeded and there is nothing to show. Dashed edge. Say so in a sentence. |
| `partial` | Partial | half-filled circle | warn | Some sources answered. Name which did not. |
| `pending` | Pending | dashed ring | neutral | A source is still being read and will finish; the page does not poll for it faster than its class. Dashed edge. |
| `stale` | Stale | diamond | warn | The data is older than its class allows. Print its age from the source's own timestamp. |
| `withheld` | Withheld | dash | neutral | The page holds the value back and says why (a null input, an unstated unit). Dashed edge. |
| `unavailable` | Unavailable | cross | down | The source failed. The body offers `Retry` as a `.ds-btn`. |
| `signedOut` | Signed out | square ring | accent | The reader needs to sign in. The body offers the sign-in link as a `.ds-btn`. |
| `quota` | Quota reached | bar | warn | A daily budget is spent; say when it resets. |
| `plan` | Plan | filled square | accent | The module belongs to a plan the reader does not have. The body offers the plans link. |
| `held` | Held | two bars | accent | The previous model text is kept while a new one is written. Label it as the previous reading. |
| `live` | Live | filled circle | up | Updating inside its live window. |
| `fresh` | Fresh | ring | accent | Read inside its fresh window but not streaming. |
| `closed` | Closed | half circle | neutral | The market is closed; the last session is shown and labelled. |

The first eleven describe what a module holds; the last three are the
freshness states the pill and the rail already speak, drawn once here. A
module's footer, `.ds-foot`, names its source, its as-of time and its grade.

## Components in the kit

| Class | What it is |
|---|---|
| `.ds-mod`, `.ds-head`, `.ds-ov`, `.ds-body`, `.ds-foot` | The module: overline, chip, body, provenance footer. |
| `.ds-st` | The state chip. Put an empty `<i>` first and the name after it. |
| `.ds-sk` | A skeleton bar for `loading`. It pulses; reduced motion stills it. |
| `.ds-btn` | A button or link-as-button, `--row-h` tall, with its 44 px hit area. |
| `.ds-row` | A table or list row, `--row-h` tall, tabular figures. |
| `.ds-sg` | A signed figure: `data-dir` is `up`, `down` or `flat`, an `<i>` draws the shape, and the text carries `+` or U+2212. |

## Adopted by

The Track page, the first adopter of the kit, was removed; the kit stays in `assets/css/flows.css`.

## Forced colors

`@media (forced-colors: active)` gives the module, chip and button a
`CanvasText` edge, drops the shadows, paints the glyph and sign shapes in
`CanvasText` (their fills would otherwise be flattened to the canvas), draws a
skeleton bar in `GrayText`, and keeps the focus outline. Anything new that
draws its meaning with a background colour needs the same treatment.

## Backdrop blur

The existing materials keep their backdrop blur, and the reduced-transparency
and high-contrast branch still turns it off. The kit's surfaces are opaque, so
it adds no blur. Whether to extend the reduced branch to `(pointer: coarse)` is
decided by a real-device trace of Market scrolling (an iPhone Safari timeline
and a mid-range Android Chrome trace); if frames drop, add the media query to
that branch, a one-line change.

## Browser floor

The kit uses `color-mix()`, `:is()`, `clip-path`, `inset`, `max()` inside
`calc()` and `@media (forced-colors)`, which every evergreen Chromium, Firefox
and Safari from 2023 on supports. A browser without them loses a chip's border
tint or a hit area's extension and keeps the text, the glyph and the edge.

## The kit test

`tests/flows-kit-render.mjs` (`npm run test:flows-kit`) needs Chromium and no
server. It serves the shipped `base.css` and `flows.css` from disk on a fake
origin and renders every state, a compact and a default density block, signed
figures and every control, then checks at 320, 390, 768 and 1440 px:

- no horizontal overflow, no element outside the viewport;
- every text node at least 4.5:1 over its composited surface, nothing under 11
  px, no text under a translucent ancestor;
- the 44 by 44 px area around every control resolves to the control by
  `elementFromPoint`;
- a visible focus outline of at least 2 px on every control, reached by Tab in
  document order;
- the fourteen named states, each with its name, its own glyph and its tone, a
  loading module that reserves its height, and a provenance footer;
- the colour-vision rule above, and the printed sign beside a rise and a fall;
- forced colors, reduced motion and a coarse pointer, where compact density
  gives way to 44 px rows.

A new component adds its states and its markup to the kit before it ships.
