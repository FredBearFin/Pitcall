// Close-out rules, tested as pure functions. Pins Z findings F7 (over-supply with a blank leftover), F7b (a blank leftover is
// never saved as 0) and F8 (an 86 that contradicts a big leftover must not inflate demand).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, MAX_LB, SEED_MEATS, buildHistory, closeCheck, leftoverDraftText, ranOut, soldOutContradictionLb, trustedSoldOutAt, weekSummary,
} from './logic';
import type { PlanRecord, SaleRecord } from './types';

type In = Parameters<typeof closeCheck>[0];
const base: In = {
  name: 'Brisket', hasPlan: true, hasRow: false, cookedText: '', cooked: 70, leftoverText: '10', cateringText: '0', soldOutAt: null,
};
const chk = (o: Partial<In>) => closeCheck({ ...base, ...o });
const err = (o: Partial<In>) => {
  const r = chk(o);
  if (r.kind !== 'error') throw new Error(`expected error, got ${JSON.stringify(r)}`);
  return r.error;
};

describe('skip: nothing to record', () => {
  it('no plan, no saved row and nothing typed is skipped, whatever the other boxes hold', () => {
    expect(chk({ hasPlan: false, hasRow: false, cookedText: '', cooked: null, leftoverText: '', cateringText: '0' })).toEqual({ kind: 'skip' });
  });
  it('no plan but a saved row is not skipped', () => {
    expect(chk({ hasPlan: false, hasRow: true, cookedText: '40', cooked: 40, leftoverText: '3' }).kind).toBe('ok');
  });
});

describe('F7b: a blank leftover is never saved as 0', () => {
  it('blank leftover with a plan is refused and tells the cook what to do', () => {
    expect(err({ leftoverText: '' })).toMatch(/enter the leftover.*None left/);
    expect(err({ leftoverText: '   ' })).toMatch(/enter the leftover/);
  });
  it('blank leftover with a typed cooked weight and no plan is refused', () => {
    expect(err({ hasPlan: false, cookedText: '50', cooked: 50, leftoverText: '' })).toMatch(/enter the leftover/);
  });
  it('an explicit 0 is accepted (that is what the "None left" button types)', () => {
    expect(chk({ leftoverText: '0' })).toEqual({ kind: 'ok', leftover: 0, catering: 0, warning: null });
  });
  it('a planned meat that cooked nothing (0 pieces) does not need a leftover answer', () => {
    expect(chk({ cooked: 0, leftoverText: '' })).toEqual({ kind: 'ok', leftover: 0, catering: 0, warning: null });
  });
});

describe('F7: over-supply is caught even when the leftover is blank', () => {
  it('catering alone larger than what was cooked is refused', () => {
    expect(err({ cooked: 0, leftoverText: '', cateringText: '50' })).toMatch(/more than the 0 lb cooked/);
  });
  it('leftover + catering over the cooked weight is refused, exactly at the edge it is accepted', () => {
    expect(err({ leftoverText: '40', cateringText: '31' })).toMatch(/more than the 70 lb cooked/);
    expect(chk({ leftoverText: '40', cateringText: '30' }).kind).toBe('ok');
  });
});

describe('numbers must be plain, finite and in range', () => {
  it.each(['-1', 'abc', '1e3', 'NaN', 'Infinity', '1,2,3', '--5'])('"%s" is not accepted as a leftover', (bad) => {
    expect(chk({ leftoverText: bad }).kind).toBe('error');
  });
  it('catering is held to the same rule', () => {
    expect(chk({ cateringText: '-3' }).kind).toBe('error');
    expect(chk({ cateringText: 'x' }).kind).toBe('error');
  });
  it('an unparseable cooked weight is an error', () => {
    expect(err({ cooked: null })).toMatch(/plain numbers/);
  });
  it('absurd weights are refused so no saved row can fail to export', () => {
    expect(err({ cooked: MAX_LB + 1, leftoverText: '1' })).toMatch(/too big/);
    expect(err({ leftoverText: '1000000000000' })).toMatch(/too big/);
    expect(chk({ cooked: MAX_LB, leftoverText: String(MAX_LB) }).kind).toBe('ok');
  });
  it('a comma-decimal keyboard works', () => {
    expect(chk({ leftoverText: '2,5' })).toMatchObject({ kind: 'ok', leftover: 2.5 });
  });
});

