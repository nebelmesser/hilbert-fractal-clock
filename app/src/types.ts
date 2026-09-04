export type ModeId = 'today' | 'month' | 'year' | 'epoch' | 'arbitrary';

export type CellBox = { x: number; y: number; w: number; h: number };

export type HilbertGrid = {
  xs: Uint16Array;
  ys: Uint16Array;
  at: Int32Array;
  n: number;
};

export type GridSpec = {
  w: number;
  h: number;
  cells: number;
  cellDur: number;
  leftover: number;
  score?: number;
};

export type TimeUnitId =
  | 'century' | 'year' | 'month' | 'day'
  | 'hour' | 'minute' | 'second'
  | 'ms100' | 'ms10' | 'ms1';

export type TimeUnit = {
  id: TimeUnitId;
  typical: number;
  index: (t: number) => number;
  start: (t: number) => number;
  end: (t: number) => number;
  label: (t: number) => string;
};

export type HilbertBlock = {
  box: CellBox;
  i0: number;
  i1: number;
  area: number;
  depth?: number;
};

export type ZoomLevel = {
  depth: number;
  w: number;
  h: number;
  area: number;
  maxArea: number;
  k: number;
  D: number;
  mixed: boolean;
  nowArea?: number;
  nowW?: number;
  nowH?: number;
};

export type InsetPlan = { k: number; D: number; W?: number; H?: number };

export type ZoomWindow = {
  i0: number;
  i1: number;
  start: number;
  end: number;
  box: CellBox;
  k: number;
  depth: number;
  area: number;
  D: number;
  px: number;
  err: number;
  flip: boolean;
  idx?: number[];
  ladderDepth?: number;
  wantArea?: number;
  maxArea?: number;
  wantMs?: number;
  wantW?: number;
  wantH?: number;
};

export type ZoomLock = {
  depth: number;
  maxArea: number;
  wantMs: number;
  wantW: number;
  wantH: number;
  w: number;
  h: number;
  k: number;
  cssW: number;
};

/** Parent L1 ramp shared with the inset so zoom fill matches the main map. */
export type RampShare = {
  minId: number;
  maxId: number;
  ids: Int32Array;
  unit: TimeUnit;
  start: number;
  end: number;
};

export type MapLayout = {
  grid: GridSpec;
  g: HilbertGrid;
  levels: TimeUnit[];
  levelIds: Int32Array[];
  labelLevel: number;
  cssWidth: number;
  cssHeight?: number;
  cellStart: Float64Array;
  inherit?: Int32Array[];
  ramp?: RampShare;
  /** Parent label unit, drawn large and faint under the inset's own labels. */
  echo?: { unit: TimeUnit; ids: Int32Array };
};

export type LabelSlotKind = 'square' | '4x3' | '16x9';

export type LabelPlace = { x: number; y: number; w: number; h: number; area: number };

export type ThemeColors = {
  past: number;
  pastFrom: number;
  pastSatDip: number;
  future: number;
  curPast: number;
  curFuture: number;
  head: number;
  surplus: number;
  labelAlpha: number;
  labelEmptyAlpha: number;
  labelLive: string;
  labelLiveEmpty: string;
  currentOutline: string;
  zoom: string;
  bound0: string;
  boundAlpha1: number;
  boundAlpha2: number;
  boundAlpha3: number;
};

export type TimeRange = { start: number; end: number };

export type FitPack = {
  dir: 'row' | 'col';
  widths: number[];
  heights: number[];
  area?: number;
};
