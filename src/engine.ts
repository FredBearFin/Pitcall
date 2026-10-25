// =====================================================================
// PITCALL ENGINE: pure TypeScript math (no React / Expo / SQLite).
// Implements steps 1-5 of "How it decides" plus "Checking that it works".
// Hours are decimal hours of day, weights are lb, money is dollars.
// =====================================================================
import type {
  CookFit,
  CountResult,
  CountRow,
  CurveKind,
  DayPoint,
  DemandCurve,
  Forecast,
  Meat,
  PutOn,
  Settings,
} from './types';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

/** Shrinkage weight (days of evidence the owner's guess is worth). */
const K_PRIOR = 3;
/** Quarter-pound units per lb: the NB distribution lives on these. */
const UNITS = 4;
/** Forecast works off at most this many recent baseline days, and the sigma backtest uses at most MAX_MISSES recent misses. */
const MAX_BASE = 800;
const MAX_MISSES = 60;

// ---------------------------------------------------------------------
// Demand curve F(t)
// ---------------------------------------------------------------------

/**
 * F(t): share of a normal day's demand that has arrived by hour t.
 * steady: F=u. lunch: 1-(1-u)^2.8 (55% by 1:15 pm on an 11-8 day). morning: 1-(1-u)^4.
 * If `halfGoneMedian` (hour) lies strictly inside the open..close window,
 * F = u^g with g = ln(0.5)/ln(u_med) so that F(median) = 0.5.
 */
export function curveF(
  kind: CurveKind,
  open: number,
  close: number,
  halfGoneMedian?: number | null,
): DemandCurve {
  const span = close - open;
  const toU = (t: number) => (span > 0 ? clamp((t - open) / span, 0, 1) : t >= close ? 1 : 0);
  if (typeof halfGoneMedian === 'number' && span > 0) {
    const um = (halfGoneMedian - open) / span;
    if (um > 0 && um < 1) {
      const g = Math.log(0.5) / Math.log(um);
      return (t) => Math.pow(toU(t), g);
    }
  }
  switch (kind) {
    case 'lunch':
      // Front-loaded: 1-(1-u)^2.8 gives F=0.55 at u=0.25 (1:15 pm on an 11-to-8 day),
      // matching the spec's worked example.
      return (t) => 1 - Math.pow(1 - toU(t), 2.8);
    case 'morning':
      return (t) => 1 - Math.pow(1 - toU(t), 4);
    default:
      return toU;
  }
}

// ---------------------------------------------------------------------
// Negative binomial in quarter-pound units
// ---------------------------------------------------------------------

/** A discrete distribution on quarter-pound units 0..pmf.length-1. */
export interface NBDist {
  pmf: number[];
  cdf: number[];
}

/**
 * Negative binomial with the given mean and sigma (both in lb), tabulated in
 * quarter-pound units out to about mean + 8 sd. Variance is forced to at least
 * 1.02 x mean so r stays finite. Built in log space and normalised, so large
 * means do not underflow P(0). mean <= 0 gives a point mass at 0.
 */
export function nbDist(meanLb: number, sigmaLb: number): NBDist {
  const m = meanLb * UNITS;
  if (!(m > 0) || !Number.isFinite(m)) return { pmf: [1], cdf: [1] };
  const sdIn = (Number.isFinite(sigmaLb) ? Math.max(0, sigmaLb) : 0) * UNITS;
  const v = Math.max(sdIn * sdIn, m * 1.02);
  const r = (m * m) / (v - m);
  const p = r / (r + m);
  const size = Math.min(400000, Math.max(16, Math.ceil(m + 8 * Math.sqrt(v)) + 2));
  const logq = Math.log(m / (r + m)); // log(1-p)
  const lp = new Array<number>(size);
  lp[0] = r * Math.log(p);
  for (let k = 0; k < size - 1; k++) lp[k + 1] = lp[k] + Math.log((k + r) / (k + 1)) + logq;
  let mx = -Infinity; // loop, not Math.max(...lp): spreading >100k args overflows the stack on some engines
  for (let k = 0; k < size; k++) if (lp[k] > mx) mx = lp[k];
  const pmf = lp.map((x) => Math.exp(x - mx));
  const tot = sum(pmf);
  const cdf = new Array<number>(size);
  let acc = 0;
  for (let k = 0; k < size; k++) {
    pmf[k] /= tot;
    acc += pmf[k];
    cdf[k] = Math.min(1, acc);
  }
  return { pmf, cdf };
}