describe('F8: the contradiction threshold', () => {
  it('is 15% of the cooked weight, but never less than 5 lb', () => {
    expect(soldOutContradictionLb(100)).toBe(15);
    expect(soldOutContradictionLb(20)).toBe(5);
    expect(soldOutContradictionLb(0)).toBe(5);
  });
  it('a sold-out meat with a big leftover saves, but with a warning', () => {
    const r = chk({ cooked: 60, leftoverText: '20', soldOutAt: 12 });
    expect(r).toMatchObject({ kind: 'ok', leftover: 20 });
    expect(r.kind === 'ok' && r.warning).toMatch(/tapped 86 but 20 lb is left/);
  });
  it('a small remainder after an 86 is normal and does not warn', () => {
    expect(chk({ cooked: 60, leftoverText: '8', soldOutAt: 12 })).toMatchObject({ kind: 'ok', warning: null });
    expect(chk({ cooked: 20, leftoverText: '4', soldOutAt: 12 })).toMatchObject({ kind: 'ok', warning: null }); // 20% but under the 5 lb floor
    expect(chk({ cooked: 20, leftoverText: '5', soldOutAt: 12 })).toMatchObject({ kind: 'ok', warning: null });
    expect(chk({ cooked: 20, leftoverText: '5.1', soldOutAt: 12 }).kind === 'ok').toBe(true);
    const r = chk({ cooked: 20, leftoverText: '5.1', soldOutAt: 12 });
    expect(r.kind === 'ok' && r.warning).toBeTruthy();
  });
  it('without an 86 a big leftover is just a slow night: no warning', () => {
    expect(chk({ cooked: 60, leftoverText: '40', soldOutAt: null })).toMatchObject({ kind: 'ok', warning: null });
  });
});

const brisket = SEED_MEATS[0];
const row = (o: Partial<SaleRecord>): SaleRecord => ({
  date: '2026-10-10', meatId: brisket.id, cookedLb: 60, leftoverLb: 0, cateringLb: 0, soldOutAt: null, halfGoneAt: null, leftoverUse: null, closed: true, ...o,
});
const hist = (sales: SaleRecord[]) => buildHistory({ meat: brisket, settings: DEFAULT_SETTINGS, sales, plans: [], beforeDate: '2026-10-30' });

describe('F8: the forecast does not learn a false sell-out', () => {
  it('trustedSoldOutAt drops an 86 that the leftover contradicts and keeps a consistent one', () => {
    expect(trustedSoldOutAt(row({ soldOutAt: 12, leftoverLb: 20 }))).toBeNull();
    expect(trustedSoldOutAt(row({ soldOutAt: 12, leftoverLb: 0 }))).toBe(12);
    expect(trustedSoldOutAt(row({ soldOutAt: 12, leftoverLb: 6 }))).toBe(12);
    expect(trustedSoldOutAt(row({ soldOutAt: null, leftoverLb: 20 }))).toBeNull();
  });
  it('the measured case: 86 at noon with 20 of 60 lb left used to read as 142 lb of demand; now it is the 40 lb that sold', () => {
    const contradiction = hist([row({ soldOutAt: 12, leftoverLb: 20 })]);
    const honest = hist([row({ soldOutAt: null, leftoverLb: 20 })]);
    expect(honest[0].demandLb).toBe(40);
    expect(contradiction[0].demandLb).toBe(40);
  });
  it('a genuine sell-out still recovers demand above what was sold', () => {
    const real = hist([row({ soldOutAt: 14, leftoverLb: 0 })]);
    expect(real[0].demandLb).toBeGreaterThan(60);
  });
  it('the week summary does not count a contradicted 86 as a sell-out', () => {
    const plan: PlanRecord = {
      date: '2026-10-16', meatId: brisket.id, ownerPieces: 4, pitcallPieces: 6, rangeLo: 5, rangeHi: 7, finalPieces: 6, mean: 50, sigma: 10, cr: 0.8,
      cateringLb: 0, yPerPiece: 7.7, accepted: true,
    };
    const args = { today: '2026-10-17', meats: SEED_MEATS, settings: DEFAULT_SETTINGS, plans: [plan] };
    const bad = weekSummary({ ...args, sales: [row({ date: '2026-10-16', soldOutAt: 12, leftoverLb: 20 })] });
    expect(bad.soldOutByMeat[0]).toMatchObject({ times: 0, days: 1 });
    const good = weekSummary({ ...args, sales: [row({ date: '2026-10-16', soldOutAt: 12, leftoverLb: 0 })] });
    expect(good.soldOutByMeat[0]).toMatchObject({ times: 1, days: 1 });
  });
});

