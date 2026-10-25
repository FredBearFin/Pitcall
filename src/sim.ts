// Simulation harness (test/analysis only; the app never imports this file).
//
// Runs the REAL planning pipeline (computeMeatCount -> fitToSlots, learning from closed rows exactly as the
// screens save them) against a simulated restaurant whose true demand we know, and compares it with an owner
// who cooks by gut. Both "worlds" see the same demand on the same nights (common random numbers), so the
// difference between them is the decision rule, not luck.
import { curveF, fitToSlots, realizedProfit, savedVsOwner } from './engine';
import { DEFAULT_SETTINGS, SEED_MEATS, addDays, computeMeatCount, ranOut } from './logic';
import type { CurveKind, Meat, PlanRecord, SaleRecord, Settings } from './types';

// ------------------------------------------------------------------ seeded randomness
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (rnd: () => number): number => {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};

// ------------------------------------------------------------------ scenario
export interface OwnerType {
  name: string;
  /** Multiplier on the owner's idea of a normal night (1.25 = cooks a quarter extra). */
  bias: number;
  /** Night-to-night wobble in the owner's gut, as a fraction (0.2 = +-20% typical). */
  sd: number;
}
export const OWNERS: Record<'overcooker' | 'balanced' | 'undercooker', OwnerType> = {
  overcooker: { name: 'cooks 25% extra to never run out', bias: 1.25, sd: 0.15 },
  balanced: { name: 'knows the average night, +-20% gut error', bias: 1.0, sd: 0.2 },
  undercooker: { name: 'cooks 15% light, runs out often', bias: 0.85, sd: 0.15 },
};

export interface Scenario {
  label: string;
  owner: OwnerType;
  /** True usual-night demand = the meat's usualGuess x this. 1 means the guess typed into Settings is right. */
  guessError: number;
  /** Demand scatter (coefficient of variation) of a night, after weekday effect. */
  cv: number;
  /** Fraction of nights that are freak nights (storm, event) at x0.4 or x2.0 and are NOT marked unusual. */
  freakRate: number;
  /** The restaurant's real arrival pattern; the app assumes settings.curve. */
  trueCurve: CurveKind;
  /** Chance the cook forgets to tap 86 on a night that sold out. */
  tapMissRate: number;
  /** Smoker capacity in slots. The app's default (12) is smaller than the seed meats need on a normal night, so the base case uses a roomy smoker. */
  smokerSlots: number;
  /** Share of unmet demand that is really lost (the rest buys another meat at the same margin). The old math assumed 1. Default 1. */
  trueLostShare?: number;
  /** What the planner is told the lost-sale share is. Default: the app's own default (DEFAULT_LOST_SALE_SHARE). */
  appLostShare?: number;
  nights: number;
  restaurants: number;
}
export const BASE: Scenario = {
  label: 'base', owner: OWNERS.balanced, guessError: 1, cv: 0.3, freakRate: 0, trueCurve: 'lunch', tapMissRate: 0.1, smokerSlots: 32, nights: 70, restaurants: 60,
};

/** Sun..Sat. Barbecue is a weekend business; mean 1. */
export const WEEKDAY = [1.05, 0.6, 0.7, 0.8, 0.95, 1.4, 1.5].map((x, _i, a) => x / (a.reduce((p, q) => p + q, 0) / 7));
export const START_DATE = '2026-01-05'; // a Monday

// ------------------------------------------------------------------ world
export interface NightMeat {
  date: string; meatId: string; demandLb: number; cookedLb: number; pieces: number; ownerPieces: number; profit: number;
  soldOut: boolean; leftoverLb: number; recoveredLb: number | null; claimedSaved: number | null; trueSaved: number | null;
  mean: number; sigma: number; nStar: number; rangeLo: number; rangeHi: number; slotsUsed: number;
}
export interface RunOut { nights: NightMeat[][]; /** per night, per meat */ sales: SaleRecord[]; plans: PlanRecord[]; settings: Settings; meats: Meat[] }

interface Draws { demand: number[][]; ownerNoise: number[][]; tapMiss: number[][]; dates: string[]; }

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function drawRestaurant(sc: Scenario, meats: Meat[], seed: number): Draws {
  const rnd = mulberry32(seed);
  const dates: string[] = [];
  const demand: number[][] = [];
  const ownerNoise: number[][] = [];
  const tapMiss: number[][] = [];
  const sig = Math.sqrt(Math.log(1 + sc.cv * sc.cv));
  const startOffset = Math.floor(rnd() * 7); // a real restaurant starts using the app on any weekday, not always a slow Monday
  for (let t = 0; t < sc.nights; t++) {
    const date = addDays(START_DATE, startOffset + t);
    dates.push(date);
    const wk = WEEKDAY[dayOfWeek(date)];
    const row: number[] = [];
    const nz: number[] = [];
    const tm: number[] = [];
    for (const m of meats) {
      let d = m.usualGuess * sc.guessError * wk * Math.exp(sig * normal(rnd) - (sig * sig) / 2);
      if (rnd() < sc.freakRate) d *= rnd() < 0.5 ? 0.4 : 2.0;
      row.push(d);
      nz.push(normal(rnd));
      tm.push(rnd());
    }
    demand.push(row);
    ownerNoise.push(nz);
    tapMiss.push(tm);
  }
  return { demand, ownerNoise, tapMiss, dates };
}

