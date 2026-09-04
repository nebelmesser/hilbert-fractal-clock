// Time. Changing these rescales every duration table, tick, and caption.
export const MS_SEC = 1000; // 1s — ticks, INSET_MAX_D, zoomable parent, formatDur
export const MS_MIN = 60000; // minute unit + NICE_DURS steps
export const MS_HOUR = 3600000; // hour unit + NICE_DURS steps
export const MS_DAY = 86400000; // day / D-M-Y ranges + NICE_DURS steps
export const MS_100 = 100; // 0.1s — finest usual inset cell (INSET_CELL_DURS)
export const MS_10 = 10; // 10ms unit on the boundary ladder
export const UNIX32_END = 2147483648000; // last ms of signed 32-bit Unix time (2038-01-19). Unix preset end.

// Grid size. Changing these changes w×h, cell duration, and zoomability.
export const MAX_CELLS = 280000; // soft cap for a normal parent grid. Raise = finer maps, more RAM.
export const MAX_CELLS_HARD = 1000000; // parent may grow to this if it must be 1s-zoomable
export const MIN_CELLS = 16; // refuse a grid smaller than this (except tiny exact ranges)
export const MIN_CSS_PX = 8; // refuse / ignore maps smaller than this
export const ASPECT_MIN = 0.42; // pickGrid / Fit: never ask for a grid skinnier than this
export const ASPECT_MAX = 3.2; // never ask for a grid wider than this
export const MIN_CELL_PX = 2.2; // prefer a finer cell only if it stays ≥ this many CSS px
export const ZOOM_K_DUR_EPS = 0.75; // k²×D must match parent duration within this many ms
export const CELL_CAP_SLACK = 1.05; // consider() may exceed maxCells by this
export const HILBERT_CACHE_MAX = 10; // parent curves kept in cache; overflow clears the map
export const FACTOR_MIN = 2; // smallest side / zoom k
export const POW2_SIDE_LO = 6; // candidate 64×64 (Epoch squares)
export const POW2_SIDE_HI = 10; // candidate 1024×1024
export const GRID_SEARCH_SPAN_MIN = 80; // min width scan around √(cells×aspect)
export const GRID_SEARCH_SPAN_FRAC = 0.35; // extra scan = this × approxW. Raise = slower pick, more shapes.

// scoreGrid — lower is better. Changing weights picks a different w×h / cellDur.
export const SCORE_WIDE_WEIGHT = 3.4; // extra cost when the grid is wider than the target
export const SCORE_TALL_WEIGHT = 2.2; // extra cost when taller than the target (hurts less than wide)
export const SCORE_ODD_PENALTY = 0.1; // per odd side — Hilbert prefers even
export const SCORE_QUAD_PENALTY = 0.04; // per side not divisible by 4
export const SCORE_POW2_CELLS = 4096; // min n for the 2ⁿ-square Epoch bonus
export const SCORE_NEAR_SQUARE_LO = 0.75; // targetAspect below this is not "near square"
export const SCORE_NEAR_SQUARE_HI = 1.35; // targetAspect above this is not "near square"
export const SCORE_SQUARE_BONUS = -0.7; // 2ⁿ×2ⁿ exact-fit when the duration is also 2ⁿ seconds
export const SCORE_EXACT_BONUS = -0.2; // leftover === 0
export const SCORE_LEFTOVER_WEIGHT = 3; // leftoverRatio × this (black surplus cells)
export const SCORE_COUNT_WEIGHT = 1.05; // |log(n / targetCells)|
export const SCORE_NICE_DIM_BONUS = -0.05; // both sides in NICE_DIMS
export const SCORE_PREFER_DUR_BONUS = -0.5; // cellDur matches pickFineCellDur
export const SCORE_FINE_DUR_BONUS = -0.12; // cellDur is 1s / 0.5 / 0.25 / 0.1
export const SCORE_ZOOMABLE_BONUS = -0.55; // parent cell refines to 0.1–1s
export const SCORE_NOT_ZOOMABLE = 1.2; // parent >1s that cannot refine
export const SCORE_WHOLE_SEC_BONUS = -0.12; // zoomable parent whose cell is a whole second
export const SCORE_DAY_RECT_BONUS = -2.8; // civil day: leftover 0, 24 | cells, exact 86400s, canonical aspect
export const SCORE_DAY_HOUR_TILE = -0.4; // w×h can be tiled by 24 hour rectangles (6×4, 8×3, …)
export const SCORE_DAY_LEFTOVER = 2.4; // leftover / uneven hours / non-canonical aspect on a civil day
export const DAY_ASPECTS: Array<[number, number]> = [ // familiar day rectangles; both orientations
  [1, 1],
  [4, 3], [3, 4],
  [3, 2], [2, 3],
  [2, 1], [1, 2],
  [16, 9], [9, 16],
];
export const DAY_HOUR_TILES: Array<[number, number]> = [ // 24 = fw×fh; hour tile is (w/fw)×(h/fh)
  [8, 3], [6, 4], [4, 6], [3, 8],
];

