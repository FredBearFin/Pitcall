import { describe, expect, it } from 'vitest';
import {
  chooseCount,
  curveF,
  fitCookTime,
  fitToSlots,
  forecastDemand,
  nbDist,
  planPutOn,
  realizedProfit,
  recoverDemand,
  savedVsOwner,
} from './engine';
import type { DayPoint, Meat, Settings } from './types';

const brisket: Meat = {
  id: 'brisket',
  name: 'Brisket',
  rawCost: 5,
  price: 28,
  rawWeight: 14,
  yield: 0.55,
  slots: 2,
  leftoverValue: 6,
  leftoverCap: 1000,
  usualGuess: 60,
  cookHoursGuess: 12,
  sort: 0,
};
const settings: Settings = {
  smokerSlots: 20,
  cardFee: 0,
  packaging: 0,
  openHour: 11,
  closeHour: 20,
  restHours: 1,
  curve: 'lunch',
  onTimeZ: 1.28,
};

describe('chooseCount economics (spec worked example)', () => {
  it('matches Y, c, Cu, Co, cr', () => {
    const r = chooseCount({ mean: 60, sigma: 12, meat: brisket, settings, cateringLb: 0 });
    expect(r.Y).toBeCloseTo(7.7, 6);
    expect(r.c).toBeCloseTo(9.0909, 3);
    expect(r.Cu).toBeCloseTo(18.909, 2);
    expect(r.Co).toBeCloseTo(3.0909, 3);
    expect(r.cr).toBeCloseTo(0.8595, 3);
  });
  it('with leftoverValue 0, Co and cr change', () => {
    const r = chooseCount({ mean: 60, sigma: 12, meat: { ...brisket, leftoverValue: 0 }, settings, cateringLb: 0 });
    expect(r.Co).toBeCloseTo(9.0909, 3);
    expect(r.cr).toBeCloseTo(0.675, 3);
  });
  it('caps cr at 0.95 and gives nStar 0 when Cu <= 0', () => {
    const cheap = chooseCount({ mean: 60, sigma: 12, meat: { ...brisket, leftoverValue: 9.05 }, settings, cateringLb: 0 });
    expect(cheap.cr).toBe(0.95);
    const loss = chooseCount({ mean: 60, sigma: 12, meat: { ...brisket, price: 5 }, settings, cateringLb: 0 });
    expect(loss.cr).toBe(0);
    expect(loss.nStar).toBe(0);
  });
});

describe('chooseCount counts', () => {
  it('v=6: nStar 10, good range includes 9 and 10', () => {
    const r = chooseCount({ mean: 60, sigma: 12, meat: brisket, settings, cateringLb: 0 });
    expect(r.nStar).toBe(10);
    expect(r.rangeLo).toBeLessThanOrEqual(9);
    expect(r.rangeHi).toBeGreaterThanOrEqual(10);
    expect(Math.abs(r.bestN - r.nStar)).toBeLessThanOrEqual(1);
    expect(r.table[3].n).toBe(3);
  });
  it('v=0: nStar 9, bestN 8 or 9', () => {
    const r = chooseCount({ mean: 60, sigma: 12, meat: { ...brisket, leftoverValue: 0 }, settings, cateringLb: 0 });
    expect(r.nStar).toBe(9);
    expect([8, 9]).toContain(r.bestN);
    // sell-out probability falls and leftovers grow with n
    expect(r.table[9].pSellOut).toBeLessThan(r.table[8].pSellOut);
    expect(r.table[9].expLeftoverLb).toBeGreaterThan(r.table[8].expLeftoverLb);
  });
  it('catering lowers walk-in capacity so more pieces are needed', () => {
    const a = chooseCount({ mean: 60, sigma: 12, meat: brisket, settings, cateringLb: 0 });
    const b = chooseCount({ mean: 60, sigma: 12, meat: brisket, settings, cateringLb: 30 });
    expect(b.nStar).toBeGreaterThan(a.nStar);
  });
  it('zero demand cooks nothing', () => {
    const r = chooseCount({ mean: 0, sigma: 0, meat: brisket, settings, cateringLb: 0 });
    expect(r.nStar).toBe(0);
  });
});