/** Hour at which cumulative arrivals of a night with total demand D reach capacity K (D > K). */
function sellOutHour(F: (t: number) => number, K: number, D: number, open: number, close: number): number {
  const target = K / D;
  let lo = open, hi = close;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (F(mid) < target) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 4) / 4; // a cook taps to the quarter hour
}

/** What the owner would type for a meat on a night, before seeing Pitcall. */
function ownerNumber(sc: Scenario, m: Meat, date: string, noise: number): number {
  const Y = m.rawWeight * m.yield;
  const normalNight = m.usualGuess * sc.guessError * WEEKDAY[dayOfWeek(date)];
  const gut = normalNight * sc.owner.bias * Math.exp(sc.owner.sd * noise);
  return Math.max(0, Math.round(gut / Y));
}

/** Smoker is physically full: trim the biggest user of slots until it fits (what a cook would do). */
function trimToSmoker(pieces: Record<string, number>, meats: Meat[], totalSlots: number): Record<string, number> {
  const out = { ...pieces };
  const used = () => meats.reduce((s, m) => s + m.slots * (out[m.id] ?? 0), 0);
  let guard = 10000;
  while (used() > totalSlots + 1e-9 && guard-- > 0) {
    let worst: Meat | null = null;
    for (const m of meats) if ((out[m.id] ?? 0) > 0 && (!worst || m.slots * out[m.id] > worst.slots * out[worst.id])) worst = m;
    if (!worst) break;
    out[worst.id] -= 1;
  }
  return out;
}

export type Policy = 'pitcall' | 'owner';

export function runWorld(sc: Scenario, policy: Policy, seed: number, meats: Meat[] = SEED_MEATS, base: Settings = DEFAULT_SETTINGS): RunOut {
  // What the planner is told about lost sales (settings.lostSaleShare) versus what is really true in this restaurant.
  const settings: Settings = { ...base, smokerSlots: sc.smokerSlots, lostSaleShare: sc.appLostShare ?? base.lostSaleShare };
  const truth: Settings = { ...settings, lostSaleShare: sc.trueLostShare ?? 1 };
  const dr = drawRestaurant(sc, meats, seed);
  const Ftrue = curveF(sc.trueCurve, settings.openHour, settings.closeHour, null);
  const sales: SaleRecord[] = [];
  const plans: PlanRecord[] = [];
  const nights: NightMeat[][] = [];
  for (let t = 0; t < sc.nights; t++) {
    const date = dr.dates[t];
    const calc: Record<string, ReturnType<typeof computeMeatCount>> = {};
    let fitted: Record<string, number> = {};
    if (policy === 'pitcall') { // the owner world never consults the forecast, so skip its cost there
      for (const m of meats) calc[m.id] = computeMeatCount({ meat: m, settings, sales, plans, date, cateringLb: 0 });
      fitted = fitToSlots(Object.fromEntries(Object.entries(calc).map(([k, v]) => [k, v.result])), meats, settings.smokerSlots);
    }
    const ownerRaw: Record<string, number> = {};
    meats.forEach((m, i) => { ownerRaw[m.id] = ownerNumber(sc, m, date, dr.ownerNoise[t][i]); });
    const ownerFit = trimToSmoker(ownerRaw, meats, settings.smokerSlots);
    const chosen = policy === 'pitcall' ? fitted : ownerFit;
    const row: NightMeat[] = [];
    meats.forEach((m, i) => {
      const Y = m.rawWeight * m.yield;
      const pieces = chosen[m.id] ?? 0;
      const K = pieces * Y;
      const D = dr.demand[t][i];
      const sold = Math.min(D, K);
      const soldOut = D > K + 1e-9;
      const leftover = K - sold;
      const tapped = soldOut && K > 0 && dr.tapMiss[t][i] >= sc.tapMissRate;
      const soldOutAt = tapped ? sellOutHour(Ftrue, K, D, settings.openHour, settings.closeHour) : null;
      const sale: SaleRecord = {
        date, meatId: m.id, cookedLb: K, leftoverLb: Math.round(leftover * 10) / 10, cateringLb: 0, soldOutAt, halfGoneAt: null, leftoverUse: null, closed: true,
      };
      const c = calc[m.id] as ReturnType<typeof computeMeatCount> | undefined;
      const plan: PlanRecord = {
        date, meatId: m.id, ownerPieces: ownerFit[m.id], pitcallPieces: c ? c.result.nStar : pieces, rangeLo: c ? c.result.rangeLo : pieces,
        rangeHi: c ? c.result.rangeHi : pieces, finalPieces: pieces, mean: c ? c.forecast.mean : 0, sigma: c ? c.forecast.sigma : 0,
        cr: c ? c.result.cr : 0, cateringLb: 0, yPerPiece: Y, accepted: true,
      };
      sales.push(sale);
      plans.push(plan);
      const profit = realizedProfit({ capacityLb: K, demandLb: D, meat: m, settings: truth });
      let claimed: number | null = null;
      let trueSaved: number | null = null;
      if (policy === 'pitcall') {
        claimed = savedVsOwner({
          ownerPieces: ownerFit[m.id], pitcallPieces: pieces, yPerPiece: Y, cateringLb: 0, walkInSoldLb: sale.cookedLb - sale.leftoverLb,
          soldOut: ranOut(sale), meat: m, settings,
        });
        trueSaved = profit - realizedProfit({ capacityLb: ownerFit[m.id] * Y, demandLb: D, meat: m, settings: truth });
      }
      row.push({
        date, meatId: m.id, demandLb: D, cookedLb: K, pieces, ownerPieces: ownerFit[m.id], profit, soldOut, leftoverLb: leftover, recoveredLb: null,
        claimedSaved: claimed, trueSaved, mean: plan.mean, sigma: plan.sigma, nStar: plan.pitcallPieces,
        rangeLo: plan.rangeLo, rangeHi: plan.rangeHi, slotsUsed: m.slots * pieces,
      });
    });
    nights.push(row);
  }
  return { nights, sales, plans, settings, meats };
}