// Boundary / label units. Changing these adds/drops strokes and which unit is lettered.
export const UNIT_MIN_CELL_SPAN = 2.2; // unit typical must span at least this many cells
export const UNIT_MIN_REGIONS = 1.6; // whole map is one slab — no internal edge
export const UNIT_MIN_CELLS_PER = 6; // region smaller than this is invisible as a bound
export const MAX_BOUND_LEVELS = 3; // century → … → second; drawn coarsest to hairline
export const LABEL_DAY_MIN = 1.5; // prefer day labels on a ~month view
export const LABEL_DAY_MAX = 45; // above this many days, do not force day labels
export const LABEL_TARGET_REGIONS = 18; // ideal count of labeled slabs
export const LABEL_TOO_MANY = 48; // more regions than this starts costing
export const LABEL_TOO_FEW = 4; // fewer than this starts costing
export const LABEL_TOO_FEW_WEIGHT = 4; // too-few penalty is this × (LABEL_TOO_FEW − n)
export const LABEL_TINY_FRAC = 0.35; // skip fragments smaller than this × median region
export const LABEL_FIT_PAD = 0.98; // refuse draw if glyph exceeds this of the place box
export const LABEL_FALLBACK_PX = 16; // if fontFit fails, use this
export const LABEL_MAX_PX = 28; // cap on large maps so glyphs do not blow up
export const LABEL_FILL = 0.84; // font = this × the place rectangle
export const LABEL_OUTLIER_RATIO = 0.55; // one much-smaller slot may use a smaller font; the rest keep the shared size
export const LABEL_LIVE_MS = 10 * MS_SEC; // live glyph place; raise to hold still, lower to chase the fill
export const LABEL_FONT = '500 '; // CSS font-weight prefix before the px size
export const LABEL_FONT_STACK = 'px system-ui, sans-serif';
export const LABEL_ALPHA = 0.38; // past glyph opacity vs the block fill (black on pastel). Raise = stronger type.
export const LABEL_EMPTY_ALPHA = 0.34; // future glyph opacity vs --future (white on dark)
export const LABEL_ECHO_ALPHA = 0.16; // parent-unit watermark on the inset, past (black on fill)
export const LABEL_ECHO_EMPTY_ALPHA = 0.14; // inset watermark on future / empty
export const LABEL_ECHO_LIVE_ALPHA = 0.22; // inset watermark for the live parent unit (red)

// Zoom / overlay. Changing these changes the yellow box, inset k×D, and frames.
export const INSET_MIN_D = 1; // finest inset cell: 1ms
export const INSET_MAX_D = MS_SEC; // coarsest inset cell: 1s — min zoom keeps the second panel at this
export const ZOOM_PARENT_SHARE = 0.28; // skip a leaf that still covers ~¼+ of the parent (day 12h)
export const ZOOM_KEEP_AREA_LO = 0.65; // sliding: next leaf may not shrink below this × locked area
export const ZOOM_KEEP_AREA_HI = 2.25; // allow a slightly coarser sibling so mixed 3-way does not zoom in
export const ZOOM_RANGE_SHARE = 0.2; // max fraction of the time range
export const ZOOM_BUDGET_QUARTER = 2; // target = budget / this. Raise = smaller yellow box; 1 = use the full budget
export const ZOOM_COLLECT_MIN = 64; // always consider packed blocks at least this large
export const ZOOM_AREA_SCORE = 1000; // prefer larger packed block, then finer D
export const ZOOM_ASPECT_WEIGHT = 2500000; // row layout: |log(boxAspect / parentAspect)| × this — beat area so the inset matches the main panel
export const ZOOM_ASPECT_LOG_TIE = 0.08; // treat aspects this close as equal (~8%), then use area
export const ZOOM_LABEL_MIN_PX = 18; // if inset glyphs would be smaller, take a coarser (larger) window
// Yellow-box min on the parent canvas is ZOOM_BOX_MIN_PX (with the Hilbert walk). Not the inset tile.
export const ZOOM_RES_MAX = 1.15; // inset cells may only slightly exceed the parent grid
export const ZOOM_CSS_SLACK = 1.15; // inset cells may only slightly exceed the CSS pixel count of the tile
export const ZOOM_REFINE_UPGRADE = 1.05; // keep exact 0.1–1s k if it already fills this fraction of the kMax budget
export const CURRENT_UNIT_MAX_SHARE = 0.9; // if coarsest unit is almost the whole map, drop to next
export const DPR_MAX = 3; // cap devicePixelRatio on bounds / labels / highlight
export const HL_PAD_PX = 3; // yellow frame sits outside pixels; hl canvas is padded
export const CURRENT_OUTLINE_W = 1.4; // stroke around the live coarsest unit
export const ZOOM_FRAME_W = 2; // yellow box stroke (CSS px). Also --zoom-frame-w on icons.
export const ZOOM_FRAME_OUTSET = 1; // yellow box sits this many px outside the cells
export const INSET_FRAME_OUT = 2; // yellow frame sits this far outside the canvas (ZOOM_FRAME_OUTSET + ZOOM_FRAME_W/2)