describe('negative binomial', () => {
  it('pmf sums to 1 and mean matches', () => {
    const d = nbDist(60, 12);
    const s = d.pmf.reduce((a, b) => a + b, 0);
    const m = d.pmf.reduce((a, p, k) => a + p * k, 0) / 4;
    expect(s).toBeCloseTo(1, 9);
    expect(m).toBeCloseTo(60, 0);
  });
  it('spread roughly matches sigma and survives large means', () => {
    const d = nbDist(600, 40);
    const m = d.pmf.reduce((a, p, k) => a + p * k, 0) / 4;
    const v = d.pmf.reduce((a, p, k) => a + p * (k / 4 - m) ** 2, 0);
    expect(m).toBeCloseTo(600, 0);
    expect(Math.sqrt(v)).toBeCloseTo(40, 0);
  });
  it('tiny sigma is forced to a finite Poisson-like variance', () => {
    const d = nbDist(50, 0);
    expect(d.pmf.every(Number.isFinite)).toBe(true);
  });
});

describe('recoverDemand and curves', () => {
  it('no sell-out is exact', () => {
    expect(recoverDemand({ soldLb: 40, soldOutAt: null, F: curveF('steady', 11, 20), mean: 60, sigma: 12 })).toEqual({
      demandLb: 40,
      method: 'exact',
    });
  });
  it('scales by F: 48 lb at F=0.55 is about 87.3', () => {
    const r = recoverDemand({ soldLb: 48, soldOutAt: 13.25, F: () => 0.55, mean: 60, sigma: 12 });
    expect(r.method).toBe('scaled');
    expect(r.demandLb).toBeCloseTo(87.27, 1);
  });
  it('early sell-out uses atLeast and is >= sold', () => {
    const r = recoverDemand({ soldLb: 40, soldOutAt: 11.5, F: () => 0.1, mean: 60, sigma: 12 });
    expect(r.method).toBe('atLeast');
    expect(r.demandLb).toBeGreaterThanOrEqual(40);
    const far = recoverDemand({ soldLb: 90, soldOutAt: 11.5, F: () => 0.1, mean: 60, sigma: 12 });
    expect(far.demandLb).toBeGreaterThanOrEqual(90);
  });
  it('curves are monotone from 0 to 1', () => {
    for (const k of ['steady', 'lunch', 'morning'] as const) {
      const F = curveF(k, 11, 20);
      expect(F(10)).toBe(0);
      expect(F(20)).toBeCloseTo(1, 9);
      expect(F(15)).toBeGreaterThanOrEqual(F(13));
    }
    // spec example: lunch-heavy day, 11-to-8, 55% of demand in by 1:15 pm
    expect(curveF('lunch', 11, 20)(13.25)).toBeCloseTo(0.55, 2);
    expect(curveF('morning', 11, 20)(13.25)).toBeGreaterThan(curveF('lunch', 11, 20)(13.25));
  });
  it('halfGoneMedian pins F(median)=0.5', () => {
    expect(curveF('steady', 11, 20, 13)(13)).toBeCloseTo(0.5, 9);
  });
});

/** Build n consecutive days ending the day before `end` (UTC arithmetic). */
function days(end: string, n: number, f: (date: string, wd: number) => number): DayPoint[] {
  const [y, m, d] = end.split('-').map(Number);
  const out: DayPoint[] = [];
  for (let i = n; i >= 1; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d - i));
    out.push({ date: dt.toISOString().slice(0, 10), demandLb: f(dt.toISOString().slice(0, 10), dt.getUTCDay()) });
  }
  return out;
}