describe('ranOut: a forgotten 86 does not hide a sell-out from the "Pitcall found you" claim', () => {
  it('a trusted 86 counts', () => {
    expect(ranOut(row({ soldOutAt: 12, leftoverLb: 3 }))).toBe(true);
  });
  it('no 86 but nothing left counts as sold out', () => {
    expect(ranOut(row({ soldOutAt: null, leftoverLb: 0 }))).toBe(true);
    expect(ranOut(row({ soldOutAt: null, leftoverLb: 1.2 }))).toBe(true); // exactly 2% of the default 60 lb
    expect(ranOut(row({ soldOutAt: null, cookedLb: 10, leftoverLb: 0.5 }))).toBe(true); // the 0.5 lb floor beats 2% of 10
    expect(ranOut(row({ soldOutAt: null, cookedLb: 100, leftoverLb: 2 }))).toBe(true); // exactly 2%
  });
  it('no 86 and a real remainder does not', () => {
    expect(ranOut(row({ soldOutAt: null, leftoverLb: 1.3 }))).toBe(false);
    expect(ranOut(row({ soldOutAt: null, cookedLb: 10, leftoverLb: 0.6 }))).toBe(false);
    expect(ranOut(row({ soldOutAt: null, cookedLb: 100, leftoverLb: 2.1 }))).toBe(false);
    expect(ranOut(row({ soldOutAt: null, leftoverLb: 20 }))).toBe(false);
  });
  it('a contradicted 86 (big leftover) does not count', () => {
    expect(ranOut(row({ soldOutAt: 12, leftoverLb: 20 }))).toBe(false);
  });
  it('a night that was never closed, or cooked nothing, is not a sell-out', () => {
    expect(ranOut(row({ soldOutAt: null, leftoverLb: 0, closed: false }))).toBe(false);
    expect(ranOut(row({ soldOutAt: null, cookedLb: 0, leftoverLb: 0 }))).toBe(false);
  });
  it('the week claim is smaller (never larger) when a sell-out went untapped', () => {
    const plan: PlanRecord = {
      date: '2026-10-16', meatId: brisket.id, ownerPieces: 9, pitcallPieces: 6, rangeLo: 5, rangeHi: 7, finalPieces: 6, mean: 50, sigma: 10, cr: 0.66,
      cateringLb: 0, yPerPiece: 7.7, accepted: true,
    };
    const args = { today: '2026-10-17', meats: SEED_MEATS, settings: DEFAULT_SETTINGS, plans: [plan] };
    // Pitcall cooked 6 (46.2 lb) and sold every pound; the owner would have cooked 9 (69.3 lb). Without the rescue the app
    // would read demand as exactly 46.2 and claim the owner wasted 23 lb; with it, demand is at least the owner's capacity.
    const forgot = weekSummary({ ...args, sales: [row({ date: '2026-10-16', cookedLb: 46.2, leftoverLb: 0, soldOutAt: null })] });
    const tapped = weekSummary({ ...args, sales: [row({ date: '2026-10-16', cookedLb: 46.2, leftoverLb: 0, soldOutAt: 14 })] });
    expect(forgot.savedTotal).toBeCloseTo(tapped.savedTotal, 6);
    expect(forgot.savedTotal).toBeLessThan(0.01 + 0); // Pitcall under-cooked relative to demand >= owner's 69 lb: no savings to claim
  });
});

describe('leftoverDraftText: what the Close box starts with', () => {
  it('a closed night shows its saved leftover', () => {
    expect(leftoverDraftText({ leftoverLb: 6, closed: true })).toBe('6');
  });
  it('a row from before the flag existed counts as closed', () => {
    expect(leftoverDraftText({ leftoverLb: 0 } as Pick<SaleRecord, 'leftoverLb' | 'closed'>)).toBe('0');
  });
  it('a row made only by a Service tap starts blank, so its placeholder 0 is never mistaken for an answer', () => {
    expect(leftoverDraftText({ leftoverLb: 0, closed: false })).toBe('');
  });
  it('no row at all starts blank', () => {
    expect(leftoverDraftText(undefined)).toBe('');
  });
});

describe('closeCheck on 5000 random inputs', () => {
  it('never accepts an impossible row and never returns a non-finite number', () => {
    let seed = 20261025;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const text = () => pick(['', ' ', '0', '5', '12.5', '70', '71', '-3', 'abc', '1e3', '100001', '2,5', String(Math.round(rnd() * 200 * 10) / 10)]);
    let ok = 0;
    for (let i = 0; i < 5000; i++) {
      const cooked = rnd() < 0.1 ? null : Math.round(rnd() * 120 * 10) / 10;
      const r = closeCheck({
        name: 'M', hasPlan: rnd() < 0.6, hasRow: rnd() < 0.3, cookedText: text(), cooked,
        leftoverText: text(), cateringText: text(), soldOutAt: rnd() < 0.4 ? 10 + rnd() * 10 : null,
      });
      if (r.kind !== 'ok') continue;
      ok++;
      expect(Number.isFinite(r.leftover) && Number.isFinite(r.catering)).toBe(true);
      expect(r.leftover).toBeGreaterThanOrEqual(0);
      expect(r.catering).toBeGreaterThanOrEqual(0);
      expect(r.leftover + r.catering).toBeLessThanOrEqual((cooked as number) + 0.001);
      expect(r.leftover).toBeLessThanOrEqual(MAX_LB);
    }
    expect(ok).toBeGreaterThan(300); // the accepting branch is genuinely exercised
  });
});