// Bound strokes (CSS px). Changing these changes edge weight; hair also uses --bound-3.
export const BOUND_W = [0.6, 0.4, 0.2]; // [L1, L2, fallback] CSS px when the level is not a hairline
export const INHERIT_W = 2; // units coarser than this map (May|June on a day inset)
export const HAIR_GAIN = 0.5; // unclamped width when a unit-block is HAIR_REF_PX across
export const HAIR_REF_PX = 10; // "normal" block size. Raise = thinner lines on small blocks
export const HAIR_MIN = 0.16; // never thinner than this
export const HAIR_MAX = 0.8; // never thicker than this (3rd-order / finer-than-label)
export const BOUND_ALPHA_1 = 0.55; // L1 opacity vs the cell fill. Raise = stronger hour/day edges
export const BOUND_ALPHA_2 = 0.28; // L2 opacity vs the cell fill
export const BOUND_ALPHA_3 = 0.12; // L3/hair opacity vs the cell fill
export const BOUND_LUMA_SPLIT = 70; // fill luma below this → white overlay (future); else black overlay (past)
export const PAST_SAT_DIP = 0.5; // HSL sat cut at ramp midpoint (4t(1−t)). 0 = linear; 1 = gray mid.

// Fit / chrome. Changing these changes packing, overflow shrink, and F / resize timing.
export const STAGE_MIN_W = 160; // floor for stage / probe width
export const STAGE_GUTTER = 24; // fallback width = viewport − this, when stage.clientWidth is 0
export const AVAIL_H_CHROME = 34; // extra chrome subtracted from viewportRemainH
export const AVAIL_H_MIN = 120; // never treat remaining height as smaller than this
export const TILE_MIN = 80; // smallest Fit tile side
export const STACK_COL_GAP = 28; // column: keep the caption from kissing the next map
export const STACK_ROW_FRAME = 4; // yellow outline / hl pad sticks out of a row tile — add to the gutter
export const CAPTION_FALLBACK = 22; // caption height if the node is not laid out yet
export const CAPTION_MIN = 18; // never reserve less than this under a tile
export const CAPTION_PAD = 4; // added to measured caption height
export const CHROME_BASE = 20; // chromeHeight() when the top bar is unknown
export const CHROME_TOP_GAP = 10; // gap under the top bar in chromeHeight / viewportRemainH
export const FIT_PAD = 2; // inner margin of the stage when testing overflow
export const FIT_SHRINK = 0.97; // extra shrink after fitting overflow
export const FIT_SHRINK_EPS = 0.999; // ignore shrink factors this close to 1
export const OVERFLOW_SLACK = 1; // px slop before enforceFitInStage counts as overflow
export const PACK_CLOSE_PX = 6; // pack matches current tiles within this — skip a rebuild
export const RESIZE_EPS = 8; // ignore viewport jitter smaller than this
export const PINCH_SCALE_EPS = 0.02; // visualViewport.scale this far from 1 → pinch; do not rebuild maps
export const RESIZE_DEBOUNCE_MS = 120; // wait after the last resize before relayout
export const ORIENT_RELAYOUT_MS = 200; // delay after orientationchange
export const ARB_DEBOUNCE_MS = 1000; // Custom dates: relayout this long after the last input
export const CHROME_DBL_MS = 450; // double-click / double-tap on a panel toggles F
export const CHROME_DBL_PX = 40; // max travel between the two taps (fat-finger slop)
export const LOOP_MIN_MS = 16; // tick floor (~60 Hz)
export const LOOP_MAX_MS = 1000; // tick ceiling (never wait more than 1s)
export const GRID_ORIENT_EPS = 0.08; // swap w×h if pickGrid disagrees with a clearly tall/wide target
export const PORTRAIT_MIN_H_OVER_W = 1.35; // if Chrome reports a short innerHeight, still treat the slot as at least this tall
export const WIDE_STAGE_RATIO = 1.05; // stage is "wide" (side-by-side probe) if w ≥ h × this
export const PROBE_ROW_CAP = 48; // caption+gap reserved when probing a stacked two-panel layout
export const STAGE_USE_CLIENT_MIN = 40; // trust stage.clientWidth/Height only if both exceed this
export const TOP_USED_FALLBACK = 8; // top-bar height if the node is missing
export const FORMAT_MAX_PARTS = 2; // formatDur: at most this many "1d 4h" chunks
export const ORDINAL_TEEN_LO = 11; // 11th…13th, not 11st
export const ORDINAL_TEEN_HI = 13;