describe('forecastDemand', () => {
  it('zero history returns the usual guess with a wide sigma', () => {
    const f = forecastDemand({ history: [], date: '2026-10-17', usualGuess: 55 });
    expect(f.mean).toBe(55);
    expect(f.methodsUsed).toBe(0);
    expect(f.sigma).toBeCloseTo(0.35 * 55, 6);
  });
  it('learns a weekly pattern (2026-10-17 is a Saturday)', () => {
    const hist = days('2026-10-17', 56, (_d, wd) => (wd === 6 ? 100 : 40));
    const sat = forecastDemand({ history: hist, date: '2026-10-17', usualGuess: 70 });
    const tue = forecastDemand({ history: hist, date: '2026-10-20', usualGuess: 70 });
    // damped weekday factors + prior shrinkage (guess 70) pull the raw 100 down a little
    expect(sat.mean).toBeGreaterThan(82);
    expect(sat.mean).toBeLessThan(105);
    expect(sat.mean / tue.mean).toBeGreaterThan(1.6);
    expect(tue.mean).toBeGreaterThan(38);
    expect(tue.mean).toBeLessThan(50);
    expect(sat.nSameWeekday).toBe(8);
  });
  describe('the typed usual-night guess is level-corrected after a full week (simulation finding: a bad guess lingered for months)', () => {
    it('under 7 nights of history the guess anchors exactly as before', () => {
      const six = days('2026-10-17', 6, () => 30); // Sat 10-17 not yet seen: nSame = 0, so the forecast IS the prior
      expect(forecastDemand({ history: six, date: '2026-10-17', usualGuess: 90 }).mean).toBe(90);
    });
    it('a guess 3x too high is pulled down toward what the nights show, far below the old fixed-weight answer', () => {
      const hist = days('2026-10-17', 28, () => 30);
      const f = forecastDemand({ history: hist, date: '2026-10-17', usualGuess: 90 });
      // old formula: (4*30 + 3*90)/7 = 55.7. level-corrected: level = (28*30 + 3*90)/31 = 35.8 -> (4*30 + 3*35.8)/7 = 32.5
      expect(f.mean).toBeGreaterThan(30);
      expect(f.mean).toBeLessThan(36);
    });
    it('a guess 3x too low is pulled up the same way', () => {
      const hist = days('2026-10-17', 28, () => 90);
      const f = forecastDemand({ history: hist, date: '2026-10-17', usualGuess: 30 });
      expect(f.mean).toBeGreaterThan(80); // old formula gave (4*90 + 3*30)/7 = 64.3
      expect(f.mean).toBeLessThan(90);
    });
    it('a right guess is left alone', () => {
      const hist = days('2026-10-17', 28, () => 50);
      expect(forecastDemand({ history: hist, date: '2026-10-17', usualGuess: 50 }).mean).toBeCloseTo(50, 6);
    });
    it('a weekday that is genuinely busier still comes out busier (the level fix does not flatten the week)', () => {
      const hist = days('2026-10-17', 56, (_d, wd) => (wd === 6 ? 100 : 40));
      const sat = forecastDemand({ history: hist, date: '2026-10-17', usualGuess: 90 });
      const tue = forecastDemand({ history: hist, date: '2026-10-20', usualGuess: 90 });
      expect(sat.mean / tue.mean).toBeGreaterThan(1.8);
    });
  });
  it('sigma sits at its floor for constant data and is bigger for noisy data', () => {
    const flat = days('2026-10-17', 40, () => 50);
    const f = forecastDemand({ history: flat, date: '2026-10-17', usualGuess: 50 });
    expect(f.mean).toBeCloseTo(50, 6);
    expect(f.sigma).toBeCloseTo(0.08 * 50, 6);
    expect(f.missesUsed).toBe(37);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const noisy = days('2026-10-17', 40, () => 50 + (rnd() - 0.5) * 40);
    const g = forecastDemand({ history: noisy, date: '2026-10-17', usualGuess: 50 });
    expect(g.sigma).toBeGreaterThan(f.sigma * 2);
  });
  it('event days are excluded from the baseline and drive a lift', () => {
    const hist = days('2026-10-17', 56, (_d, _wd) => 50);
    // make three past Saturdays home games at double demand
    let k = 0;
    for (const p of hist) {
      if (new Date(p.date + 'T00:00:00Z').getUTCDay() === 6 && k < 3) {
        p.event = 'home game';
        p.demandLb = 100;
        k++;
      }
    }
    const plain = forecastDemand({ history: hist, date: '2026-10-17', usualGuess: 50 });
    expect(plain.mean).toBeCloseTo(50, 1);
    expect(plain.eventLift).toBe(1);
    const ev = forecastDemand({ history: hist, date: '2026-10-17', usualGuess: 50, eventType: 'home game' });
    expect(ev.eventLift).toBeGreaterThan(1.4);
    expect(ev.eventLift).toBeLessThan(2);
    // shrinkage toward the guess (50) keeps the mean below mean*lift
    expect(ev.mean).toBeGreaterThan(plain.mean * 1.2);
  });
  it('is not thrown by future-dated rows', () => {
    const hist = [...days('2026-10-17', 20, () => 50), { date: '2026-12-01', demandLb: 9999 }];
    const f = forecastDemand({ history: hist, date: '2026-10-17', usualGuess: 50 });
    expect(f.mean).toBeLessThan(100);
  });
});

