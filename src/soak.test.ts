// Soak test: 70-night simulated restaurants through the real planning pipeline (see src/sim.ts).
// Pins per-night invariants under hostile conditions, plus two aggregate guards that a future engine change must not break.
import { describe, expect, it } from 'vitest';
import { SEED_MEATS } from './logic';
import { BASE, runWorld, summarize, type Scenario } from './sim';

const HOSTILE: Scenario[] = [
  { ...BASE, label: 'base' },
  { ...BASE, label: 'guess far too high', guessError: 0.4 },
  { ...BASE, label: 'guess far too low', guessError: 2.5 },
  { ...BASE, label: 'freak nights', freakRate: 0.25 },
  { ...BASE, label: 'never taps 86', tapMissRate: 1 },
  { ...BASE, label: 'tight smoker', smokerSlots: 6 },
  { ...BASE, label: 'wild demand', cv: 1.0 },
];

describe('per-night invariants on simulated restaurants', () => {
  for (const sc of HOSTILE) {
    it(`holds: ${sc.label}`, () => {
      for (let r = 0; r < 4; r++) {
        const { nights } = runWorld(sc, 'pitcall', 77 + r * 101);
        expect(nights).toHaveLength(sc.nights);
        for (const night of nights) {
          let slots = 0;
          for (const x of night) {
            for (const v of [x.mean, x.sigma, x.cookedLb, x.demandLb, x.profit, x.leftoverLb]) expect(Number.isFinite(v)).toBe(true);
            expect(x.mean).toBeGreaterThanOrEqual(0);
            expect(x.sigma).toBeGreaterThanOrEqual(1); // forecastDemand floors sigma at 1 lb
            expect(Number.isInteger(x.pieces) && x.pieces >= 0).toBe(true);
            expect(x.rangeLo).toBeLessThanOrEqual(x.nStar);
            expect(x.nStar).toBeLessThanOrEqual(x.rangeHi);
            expect(x.leftoverLb).toBeGreaterThanOrEqual(-1e-9);
            slots += x.slotsUsed;
          }
          expect(slots).toBeLessThanOrEqual(sc.smokerSlots + 1e-9);
        }
      }
    }, 120000);
  }
  it('covers every seed meat each night', () => {
    const { nights } = runWorld({ ...BASE, nights: 3 }, 'pitcall', 5);
    for (const n of nights) expect(n.map((x) => x.meatId)).toEqual(SEED_MEATS.map((m) => m.id));
  });
});

describe('aggregate guards (30 simulated restaurants each, fixed seeds)', () => {
  it('against an owner who knows the average night, Pitcall is ahead once it has a month of history', () => {
    const s = summarize({ ...BASE, restaurants: 30 }, 9000);
    const late = s.windows[3];
    expect(late.mean).toBeGreaterThan(0);
    expect(late.ahead).toBeGreaterThanOrEqual(0.8);
  }, 300000);
  it('"Pitcall found you $X" never claims more than the simulated truth, even when 86 taps are forgotten', () => {
    for (const tapMissRate of [0.1, 0.6, 1]) {
      const s = summarize({ ...BASE, restaurants: 20, tapMissRate }, 31000 + tapMissRate * 1000);
      expect(s.claimedTotal).toBeLessThanOrEqual(s.trueTotal + 1e-6);
    }
  }, 300000);
});