// Candidate cell durations and "nice" widths (tables, not knobs).
export const NICE_DURS = [ // pickGrid tries these cell durations first (plus exact-fit and k²×D)
  1, 2, 5, 10, 20, 50, 100, 200, 250, 500,
  MS_SEC, 2 * MS_SEC, 5 * MS_SEC, 10 * MS_SEC, 15 * MS_SEC, 20 * MS_SEC, 30 * MS_SEC,
  MS_MIN, 2 * MS_MIN, 5 * MS_MIN, 10 * MS_MIN, 15 * MS_MIN, 20 * MS_MIN, 30 * MS_MIN,
  MS_HOUR, 2 * MS_HOUR, 3 * MS_HOUR, 4 * MS_HOUR, 6 * MS_HOUR, 8 * MS_HOUR, 12 * MS_HOUR,
  MS_DAY, 2 * MS_DAY, 3 * MS_DAY, 7 * MS_DAY, 14 * MS_DAY,
  30 * MS_DAY, 90 * MS_DAY, 180 * MS_DAY,
  365 * MS_DAY, 730 * MS_DAY, 1825 * MS_DAY,
];

export const NICE_DIMS = [ // preferred grid sides; both in the set get SCORE_NICE_DIM_BONUS
  48, 60, 64, 72, 80, 90, 96, 100, 120, 128, 144, 150, 160, 180, 192,
  200, 216, 240, 250, 256, 270, 288, 300, 320, 360, 384, 400, 432, 450,
  480, 500, 512, 540, 576, 600, 640, 720, 768, 800, 864, 900, 960, 1024,
  1080, 1152, 1200, 1280, 1440,
];

export const MONTHS = [ // full English names on the map (not the D/M/Y buttons)
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const ZOOM_MIN_AREA = 8; // smallest packed parent block we will zoom (must match collectBlocks)
export const ZOOM_BOX_MIN_PX = 8; // min yellow-box side on the parent canvas (CSS px). Not the inset tile.
export const HILBERT_ZOOM_MAX_DEPTH = 12; // Gilbert children at this depth are already tiny
export const ZOOM_DEPTH_AREA_RATIO = 1.15; // skip a depth whose largest leaf is this close to the last kept size
export const ZOOM_STEP_MIN_SHRINK = 2.5; // +/−: skip a half-split of now's leaf; keep ~4-way / quartering
export const ZOOM_MIN_FILL_MS = 3 * MS_MIN; // finest yellow box must take at least this long to fill

export const FINE_CELL_DURS = [MS_SEC, 500, 250, MS_100]; // parent: prefer 1s, then 0.5 / 0.25 / 0.1 if a cell is ≥ MIN_CELL_PX
export const INSET_CELL_DURS = [MS_100, 250, 500, MS_SEC]; // parent-grid candidates so a cell can refine to ≤1s
export const ZOOM_KS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 20, 24, 25, 30, 32, 36, 40, 48, 60, 64]; // candidate k for k²×D parent durations

export const FRAME_KEY = 'clock-hilbert-frame'; // localStorage: last preset + Custom dates + zoom per mode. F-mode is not stored.
export const ZOOM_IDS = ['today', 'month', 'year', 'epoch', 'arbitrary'] as const; // keys of zoom area / duration maps