/** P(D <= kLb) where kLb is a capacity in lb (negative gives 0). */
function probLE(d: NBDist, kLb: number): number {
  if (kLb < 0) return 0;
  const idx = Math.floor(kLb * UNITS + 1e-9);
  return idx >= d.cdf.length ? 1 : d.cdf[idx];
}

/** Prefix sums of k*pmf[k] so the count table costs O(1) per row instead of O(pmf). */
function firstMoments(d: NBDist): number[] {
  const out = new Array<number>(d.pmf.length);
  let acc = 0;
  for (let k = 0; k < d.pmf.length; k++) {
    acc += k * d.pmf[k];
    out[k] = acc;
  }
  return out;
}

// ---------------------------------------------------------------------
// Step 1: recover demand from sold-out days
// ---------------------------------------------------------------------

/**
 * Turns "sold s lb, 86'd at t" into an estimate of true walk-in demand.
 * - no sell-out: demand = sold, exact.
 * - F(t) >= 0.25: D = s / F(t) ('scaled'), never below s.
 * - earlier: 'atLeast', E[D | D >= s] under the NB forecast (mean, sigma).
 *   This is a single conditional-expectation pass, not iterated EM.
 */
export function recoverDemand(a: {
  soldLb: number;
  soldOutAt: number | null;
  F: DemandCurve;
  mean: number;
  sigma: number;
}): { demandLb: number; method: 'exact' | 'scaled' | 'atLeast' } {
  const { soldLb, soldOutAt, F, mean: mu, sigma } = a;
  if (soldOutAt === null) return { demandLb: soldLb, method: 'exact' };
  const f = F(soldOutAt);
  if (f >= 0.25) return { demandLb: Math.max(soldLb, soldLb / f), method: 'scaled' };
  const d = nbDist(mu, sigma);
  const from = Math.max(0, Math.ceil(soldLb * UNITS - 1e-9));
  let num = 0;
  let den = 0;
  for (let k = from; k < d.pmf.length; k++) {
    num += k * d.pmf[k];
    den += d.pmf[k];
  }
  const e = den > 1e-12 ? num / den / UNITS : soldLb;
  return { demandLb: Math.max(soldLb, e), method: 'atLeast' };
}

// ---------------------------------------------------------------------
// Step 2: forecast
// ---------------------------------------------------------------------

interface Pt {
  day: number; // days since epoch (UTC arithmetic on the date string, no TZ drift)
  y: number;
}

