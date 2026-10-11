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
