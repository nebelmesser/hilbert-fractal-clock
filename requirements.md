# Hilbert Clock — functional requirements

This document is the behavior contract for the Hilbert Clock. Source of truth
during the TypeScript migration was the former single-file
`hilbert/clock.html`. The public URL stays
`https://nebelmesser.com/hilbert/clock.html`.

The clock draws a half-open time interval `[start, end)` as a 2D space-filling
curve (generalized Hilbert / Gilbert). Consecutive moments stay adjacent on
screen, so an interval appears as a compact region rather than scattered
pixels.

## Theme and tunables

Map colors and most visual constants live as CSS custom properties on `:root`.
JavaScript reads them (`Theme` / `cssPixel`) and does not hard-code the
palette.

Tokens:

- `--bg` — page + surplus behind the map
- `--fg` — body text, button labels
- `--muted` — captions under the maps
- `--btn-border` — idle button + date-input stroke
- `--btn-active` — pressed preset fill
- `--btn-active-border` — pressed preset stroke
- `--accent` — pressed preset label
- `--input-bg` — custom date fields
- `--past` — elapsed cells not in the live unit
- `--future` — cells still ahead
- `--cur-past` — elapsed cells inside the live coarsest unit
- `--cur-future` — remaining cells inside the live unit
- `--head` — the living cell (`now`)
- `--surplus` — leftover cells past the range
- `--label` — labels on filled (past) regions
- `--label-empty` — labels on empty (future) regions
- `--label-live` — live-unit label on the filled half
- `--label-live-empty` — live-unit label on the empty half
- `--current-outline` — stroke around the live unit
- `--zoom` — yellow box + inset frame
- `--zoom-frame-w` — square zoom icons + map frames
- `--zoom-muted` — disabled zoom icons
- `--connector` — diagonals from parent box to inset
- `--bound-0` … `--bound-3` — inherited / coarsest / middle / hairline edges

Numeric thresholds (grid score, zoom, labels, fit, loop) are named constants
with the values from the original file.

## Map layers

Each panel is four stacked canvases:

1. **base** — cell fill (`ImageData`, `alpha: false`), pixelated
2. **bounds** — unit edges
3. **labels** — text
4. **hl** — live-unit outline + yellow zoom frame outside the cells
   (`HL_PAD_PX`, `ZOOM_FRAME_OUTSET`)

Cells are never stretched: a Fit slot letterboxes to the grid aspect.

## Fill

For each curve cell with start `t0` and duration `dur`:

- `now >= t0 + dur` → `--past`, or `--cur-past` if the cell is in the live
  coarsest unit
- `now` inside the cell → `--head`
- otherwise → `--future` / `--cur-future`
- leftover cells past the range → `--surplus`

The live unit is the coarsest unit on that map. If it covers more than
`CURRENT_UNIT_MAX_SHARE` (0.9) of the map, drop to the next level (or do not
highlight).

## Curve

- Generalized Hilbert (Gilbert) fill of an arbitrary `w × h` grid.
- Wide slabs split along `ax`, tall slabs along `bx`.
- An even square splits into four Hilbert quadrants, not a 3-way Gilbert band.
- Parent curves are cached (`HILBERT_CACHE_MAX = 10`).
- Inset: each parent cell becomes `k × k`. The refined path stays 4-connected
  (8 reflections × 2 directions, `pickZoomVariant`).

## Grid (`pickGrid`)

Pick `w × h` and `cellDur` for the range duration and the available slot
aspect.

- Aspect clamp: `ASPECT_MIN` 0.42 … `ASPECT_MAX` 3.2
- Soft cap `MAX_CELLS = 280000`; hard `MAX_CELLS_HARD = 1e6` if the parent
  must stay 1s-zoomable
- `MIN_CELLS = 16` (except tiny exact ranges)
- Prefer a cell ≥ `MIN_CELL_PX` CSS pixels
- Unix / epoch: `2³¹` seconds → a `2ⁿ × 2ⁿ` square; do not chase the CSS tile
- Leftover cells stay surplus / black
- A parent cell longer than 1s must refine to some `D` in `[1ms, 1s]`
  (`INSET_CELL_DURS`: 0.1s, 0.25s, 0.5s, 1s)
- Portrait: never ask for a landscape grid
- Today with one panel keeps the natural day picture — do not two-column pack
  it

## Boundary and label units

Ladder, coarse → fine. **No weeks.**

century (roman XXI) → year → month (English names) → day (ordinal 1st) →
hour (`HH`) → minute (`HH:MM`) → second (`HH:MM:SS`) → ms100 → ms10 → ms1

- Up to `MAX_BOUND_LEVELS` (3) local levels, coarsest on top of hairlines
- Stroke: `--bound-1/2/3` plus hairline clamp (`HAIR_MIN` … `HAIR_MAX`)
- The inset inherits units coarser than its local ladder as `--bound-0` /
  `INHERIT_W`
- A unit that is too small (typical span, region count, cells-per) is not
  drawn

## Labels

- One label level: prefer days on a ~month view (`LABEL_DAY_MIN` … `MAX`),
  else ~18 regions (`LABEL_TARGET_REGIONS`)
- Layer-wide slot: square / 4×3 / 16×9, **horizontal only** (never 3×4 / 9×16)
- One font size per layer, except a single small outlier
  (`LABEL_OUTLIER_RATIO`)