// ------------------------------------------------------------------ summaries
export interface Window { from: number; to: number; label: string }
export const WINDOWS: Window[] = [
  { from: 0, to: 7, label: 'nights 1-7' },
  { from: 7, to: 14, label: 'nights 8-14' },
  { from: 14, to: 28, label: 'nights 15-28' },
  { from: 28, to: 70, label: 'nights 29-70' },
];
export const nightProfit = (n: NightMeat[]): number => n.reduce((s, x) => s + x.profit, 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] : 0;
};

export interface Summary {
  scenario: Scenario;
  /** Average extra profit per night (Pitcall minus owner, all meats) in each window: mean, p10, p90 across restaurants, share of restaurants ahead. */
  windows: { label: string; mean: number; p10: number; p90: number; ahead: number }[];
  ownerNightlyProfit: number;
  pitcallNightlyProfit: number;
  ownerSellOutRate: number;
  pitcallSellOutRate: number;
  ownerLeftoverLb: number;
  pitcallLeftoverLb: number;
  claimedTotal: number;
  trueTotal: number;
}

export function summarize(sc: Scenario, seed0: number): Summary {
  const diffs: number[][] = WINDOWS.map(() => []);
  let ownerProfit = 0, pitProfit = 0, oSO = 0, pSO = 0, oLeft = 0, pLeft = 0, claimed = 0, truth = 0, cells = 0, nightsN = 0;
  for (let r = 0; r < sc.restaurants; r++) {
    const seed = seed0 + r * 7919;
    const P = runWorld(sc, 'pitcall', seed);
    const O = runWorld(sc, 'owner', seed);
    WINDOWS.forEach((w, wi) => {
      const to = Math.min(w.to, sc.nights);
      if (to <= w.from) return;
      const d = mean(P.nights.slice(w.from, to).map(nightProfit)) - mean(O.nights.slice(w.from, to).map(nightProfit));
      diffs[wi].push(d);
    });
    for (let t = 0; t < sc.nights; t++) {
      nightsN += 1;
      ownerProfit += nightProfit(O.nights[t]);
      pitProfit += nightProfit(P.nights[t]);
      for (const x of O.nights[t]) { cells += 1; if (x.soldOut) oSO += 1; oLeft += x.leftoverLb; }
      for (const x of P.nights[t]) { if (x.soldOut) pSO += 1; pLeft += x.leftoverLb; claimed += x.claimedSaved ?? 0; truth += x.trueSaved ?? 0; }
    }
  }
  return {
    scenario: sc,
    windows: WINDOWS.map((w, i) => ({
      label: w.label, mean: mean(diffs[i]), p10: pct(diffs[i], 0.1), p90: pct(diffs[i], 0.9), ahead: diffs[i].filter((x) => x > 0).length / Math.max(1, diffs[i].length),
    })),
    ownerNightlyProfit: ownerProfit / nightsN,
    pitcallNightlyProfit: pitProfit / nightsN,
    ownerSellOutRate: oSO / cells,
    pitcallSellOutRate: pSO / cells,
    ownerLeftoverLb: oLeft / nightsN,
    pitcallLeftoverLb: pLeft / nightsN,
    claimedTotal: claimed / sc.restaurants,
    trueTotal: truth / sc.restaurants,
  };
}