function dayNum(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday

/** Damped weekday factors: (n*f + 3)/(n + 3), f = weekday mean / overall mean. */
function weekdayFactors(hist: Pt[]): number[] {
  const overall = mean(hist.map((p) => p.y));
  const out: number[] = [];
  for (let w = 0; w < 7; w++) {
    const ys = hist.filter((p) => weekdayOf(p.day) === w).map((p) => p.y);
    const n = ys.length;
    const f = n > 0 && overall > 0 ? mean(ys) / overall : 1;
    out.push(Math.max(0.05, (n * f + K_PRIOR) / (n + K_PRIOR)));
  }
  return out;
}

/**
 * Plain average of the available simple forecasts for `target` using only
 * `hist` (baseline points strictly before target, ascending by day).
 * Returns value null when there is no history.
 */
function simpleForecast(hist: Pt[], target: number): { value: number | null; methods: number } {
  if (!hist.length) return { value: null, methods: 0 };
  const w = weekdayOf(target);
  const f = weekdayFactors(hist);
  const outs: number[] = [];

  const lastWeek = hist.find((p) => p.day === target - 7);
  if (lastWeek) outs.push(lastWeek.y);

  const same = hist.filter((p) => weekdayOf(p.day) === w).slice(-3).reverse();
  if (same.length) {
    const wts = [0.5, 0.3, 0.2].slice(0, same.length);
    const ws = sum(wts);
    outs.push(sum(same.map((p, i) => p.y * wts[i])) / ws);
  }

  const ds = hist.map((p) => p.y / f[weekdayOf(p.day)]);
  let level = ds[0];
  for (let i = 1; i < ds.length; i++) level = 0.3 * ds[i] + 0.7 * level; // Winters, no trend
  outs.push(level * f[w]);
  outs.push(mean(ds.slice(-7)) * f[w]);

  return { value: mean(outs), methods: outs.length };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * Forecast of walk-in demand (cooked lb) for `date`. Baseline = non-event days
 * before `date`. Mean = average of up to 4 simple forecasts x event lift, then
 * shrunk toward usualGuess: mu = (n*mean + 3*guess)/(n+3), n = past same
 * weekdays. Sigma comes from a walk-forward backtest of the same simple
 * forecasts (without prior shrinkage): <1 miss -> 0.35*mean; 1..19 misses ->
 * 1.25*MAE; >=20 -> RMS. Floored at 0.08*mean and 1 lb.
 */
export function forecastDemand(a: {
  history: DayPoint[];
  date: string;
  usualGuess: number;
  eventType?: string | null;
}): Forecast {
  const target = dayNum(a.date);
  const past = a.history
    .map((p) => ({ ...p, day: dayNum(p.date) }))
    .filter((p) => p.day < target)
    .sort((x, y) => x.day - y.day);
  // Only the most recent MAX_BASE open days matter; the cap also bounds the O(n^2) backtest below.
  const base: Pt[] = past
    .filter((p) => !p.event)
    .map((p) => ({ day: p.day, y: p.demandLb }))
    .slice(-MAX_BASE);

  const sf = simpleForecast(base, target);
  const nSame = base.filter((p) => weekdayOf(p.day) === weekdayOf(target)).length;

  // Event lift: median ratio over up to 5 most recent same-tag events, damped toward 1.
  let lift = 1;
  if (a.eventType) {
    const evs = past.filter((p) => p.event === a.eventType).slice(-5);
    const ratios: number[] = [];
    const allMean = mean(base.map((p) => p.y));
    for (const e of evs) {
      const fc = simpleForecast(
        base.filter((p) => p.day < e.day),
        e.day,
      ).value;
      const ref = fc !== null && fc > 0 ? fc : allMean > 0 ? allMean : null;
      if (ref !== null) ratios.push(e.demandLb / ref);
    }
    if (ratios.length) {
      const n = ratios.length;
      lift = (n * median(ratios) + K_PRIOR) / (n + K_PRIOR);
    }
  }

  let mu: number;
  if (sf.value === null) mu = a.usualGuess;
  else mu = (nSame * sf.value * lift + K_PRIOR * a.usualGuess) / (nSame + K_PRIOR);

  // Walk-forward one-day-ahead misses.
  const misses: number[] = [];
  for (let i = Math.max(3, base.length - MAX_MISSES); i < base.length; i++) {
    const fc = simpleForecast(base.slice(0, i), base[i].day).value;
    if (fc !== null) misses.push(Math.abs(base[i].y - fc));
  }
  let sigma: number;
  if (misses.length < 1) sigma = 0.35 * mu;
  else if (misses.length < 20) sigma = 1.25 * mean(misses);
  else sigma = Math.sqrt(mean(misses.map((m) => m * m)));
  sigma = Math.max(sigma, 0.08 * mu, 1);

  return {
    mean: mu,
    sigma,
    nSameWeekday: nSame,
    methodsUsed: sf.methods,
    eventLift: lift,
    missesUsed: misses.length,
  };
}

// ---------------------------------------------------------------------
// Steps 3 and 4: economics and the newsvendor count
// ---------------------------------------------------------------------

/** Per-meat unit economics: Y, c, margin m, Cu, Co, cr. */
function econ(meat: Meat, settings: Settings) {
  const Y = meat.rawWeight * meat.yield;
  const c = meat.yield > 0 ? meat.rawCost / meat.yield : 0;
  const m = meat.price * (1 - settings.cardFee) - settings.packaging;
  const Cu = m - c;
  const Co = c - leftoverTerms(meat).v; // an outlet with cap 0 absorbs nothing, so it adds no value
  let cr = 0;
  if (Cu > 0 && Cu + Co > 0) cr = clamp(Cu / (Cu + Co), 0, 0.95);
  return { Y, c, m, Cu, Co, cr };
}

/** Effective leftover value per lb and cap (0 when no outlet). */
function leftoverTerms(meat: Meat) {
  const on = meat.leftoverValue > 0 && meat.leftoverCap > 0;
  return { v: on ? meat.leftoverValue : 0, cap: on ? meat.leftoverCap : 0 };
}

/**
 * Newsvendor cook count. Walk-in capacity for n pieces is K = max(nY - catering, 0).
 * nStar = smallest n with P(D <= nY - P) >= CR (CR capped at 0.95; Cu <= 0 gives 0).
 * Expected profit(n) = m*E[min(D,K)] + v*E[min(L,cap)] - c*K, L = max(K-D,0)
 * (catering revenue is a constant and omitted). bestN = argmax; good range =
 * contiguous counts around bestN within 3% of the best profit. The returned nStar is the
 * critical-ratio count clamped into that range, so the headline never contradicts it.
 */
export function chooseCount(a: {
  mean: number;
  sigma: number;
  meat: Meat;
  settings: Settings;
  cateringLb: number;
}): CountResult {
  const { meat, settings, cateringLb } = a;
  const { Y, c, m, Cu, Co, cr } = econ(meat, settings);
  const { v, cap } = leftoverTerms(meat);
  const d = nbDist(a.mean, a.sigma);
  const nMax = Y > 0 ? Math.ceil((Math.max(a.mean, 0) + 6 * Math.max(a.sigma, 0) + cateringLb) / Y) + 2 : 0;

  const S1 = firstMoments(d);
  const N = d.pmf.length;
  const cdfAt = (i: number) => (i < 0 ? 0 : i >= N ? 1 : d.cdf[i]);
  const s1At = (i: number) => (i < 0 ? 0 : S1[Math.min(i, N - 1)]);
  const table: CountRow[] = [];
  for (let n = 0; n <= nMax; n++) {
    const K = Math.max(n * Y - cateringLb, 0);
    const i = Math.floor(K * UNITS + 1e-9); // demand units <= i are fully served
    const expL = K * cdfAt(i) - s1At(i) / UNITS; // E[(K-D)+]
    let leftover = 0; // E[min((K-D)+, cap)]
    if (cap > 0) {
      const j = K >= cap ? Math.floor((K - cap) * UNITS + 1e-9) : -1; // units with leftover >= cap
      leftover = cap * cdfAt(j) + K * (cdfAt(i) - cdfAt(j)) - (s1At(i) - s1At(j)) / UNITS;
    }
    const expSold = (s1At(i) + K * UNITS * (1 - cdfAt(i))) / UNITS; // E[min(D,K)]
    table.push({
      n,
      profit: m * expSold + v * leftover - c * K,
      pSellOut: 1 - probLE(d, K),
      expLeftoverLb: Math.max(0, expL),
    });
  }

  let nStar = nMax;
  if (cr <= 0) nStar = 0;
  else {
    for (let n = 0; n <= nMax; n++) {
      if (probLE(d, n * Y - cateringLb) >= cr - 1e-12) {
        nStar = n;
        break;
      }
    }
  }

  let bestN = 0;
  for (const r of table) if (r.profit > table[bestN].profit + 1e-9) bestN = r.n;
  const best = table[bestN].profit;
  const thr = best - 0.03 * Math.abs(best);
  let rangeLo = bestN;
  let rangeHi = bestN;
  while (rangeLo > 0 && table[rangeLo - 1].profit >= thr) rangeLo--;
  while (rangeHi < nMax && table[rangeHi + 1].profit >= thr) rangeHi++;

  // The headline count is shown next to the good range, so it must sit inside it. The critical-ratio
  // count can fall outside when a leftover outlet's daily cap binds (the ratio assumes the outlet takes
  // every leftover lb) or when the range is only a piece or two wide. Clamp it to the nearest edge.
  nStar = Math.min(Math.max(nStar, rangeLo), rangeHi);

  return { Y, c, Cu, Co, cr, nStar, rangeLo, rangeHi, bestN, table };
}

/**
 * Smoker-full allocation. If the newsvendor counts fit, return them. Otherwise
 * fill the slots greedily by best expected-profit gain per slot (looking up to
 * LOOKAHEAD pieces ahead so a zero-marginal first piece, e.g. one covered by
 * catering, cannot stall a meat), then hill-climb over nearby mixes (add one
 * piece, or swap one piece of A for one of B) while total expected profit
 * improves. Meats without a result are ignored.
 */
const LOOKAHEAD = 8;
export function fitToSlots(
  results: Record<string, CountResult>,
  meats: Meat[],
  totalSlots: number,
): Record<string, number> {
  const ms = meats.filter((m) => results[m.id]);
  const need = sum(ms.map((m) => m.slots * results[m.id].nStar));
  const out: Record<string, number> = {};
  if (need <= totalSlots) {
    for (const m of ms) out[m.id] = results[m.id].nStar;
    return out;
  }
  for (const m of ms) out[m.id] = 0;
  let left = totalSlots;
  const prof = (m: Meat, n: number) => results[m.id].table[n].profit;
  for (;;) {
    let pick: Meat | null = null;
    let pickK = 1;
    let bestRate = 1e-12;
    for (const m of ms) {
      const t = results[m.id].table;
      const n = out[m.id];
      if (!(m.slots > 0)) continue;
      for (let k = 1; k <= LOOKAHEAD && n + k < t.length && k * m.slots <= left + 1e-9; k++) {
        const rate = (t[n + k].profit - t[n].profit) / (k * m.slots);
        if (rate > bestRate + 1e-12) {
          bestRate = rate;
          pick = m;
          pickK = k;
        }
      }
    }
    if (!pick) break;
    out[pick.id] += pickK;
    left -= pickK * pick.slots;
  }
  // Hill-climb: best single improving move among add-one and swap-one-for-one.
  for (let iter = 0; iter < 200; iter++) {
    let bestGain = 1e-9;
    let move: { up: Meat; down: Meat | null } | null = null;
    for (const up of ms) {
      const tu = results[up.id].table;
      if (!(up.slots > 0) || out[up.id] + 1 >= tu.length) continue;
      const gainUp = prof(up, out[up.id] + 1) - prof(up, out[up.id]);
      if (up.slots <= left + 1e-9 && gainUp > bestGain) {
        bestGain = gainUp;
        move = { up, down: null };
      }
      for (const down of ms) {
        if (down === up || out[down.id] < 1) continue;
        if (up.slots > left + down.slots + 1e-9) continue;
        const gain = gainUp + prof(down, out[down.id] - 1) - prof(down, out[down.id]);
        if (gain > bestGain) {
          bestGain = gain;
          move = { up, down };
        }
      }
    }
    if (!move) break;
    out[move.up.id] += 1;
    left -= move.up.slots;
    if (move.down) {
      out[move.down.id] -= 1;
      left += move.down.slots;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Step 5: cook clock
// ---------------------------------------------------------------------

const DEFAULT_SIGMA_T = 0.75;

/** Least squares line through (rawWeight, hours); flat at the mean if weights don't vary. */
function lsq(cooks: { rawWeight: number; hours: number }[]): (w: number) => number {
  const xm = mean(cooks.map((c) => c.rawWeight));
  const ym = mean(cooks.map((c) => c.hours));
  let sxx = 0;
  let sxy = 0;
  for (const c of cooks) {
    sxx += (c.rawWeight - xm) ** 2;
    sxy += (c.rawWeight - xm) * (c.hours - ym);
  }
  const b = sxx < 1e-9 ? 0 : sxy / sxx;
  return (w) => ym + b * (w - xm);
}

/** Fit blended with the owner's guess: (n*fit + 3*guess)/(n+3); constant guess if n < 2. */
const MIN_COOK_HOURS = 0.25;
function blendedT(cooks: { rawWeight: number; hours: number }[], guess: number): (w: number) => number {
  const n = cooks.length;
  if (n < 2) return () => guess;
  const fit = lsq(cooks);
  // Floored: two contradictory logged cooks (10 lb in 12 h, 12 lb in 4 h) make the straight line cross zero for a
  // heavy piece, and a negative cook time would schedule the put-on after the pull. (Z spec W5 / finding F10.)
  return (w) => Math.max(MIN_COOK_HOURS, (n * fit(w) + K_PRIOR * guess) / (n + K_PRIOR));
}

/**
 * Cook-time model T(W) = a + bW by least squares, pulled toward the owner's
 * guess while cooks are few. sigmaT = RMS of leave-one-out misses (each cook
 * predicted by the blended fit without it), min 0.25 h; default 0.75 h when n < 3.
 */
export function fitCookTime(
  cooks: { rawWeight: number; hours: number }[],
  guessHours: number,
): CookFit {
  const n = cooks.length;
  const T = blendedT(cooks, guessHours);
  let sigmaT = DEFAULT_SIGMA_T;
  if (n >= 3) {
    const sq = cooks.map((c, i) => {
      const rest = cooks.filter((_, j) => j !== i);
      return (c.hours - blendedT(rest, guessHours)(c.rawWeight)) ** 2;
    });
    sigmaT = Math.max(0.25, Math.sqrt(mean(sq)));
  }
  return { T, sigmaT, n };
}

/**
 * Put-on times working back from opening: open - R - T(W) - z*sigmaT hours,
 * as a local-time Date anchored on the service date's local opening time, so it
 * rolls into the previous day (and across DST changes) correctly. Sorted earliest
 * first (equal weights, so the order is moot). holdHours = R + z*sigmaT.
 */
export function planPutOn(a: {
  serviceDate: string;
  pieces: number;
  rawWeight: number;
  fit: CookFit;
  openHour: number;
  restHours: number;
  z: number;
}): PutOn[] {
  const [y, m, d] = a.serviceDate.split('-').map(Number);
  // Opening instant in local wall-clock time (correct on DST-change days), then step back in elapsed time.
  const openAt = new Date(y, m - 1, d, Math.floor(a.openHour), Math.round((a.openHour % 1) * 60), 0).getTime();
  const hold = a.restHours + a.z * a.fit.sigmaT;
  const putOnMs = openAt - (hold + a.fit.T(a.rawWeight)) * 3600000;
  const out: PutOn[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(a.pieces)); i++) {
    out.push({ putOnAt: new Date(putOnMs), rawWeight: a.rawWeight, holdHours: hold });
  }
  return out.sort((p, q) => p.putOnAt.getTime() - q.putOnAt.getTime());
}

// ---------------------------------------------------------------------
// Checking that it works
// ---------------------------------------------------------------------

/**
 * Realized profit for one meat on one day, given walk-in capacity (cooked lb
 * available after catering) and true walk-in demand:
 * m*min(D,K) + v*min(max(K-D,0), cap) - c*K (leftover term is 0 with no outlet).
 */
export function realizedProfit(a: {
  capacityLb: number;
  demandLb: number;
  meat: Meat;
  settings: Settings;
}): number {
  const { c, m } = econ(a.meat, a.settings);
  const { v, cap } = leftoverTerms(a.meat);
  const K = Math.max(a.capacityLb, 0);
  const D = a.demandLb;
  return m * Math.min(D, K) + v * Math.min(Math.max(K - D, 0), cap) - c * K;
}

/**
 * "Pitcall found you $X": profit(Pitcall's count) - profit(owner's count) at
 * the real demand D. If the meat did not sell out, D = walkInSoldLb exactly.
 * If it sold out, D is censored; assume the worst for Pitcall: D reached the
 * owner's capacity, D = max(walkInSoldLb, K_owner). Positive = Pitcall saved money.
 */
export function savedVsOwner(a: {
  ownerPieces: number;
  pitcallPieces: number;
  yPerPiece: number;
  cateringLb: number;
  walkInSoldLb: number;
  soldOut: boolean;
  meat: Meat;
  settings: Settings;
}): number {
  const Ko = Math.max(a.ownerPieces * a.yPerPiece - a.cateringLb, 0);
  const Kp = Math.max(a.pitcallPieces * a.yPerPiece - a.cateringLb, 0);
  const D = a.soldOut ? Math.max(a.walkInSoldLb, Ko) : a.walkInSoldLb;
  const { meat, settings } = a;
  return (
    realizedProfit({ capacityLb: Kp, demandLb: D, meat, settings }) -
    realizedProfit({ capacityLb: Ko, demandLb: D, meat, settings })
  );
}