describe('fitToSlots', () => {
  const ribs: Meat = { ...brisket, id: 'ribs', rawWeight: 4, yield: 0.6, price: 24, rawCost: 4, slots: 1, leftoverValue: 0 };
  const meats = [brisket, ribs];
  const results = {
    brisket: chooseCount({ mean: 60, sigma: 12, meat: brisket, settings, cateringLb: 0 }),
    ribs: chooseCount({ mean: 30, sigma: 8, meat: ribs, settings, cateringLb: 0 }),
  };
  it('returns nStar when it fits', () => {
    const r = fitToSlots(results, meats, 1000);
    expect(r.brisket).toBe(results.brisket.nStar);
    expect(r.ribs).toBe(results.ribs.nStar);
  });
  it('respects totalSlots when squeezed and fills them', () => {
    const total = 15;
    const r = fitToSlots(results, meats, total);
    const used = r.brisket * brisket.slots + r.ribs * ribs.slots;
    expect(used).toBeLessThanOrEqual(total);
    expect(used).toBeGreaterThanOrEqual(total - 1);
    expect(r.brisket).toBeLessThanOrEqual(results.brisket.nStar);
    expect(r.ribs).toBeLessThanOrEqual(results.ribs.nStar);
  });
  it('ignores meats with no result', () => {
    const r = fitToSlots({ brisket: results.brisket }, meats, 100);
    expect(Object.keys(r)).toEqual(['brisket']);
  });
});

describe('fitCookTime and planPutOn', () => {
  const line = (w: number) => 4 + 0.6 * w;
  it('recovers a known line with many cooks', () => {
    const cooks = Array.from({ length: 60 }, (_, i) => {
      const w = 8 + (i % 11);
      return { rawWeight: w, hours: line(w) };
    });
    const fit = fitCookTime(cooks, line(14));
    expect(fit.n).toBe(60);
    expect(Math.abs(fit.T(10) - line(10))).toBeLessThan(0.2);
    expect(Math.abs(fit.T(18) - line(18))).toBeLessThan(0.2);
    expect(fit.sigmaT).toBe(0.25); // noiseless: floor (blend bias is small)
  });
  it('slope survives: heavier takes longer', () => {
    const cooks = [8, 10, 12, 14, 16].map((w) => ({ rawWeight: w, hours: line(w) }));
    const fit = fitCookTime(cooks, 12);
    expect(fit.T(16)).toBeGreaterThan(fit.T(8));
  });
  it('n<2 uses the guess; n<3 uses default sigma; identical weights do not blow up', () => {
    const f0 = fitCookTime([], 11);
    expect(f0.T(20)).toBe(11);
    expect(f0.sigmaT).toBe(0.75);
    const f1 = fitCookTime([{ rawWeight: 14, hours: 13 }], 11);
    expect(f1.T(14)).toBe(11);
    const f2 = fitCookTime(
      [
        { rawWeight: 14, hours: 12 },
        { rawWeight: 14, hours: 14 },
      ],
      10,
    );
    expect(f2.sigmaT).toBe(0.75);
    expect(f2.T(14)).toBeCloseTo((2 * 13 + 3 * 10) / 5, 9);
    const f3 = fitCookTime(
      [12, 14, 13].map((h) => ({ rawWeight: 14, hours: h })),
      10,
    );
    expect(Number.isFinite(f3.T(30))).toBe(true);
    expect(Number.isFinite(f3.sigmaT)).toBe(true);
  });
  it('plans put-on across midnight', () => {
    const fit = fitCookTime([], 12); // T = 12, sigmaT 0.75
    const [p] = planPutOn({ serviceDate: '2026-10-17', pieces: 1, rawWeight: 14, fit, openHour: 11, restHours: 1, z: 0 });
    expect(p.putOnAt.getDate()).toBe(16);
    expect(p.putOnAt.getHours()).toBe(22);
    expect(p.holdHours).toBe(1);
    const [q] = planPutOn({ serviceDate: '2026-10-17', pieces: 1, rawWeight: 14, fit, openHour: 11, restHours: 1, z: 1.28 });
    expect(q.holdHours).toBeCloseTo(1 + 1.28 * 0.75, 9);
    expect(q.putOnAt.getTime()).toBeLessThan(p.putOnAt.getTime());
  });
  it('returns one entry per piece and none for zero', () => {
    const fit = fitCookTime([], 12);
    const base = { serviceDate: '2026-10-17', rawWeight: 14, fit, openHour: 11, restHours: 1, z: 1.28 };
    expect(planPutOn({ ...base, pieces: 3 })).toHaveLength(3);
    expect(planPutOn({ ...base, pieces: 0 })).toHaveLength(0);
  });
});