- Live glyph in wall-clock mode: place is refreshed every `LABEL_LIVE_MS`
  (10s). For a live unit that is not `second`, placement uses the filled or
  empty half
- **Speedup / timelapse (`speedup ≠ 1`):** live / past / empty **colors**
  follow `now`; **`placeMask` stays the full region**; glyph slots are pinned
  (`_labelPlaces`); `_liveLabel` is not cached
- Colors: `--label` / `--label-empty` / `--label-live` / `--label-live-empty`
  (muted, not translucent)

## Ranges and presets

Buttons: **D** (today), **M** (month), **Y** (year), **Unix**, **Range**, then
**+** / **−**.

- D / M / Y are the current local civil period and roll over at midnight
  (`navStamp`)
- Unix: `[0, 2147483648000)` — signed 32-bit epoch, exactly `2³¹` seconds
- Range: two `<input type="date">`, inclusive on the inputs; engine range is
  `[from, to + 1 day)`. `from` ≤ today, `to` ≥ today. Apply after a 1s debounce
- When a custom window has ended, advance to the next same-length window that
  contains `now`
- Epoch does not move
- Range is selected by the button only. There is no `R` keyboard shortcut

## Zoom / inset

- A second panel refines one packed Hilbert-tree leaf around *now*
- Yellow box sits outside the cells; the inset has its own yellow frame
- SVG connectors: two diagonals (row: parent right → inset left; column:
  parent bottom → inset top)
- `+` / `↑` / `=` — smaller window (deeper); `−` / `↓` / `_` — larger
- Steps are tree depths, not an arbitrary bbox. Skip a depth that only halves
  the current leaf or still covers ≳¼ of the parent (`ZOOM_PARENT_SHARE`)
- Coarsest inset cell `D ≤ 1s` (`INSET_MAX_D`); finest `1ms` (`INSET_MIN_D`)
- On **Today** (and when the parent `cellDur ≤ 1s`): default is one panel;
  `−` past the coarsest step dismisses the inset
- While `now` is inside the locked box, do not jump to another depth. When it
  leaves, slide to the next packed sibling with the same locked duration
  (`ZOOM_KEEP_AREA_LO` / `HI`) — no spontaneous zoom-in on a mixed 3-way split
- The inset must not greatly out-resolve the parent or the CSS tile
  (`ZOOM_RES_MAX`, `ZOOM_CSS_SLACK`)
- A grid change that is not a user `+/−` keeps the window duration. A real
  window resize forgets stored zoom (`forgetZoomOnResize`)

## Fit layout

- Both maps stay on the viewport with no page scroll (`fit-mode`)
- Row: shared paint height. Column: shared paint width. Prefer the packing
  with more map area. **Portrait always stacks**
- Row gap ≥ each map’s margin to the window edge, plus the yellow frame
- Overflow (including the highlight pad) → uniform shrink; the grid is not
  rebuilt
- Landscape phones (`max-height: 540px`) shrink chrome
- Captions: `formatRange · w×h @ cellDur · +leftover`

## Chrome (F-mode)

- `F`, or a **double click / double tap on any `.map-block`**, hides the top
  bar, the info link, and captions. Maps take the freed space
- Session only — not written to `localStorage`
- Detect on `pointerdown`, primary pointer, left button; window
  `CHROME_DBL_MS = 450`, `CHROME_DBL_PX = 40`; ignore a compatibility mouse
  event after touch (&lt; 700ms)
- CSS `touch-action: manipulation` on panels — do not zoom the page
- Browser fullscreen (`fullscreenchange`) hides captions and relayouts like F

## Keyboard

Ignore when Ctrl / Meta / Alt is down, or when focus is in an input.

- `D` `M` `Y` `U` — presets (not `R`)
- `F` — chrome
- `+` `=` `↑` zoom in; `−` `_` `↓` zoom out

## Persistence

`localStorage` key `clock-hilbert-frame`:

```
{ mode, layout: "fit", zoom, zoomMs, arbitrary? }
```

F-mode is not persisted. Corrupt JSON is ignored.

## Query parameters

- `?time=` or `?start=` — `YYYY-MM-DD-HH:MM:SS` or `YYYY-MM-DD` (local
  midnight). The clock keeps ticking from that origin
- `?speedup=X` (`X > 0`) — simulated time is `origin + X × wall elapsed`,
  capped at `1e12`. Enables timelapse label rules. Tick period is
  `finestCellDur / speedup`, clamped to 16…1000ms. Invalid values fall back
  to `1`

## Other UI

- Hover (mouse only): `title` is the local instant of that cell
  (`formatMoment`). Surplus / off-map is empty. Touch must not set `title`
- Info link `i` → `/hilbert/`
- gtag `G-5D8EGFYM3L`; Open Graph / Twitter / canonical as on the live page
- Resize / orientation: debounce 120ms, ignore jitter &lt; 8px;
  `orientationchange` waits 200ms. A `ResizeObserver` on the stage does
  **not** drop stored zoom

## Out of scope

- Weeks on the unit ladder
- A “Full” (scrolling) layout
- An `R` keyboard shortcut for Range
- Pixel / visual regression tests
- A shared monorepo with `4d/app`
