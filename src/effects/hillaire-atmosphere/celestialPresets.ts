/** Disc diameter only. Display gains and halo controls never enter transport. */
export const celestialSizePresets={
  physical:{label:'物理盘径 1×',sunScale:1,moonScale:1},
  double:{label:'盘径 2×',sunScale:2,moonScale:2},
  enhanced:{label:'视觉增强 · 日 3.2× / 月 3.0×',sunScale:3.2,moonScale:3},
} as const;

// USNO primary phases, UTC (not local civil time). A camera away from Earth's
// centre sees a slightly different illuminated fraction. Tests use the centre.
// https://aa.usno.navy.mil/calculated/moon/phases?date=2026-10-01&format=p&nump=6
export const lunarPhasePresets={
  new:{label:'新月',utc:'2026-10-10T15:50:00Z',fraction:0},
  first:{label:'上弦',utc:'2026-10-18T16:12:00Z',fraction:.5},
  full:{label:'满月',utc:'2026-10-26T04:12:00Z',fraction:1},
  last:{label:'下弦',utc:'2026-11-01T20:28:00Z',fraction:.5},
} as const;