describe('realizedProfit and savedVsOwner', () => {
  const base = { yPerPiece: 7.7, cateringLb: 0, meat: brisket, settings };
  it('realized profit: sells out vs leftovers', () => {
    const c = 5 / 0.55;
    expect(realizedProfit({ capacityLb: 50, demandLb: 80, meat: brisket, settings })).toBeCloseTo(50 * (28 - c), 6);
    expect(realizedProfit({ capacityLb: 50, demandLb: 30, meat: brisket, settings })).toBeCloseTo(30 * 28 + 20 * 6 - 50 * c, 6);
  });
  it('is zero when owner and Pitcall agree', () => {
    expect(savedVsOwner({ ...base, ownerPieces: 8, pitcallPieces: 8, walkInSoldLb: 40, soldOut: false })).toBe(0);
    expect(savedVsOwner({ ...base, ownerPieces: 8, pitcallPieces: 8, walkInSoldLb: 61, soldOut: true })).toBe(0);
  });
  it('positive when Pitcall cooked fewer and demand was low', () => {
    const s = savedVsOwner({ ...base, ownerPieces: 10, pitcallPieces: 7, walkInSoldLb: 40, soldOut: false });
    expect(s).toBeGreaterThan(0);
  });
  it('negative when Pitcall cooked fewer and demand was high (not sold out for owner capacity)', () => {
    const s = savedVsOwner({ ...base, ownerPieces: 10, pitcallPieces: 7, walkInSoldLb: 70, soldOut: false });
    expect(s).toBeLessThan(0);
  });
  it('sold-out censoring assumes D >= owner capacity (worst for Pitcall)', () => {
    const s = savedVsOwner({ ...base, ownerPieces: 10, pitcallPieces: 7, walkInSoldLb: 40, soldOut: true });
    expect(s).toBeLessThan(0);
    const manual =
      realizedProfit({ capacityLb: 7 * 7.7, demandLb: 77, meat: brisket, settings }) -
      realizedProfit({ capacityLb: 77, demandLb: 77, meat: brisket, settings });
    expect(s).toBeCloseTo(manual, 9);
  });
  it('catering reduces capacity and clamps at zero', () => {
    const s = savedVsOwner({ ...base, cateringLb: 100, ownerPieces: 3, pitcallPieces: 5, walkInSoldLb: 0, soldOut: false });
    expect(s).toBeCloseTo(0, 9); // both capacities clamp to 0 walk-in lb
  });
});

