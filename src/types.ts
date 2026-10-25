// =====================================================================
// PITCALL SHARED CONTRACT (written by PM — do not change signatures
// without telling the PM; the engine and the UI are built against this).
//
// Conventions
//  - Hours are decimal hours of the day: 13.25 = 1:15 pm.
//  - Dates are local calendar days as 'YYYY-MM-DD'.
//  - All weights are pounds; money is dollars.
//  - The engine (src/engine.ts) is PURE TypeScript: no React, no SQLite,
//    no Expo imports. It is unit-tested with vitest.
// =====================================================================

export type CurveKind = 'steady' | 'lunch' | 'morning';

/** One meat on the menu (settings screen edits these). */
export interface Meat {
  id: string;
  name: string;
  rawCost: number;        // r: $ per RAW lb
  price: number;          // p: $ per cooked lb sold
  rawWeight: number;      // W: typical raw lb per piece
  yield: number;          // y: sellable cooked lb / raw lb, 0 < y <= 1
  slots: number;          // smoker slots one piece takes
  leftoverValue: number;  // v: $ per leftover lb that its best use adds vs binning (0 = throw out)
  leftoverCap: number;    // max leftover lb/day that outlet absorbs (ignored when leftoverValue = 0)
  usualGuess: number;     // μ0: owner's usual-day walk-in cooked lb (starting guess)
  cookHoursGuess: number; // owner's "my pieces take about __ hours"
  sort: number;           // display order
}

export interface Settings {
  smokerSlots: number;    // total slots in the smoker
  cardFee: number;        // f: card-fee share of price, e.g. 0.03
  packaging: number;      // u: paper + sauce $ per lb sold
  openHour: number;       // e.g. 11
  closeHour: number;      // e.g. 20
  restHours: number;      // R: rest time after pulling, hours
  curve: CurveKind;       // owner-picked demand curve until half-gone taps exist
  onTimeZ: number;        // z, default 1.28 (~90% ready on time)
  /** Share of a sale that is really lost when a meat runs out (the rest of those customers order another meat). 1 = every shortfall is a lost sale. Missing means 1, so old data and old tests behave as before. */
  lostSaleShare?: number;
}

/** One day of recovered walk-in demand for a meat (fed to the forecast). */
export interface DayPoint {
  date: string;
  demandLb: number;       // recovered walk-in demand in cooked lb
  event?: string;         // event tag, e.g. 'home game'; event days are excluded from baseline
}

/** What happened at close for one meat on one day. */
export interface SaleRecord {
  date: string;
  meatId: string;
  cookedLb: number;       // total cooked lb available that day (pieces cooked × Y)
  leftoverLb: number;
  cateringLb: number;     // certain catering lb taken out of the cooked lb
  soldOutAt: number | null;   // hour of the "86", or null if it did not sell out
  halfGoneAt: number | null;  // hour of the optional "half gone" tap
  leftoverUse: 'chopped' | 'chili' | 'staff' | 'binned' | null;
  /** false = row was created by a Service tap and never closed out (leftover 0 is a placeholder, not a fact).
   *  Missing means closed, so old rows and old backups behave as before. */
  closed?: boolean;
  /** true = the owner marked this night unusual (storm, event, closed early): do not learn from it. Missing means false. */
  unusual?: boolean;
}

/** Tonight's plan for one meat. */
export interface PlanRecord {
  date: string;           // SERVICE date (the day the meat will be sold)
  meatId: string;
  ownerPieces: number | null; // typed BEFORE seeing Pitcall's number
  pitcallPieces: number;  // n*
  rangeLo: number;        // good range (within 3% of best expected profit)
  rangeHi: number;
  finalPieces: number;    // what actually went on
  mean: number;           // locked forecast mean, lb
  sigma: number;          // spread used, lb
  cr: number;             // critical ratio used
  cateringLb: number;
  yPerPiece: number;      // Y = W × y at plan time
  accepted: boolean;
}

/** One logged cook (feeds the cook-time fit). */
export interface CookRecord {
  id: string;
  meatId: string;
  rawWeight: number;
  putOnMs: number;        // epoch ms
  pullMs: number;         // epoch ms
}

// ---------------------------------------------------------------------
// Engine API — implemented in src/engine.ts
// ---------------------------------------------------------------------

/** F(t): share of a normal day's demand that has arrived by hour t (0 before open, 1 at/after close). */
export type DemandCurve = (t: number) => number;

export interface Forecast {
  mean: number;           // lb, walk-in only, includes event lift and prior shrinkage
  sigma: number;          // lb
  nSameWeekday: number;   // number of past same weekdays used (n in the shrinkage formula)
  methodsUsed: number;    // how many of the 4 simple forecasts were available (0..4)
  eventLift: number;      // multiplier applied (1 when not an event day)
  missesUsed: number;     // number of past one-day-ahead misses behind sigma
}

export interface CountRow {
  n: number;              // pieces
  profit: number;         // expected profit for this count (see engine for definition)
  pSellOut: number;       // P(D > nY - P)
  expLeftoverLb: number;
}

export interface CountResult {
  Y: number;              // cooked lb per piece = W × y
  c: number;              // cost per cooked lb = r / y
  Cu: number;             // underage cost per lb = p(1-f) - u - c
  Co: number;             // overage cost per lb = c - v
  cr: number;             // critical ratio, capped at 0.95
  nStar: number;          // newsvendor count: smallest n with P(D <= nY - P) >= CR
  rangeLo: number;        // good range: all n whose expected profit is within 3% of best
  rangeHi: number;
  bestN: number;          // n with highest expected profit
  table: CountRow[];      // rows for n = 0..(some max); table[n].n === n
}

export interface CookFit {
  T: (rawWeight: number) => number; // cook hours for a piece of this raw weight
  sigmaT: number;                   // spread of leave-one-out cook-time misses, hours
  n: number;                        // cooks used
}

export interface PutOn {
  putOnAt: Date;          // when to load this piece
  rawWeight: number;
  holdHours: number;      // hold time the on-time safety buys (rest + z·σT)
}

// Engine function signatures (all exported from src/engine.ts):
//
// curveF(kind: CurveKind, open: number, close: number, halfGoneMedian?: number | null): DemandCurve
//
// recoverDemand(a: { soldLb: number; soldOutAt: number | null; F: DemandCurve;
//                    mean: number; sigma: number }):
//   { demandLb: number; method: 'exact' | 'scaled' | 'atLeast' }
//
// forecastDemand(a: { history: DayPoint[]; date: string; usualGuess: number; eventType?: string | null }): Forecast
//
// chooseCount(a: { mean: number; sigma: number; meat: Meat; settings: Settings; cateringLb: number }): CountResult
//
// fitToSlots(results: Record<string, CountResult>, meats: Meat[], totalSlots: number): Record<string, number>
//
// fitCookTime(cooks: { rawWeight: number; hours: number }[], guessHours: number): CookFit
//
// planPutOn(a: { serviceDate: string; pieces: number; rawWeight: number; fit: CookFit;
//                openHour: number; restHours: number; z: number }): PutOn[]
//
// realizedProfit(a: { capacityLb: number; demandLb: number; meat: Meat; settings: Settings }): number
//
// savedVsOwner(a: { ownerPieces: number; pitcallPieces: number; yPerPiece: number; cateringLb: number;
//                   walkInSoldLb: number; soldOut: boolean; meat: Meat; settings: Settings }): number
//   (see engine.ts doc comment for the worst-for-itself rule when soldOut)