// ---------------------------------------------------------------------
// Regression tests added by review
// ---------------------------------------------------------------------
describe('review regressions: engine', () => {
  it('count table matches a brute-force sum over the NB pmf (finite cap, catering)', () => {
    const meat: Meat = { ...brisket, leftoverValue: 6, leftoverCap: 3.3 };
    for (const cat of [0, 25]) {
      const r = chooseCount({ mean: 60, sigma: 12, meat, settings, cateringLb: cat });
      const d = nbDist(60, 12);
      const Y = 7.7;
      const c = 5 / 0.55;
      for (const n of [0, 5, 9, 10, 14]) {
        const K = Math.max(n * Y - cat, 0);
        let e = 0;
        let sell = 0;
        d.pmf.forEach((p, k) => {
          const D = k / 4;
          e += p * (28 * Math.min(D, K) + 6 * Math.min(Math.max(K - D, 0), 3.3) - c * K);
          if (D > K) sell += p;
        });
        expect(r.table[n].profit).toBeCloseTo(e, 3);
        expect(r.table[n].pSellOut).toBeCloseTo(sell, 6);
      }
    }
  });
  it('huge usual guess stays fast and finite; NaN sigma does not poison the pmf', () => {
    const t = Date.now();
    const r = chooseCount({ mean: 10000, sigma: 2500, meat: brisket, settings, cateringLb: 0 });
    expect(Date.now() - t).toBeLessThan(1500);
    expect(Number.isFinite(r.nStar)).toBe(true);
    expect(nbDist(50, NaN).pmf.every(Number.isFinite)).toBe(true);
  });
  it('forecast on 20000 days of history is bounded (was ~20 s, froze the UI)', () => {
    const history: DayPoint[] = Array.from({ length: 20000 }, (_, i) => ({
      date: new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10),
      demandLb: 50 + ((i * 7) % 30),
    }));
    const t = Date.now();
    const f = forecastDemand({ history, date: '2060-01-01', usualGuess: 60 });
    expect(Date.now() - t).toBeLessThan(2000);
    expect(Number.isFinite(f.mean) && Number.isFinite(f.sigma)).toBe(true);
  });
  it('leftover value with a zero cap is treated as no outlet in Co and cr', () => {
    const r = chooseCount({ mean: 60, sigma: 12, meat: { ...brisket, leftoverValue: 6, leftoverCap: 0 }, settings, cateringLb: 0 });
    expect(r.Co).toBeCloseTo(9.0909, 3);
    expect(r.cr).toBeCloseTo(0.675, 3);
  });
  it('fitToSlots: a piece fully covered by catering does not stall that meat', () => {
    const smallSettings = { ...settings, smokerSlots: 4 };
    const res = {
      brisket: chooseCount({ mean: 60, sigma: 12, meat: { ...brisket, slots: 1 }, settings: smallSettings, cateringLb: 20 }),
    };
    const out = fitToSlots(res, [{ ...brisket, slots: 1 }], 4);
    // 20 lb catering swallows the first two pieces (7.7 lb each): zero marginal walk-in profit until piece 3.
    expect(out.brisket).toBe(4);
  });
  it('fitToSlots: hill-climbing never does worse than the greedy fill', () => {
    const meatA: Meat = { ...brisket, id: 'a', slots: 3 };
    const meatB: Meat = { ...brisket, id: 'b', slots: 2, rawWeight: 8, price: 20, usualGuess: 40 };
    const res = {
      a: chooseCount({ mean: 60, sigma: 12, meat: meatA, settings, cateringLb: 0 }),
      b: chooseCount({ mean: 40, sigma: 10, meat: meatB, settings, cateringLb: 0 }),
    };
    const total = (o: Record<string, number>) => res.a.table[o.a].profit + res.b.table[o.b].profit;
    const out = fitToSlots(res, [meatA, meatB], 9);
    expect(out.a * 3 + out.b * 2).toBeLessThanOrEqual(9);
    // exhaustive optimum over all feasible mixes
    let best = -Infinity;
    for (let a = 0; a * 3 <= 9; a++) for (let b = 0; a * 3 + b * 2 <= 9; b++) best = Math.max(best, total({ a, b }));
    expect(total(out)).toBeGreaterThanOrEqual(best - 0.05 * Math.abs(best));
  });
  it('put-on time is anchored to local opening time even on a DST-change day', () => {
    const old = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    try {
      const fit = fitCookTime([], 10);
      const [p] = planPutOn({ serviceDate: '2026-11-01', pieces: 1, rawWeight: 14, fit, openHour: 11, restHours: 1, z: 1.28 });
      const openAt = new Date(2026, 10, 1, 11, 0, 0).getTime();
      const expected = openAt - (1 + 1.28 * fit.sigmaT + 10) * 3600000;
      expect(p.putOnAt.getTime()).toBe(expected);
    } finally {
      if (old === undefined) delete process.env.TZ;
      else process.env.TZ = old;
    }
  });
});
