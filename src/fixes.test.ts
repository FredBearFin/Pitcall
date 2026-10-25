// Regression tests for the pilot-stage fixes. Each describe block names the defect it pins.
import { describe, expect, it } from 'vitest';
import { chooseCount } from './engine';
import {
  DEFAULT_SETTINGS, SEED_MEATS, buildBackup, buildHistory, halfGoneMedian, hasDemandSignal, isClosedRow, parseBackupText,
  serviceClock, stampBlocked, weekSummary,
} from './logic';
import type { PlanRecord, SaleRecord } from './types';

const brisket = SEED_MEATS[0];
const sale = (date: string, o: Partial<SaleRecord> = {}): SaleRecord => ({
  date, meatId: 'brisket', cookedLb: 77, leftoverLb: 0, cateringLb: 0, soldOutAt: null, halfGoneAt: null, leftoverUse: null, ...o,
});
const hist = (sales: SaleRecord[]) =>
  buildHistory({ meat: brisket, settings: DEFAULT_SETTINGS, sales, plans: [], beforeDate: '2026-10-30' });

describe('defect 1: the headline count is never outside the good range', () => {
  const plain = { ...DEFAULT_SETTINGS, cardFee: 0, packaging: 0 };

  it("pinned case: a capped leftover outlet used to push the headline to 10 beside a good range of 8 to 9", () => {
    const meat = { ...brisket, leftoverValue: 6, leftoverCap: 5 };
    const r = chooseCount({ mean: 60, sigma: 12, meat, settings: plain, cateringLb: 0 });
    expect(r.rangeLo).toBe(8);
    expect(r.rangeHi).toBe(9);
    expect(r.nStar).toBe(9);
  });

  it("the spec's worked examples are unchanged (chili outlet: 10 in 8 to 11; binned: 9 in 8 to 9)", () => {
    const chili = chooseCount({ mean: 60, sigma: 12, meat: { ...brisket, leftoverValue: 6, leftoverCap: 1000 }, settings: plain, cateringLb: 0 });
    expect([chili.nStar, chili.rangeLo, chili.rangeHi]).toEqual([10, 8, 11]);
    expect(chili.cr).toBeCloseTo(0.86, 2);
    const binned = chooseCount({ mean: 60, sigma: 12, meat: brisket, settings: plain, cateringLb: 0 });
    expect([binned.nStar, binned.rangeLo, binned.rangeHi]).toEqual([9, 8, 9]);
    expect(binned.cr).toBeCloseTo(0.675, 3);
  });

  it('holds on 6000 random meats, forecasts, caterings and outlets', () => {
    let seed = 20261025;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let checked = 0;
    for (let i = 0; i < 6000; i++) {
      const base = SEED_MEATS[i % SEED_MEATS.length];
      const meat = {
        ...base, rawCost: 1 + rnd() * 8, price: 8 + rnd() * 30, rawWeight: 2 + rnd() * 14, yield: 0.4 + rnd() * 0.55,
        leftoverValue: rnd() < 0.5 ? 0 : rnd() * 8, leftoverCap: rnd() * 40,
      };
      const r = chooseCount({
        mean: 10 + rnd() * 120, sigma: 2 + rnd() * 30, meat, settings: DEFAULT_SETTINGS, cateringLb: rnd() < 0.3 ? rnd() * 30 : 0,
      });
      expect(r.nStar).toBeGreaterThanOrEqual(r.rangeLo);
      expect(r.nStar).toBeLessThanOrEqual(r.rangeHi);
      expect(r.bestN).toBeGreaterThanOrEqual(r.rangeLo);
      expect(r.bestN).toBeLessThanOrEqual(r.rangeHi);
      checked++;
    }
    expect(checked).toBe(6000);
  });
});

describe('defect 2: a row made only by a Service tap is not a closed night', () => {
  it('a missing flag means closed, so old rows and old backups behave as before', () => {
    expect(isClosedRow(sale('2026-10-10'))).toBe(true);
    expect(isClosedRow(sale('2026-10-10', { closed: true }))).toBe(true);
    expect(isClosedRow(sale('2026-10-10', { closed: false }))).toBe(false);
  });

  it('a half-gone-only tap row used to read as "demand = everything cooked" and is now ignored', () => {
    expect(hist([sale('2026-10-10', { halfGoneAt: 15, closed: false })])).toEqual([]);
  });

  it('a tap row with an 86 still counts, because leftover is zero by definition once it sold out', () => {
    expect(hasDemandSignal(sale('2026-10-10', { soldOutAt: 14, closed: false }))).toBe(true);
    const h = hist([sale('2026-10-10', { soldOutAt: 14, closed: false })]);
    expect(h).toHaveLength(1);
    expect(h[0].demandLb).toBeGreaterThanOrEqual(77 - 1e-6);
  });

  it('closing the night (closed: true) makes the same row count as an exact night', () => {
    const h = hist([sale('2026-10-10', { halfGoneAt: 15, closed: true })]);
    expect(h).toHaveLength(1);
    expect(h[0].demandLb).toBe(77);
  });

  it('the week summary skips tap-only rows: no savings, no day in the sold-out tally', () => {
    const plan: PlanRecord = {
      date: '2026-10-16', meatId: 'brisket', ownerPieces: 4, pitcallPieces: 6, rangeLo: 5, rangeHi: 7, finalPieces: 6, mean: 50, sigma: 10, cr: 0.8,
      cateringLb: 0, yPerPiece: 7.7, accepted: true,
    };
    const args = { today: '2026-10-17', meats: SEED_MEATS, settings: DEFAULT_SETTINGS, plans: [plan] };
    const tapOnly = weekSummary({ ...args, sales: [sale('2026-10-16', { halfGoneAt: 15, closed: false })] });
    expect(tapOnly.savedCount).toBe(0);
    expect(tapOnly.soldOutByMeat).toEqual([]);
    const soldOut = weekSummary({ ...args, sales: [sale('2026-10-16', { soldOutAt: 18, closed: false })] });
    expect(soldOut.savedCount).toBe(1);
    expect(soldOut.soldOutByMeat[0]).toMatchObject({ times: 1, days: 1 });
  });
});

describe('defect 3: "half gone" after the 86', () => {
  it('stampBlocked refuses a new half-gone tap once the meat is 86d, and allows everything else', () => {
    expect(stampBlocked({ soldOutAt: 14 }, 'halfGoneAt')).toMatch(/Already 86d/);
    expect(stampBlocked({ soldOutAt: null }, 'halfGoneAt')).toBeNull();
    expect(stampBlocked(undefined, 'halfGoneAt')).toBeNull();
    expect(stampBlocked({ soldOutAt: 14 }, 'soldOutAt')).toBeNull();
  });

  it('old data with half-gone times later than the 86 no longer feeds the curve', () => {
    const late = Array.from({ length: 14 }, (_, i) => sale(`2026-10-${String(i + 1).padStart(2, '0')}`, { soldOutAt: 14, halfGoneAt: 17 }));
    expect(halfGoneMedian(late)).toBeNull(); // all 14 taps are impossible, so there are no usable taps
    const mixed = [...late, ...Array.from({ length: 14 }, (_, i) => sale(`2026-09-${String(i + 1).padStart(2, '0')}`, { soldOutAt: 15, halfGoneAt: 13 }))];
    expect(halfGoneMedian(mixed)).toBe(13);
  });

  it('a half-gone time equal to the 86 time is allowed (both tapped in the same minute)', () => {
    const same = Array.from({ length: 14 }, (_, i) => sale(`2026-10-${String(i + 1).padStart(2, '0')}`, { soldOutAt: 14, halfGoneAt: 14 }));
    expect(halfGoneMedian(same)).toBe(14);
  });
});

describe('defect 4: the day boundary (a tap or close-out after midnight belongs to the night that just ended)', () => {
  const at = (y: number, mo: number, d: number, h: number, mi: number) => serviceClock(new Date(y, mo - 1, d, h, mi));

  it('12:30 am is still last night, with the hour running on past 24', () => {
    expect(at(2026, 10, 25, 0, 30)).toEqual({ date: '2026-10-24', hour: 24.5 });
    expect(at(2026, 10, 25, 3, 59).date).toBe('2026-10-24');
    expect(at(2026, 10, 25, 3, 59).hour).toBeCloseTo(27.983, 2);
  });
  it('4:00 am starts the new night, and the evening is unchanged', () => {
    expect(at(2026, 10, 25, 4, 0)).toEqual({ date: '2026-10-25', hour: 4 });
    expect(at(2026, 10, 25, 13, 15)).toEqual({ date: '2026-10-25', hour: 13.25 });
    expect(at(2026, 10, 25, 23, 59).date).toBe('2026-10-25');
  });
  it('rolls back across month and year ends', () => {
    expect(at(2026, 11, 1, 0, 10).date).toBe('2026-10-31');
    expect(at(2027, 1, 1, 2, 0).date).toBe('2026-12-31');
    expect(at(2028, 3, 1, 1, 0).date).toBe('2028-02-29'); // leap year
  });
});

describe('the unusual-night tick', () => {
  it('an unusual night is left out of what the forecast learns from', () => {
    const rows = [sale('2026-10-10', { closed: true }), sale('2026-10-11', { closed: true, unusual: true, cookedLb: 30 })];
    expect(hist(rows).map((p) => p.date)).toEqual(['2026-10-10']);
  });
  it('its half-gone tap does not count toward the 14 needed for the demand curve either', () => {
    const normal = Array.from({ length: 13 }, (_, i) => sale(`2026-09-${String(i + 1).padStart(2, '0')}`, { halfGoneAt: 13, closed: true }));
    const stormy = sale('2026-09-20', { halfGoneAt: 19, closed: true, unusual: true });
    // 13 normal taps + 1 unusual tap = 14 taps, but the unusual one must not be counted, so the median is still the default curve.
    const withStorm = buildHistory({ meat: brisket, settings: DEFAULT_SETTINGS, sales: [...normal, stormy, sale('2026-09-21', { soldOutAt: 15, closed: true })], plans: [], beforeDate: '2026-10-01' });
    const without = buildHistory({ meat: brisket, settings: DEFAULT_SETTINGS, sales: [...normal, sale('2026-09-21', { soldOutAt: 15, closed: true })], plans: [], beforeDate: '2026-10-01' });
    expect(withStorm.map((p) => p.demandLb)).toEqual(without.map((p) => p.demandLb));
  });
  it('the week summary still counts an unusual night, since the money really moved', () => {
    const plan: PlanRecord = {
      date: '2026-10-16', meatId: 'brisket', ownerPieces: 4, pitcallPieces: 6, rangeLo: 5, rangeHi: 7, finalPieces: 6, mean: 50, sigma: 10, cr: 0.8,
      cateringLb: 0, yPerPiece: 7.7, accepted: true,
    };
    const w = weekSummary({
      today: '2026-10-17', meats: SEED_MEATS, settings: DEFAULT_SETTINGS, plans: [plan],
      sales: [sale('2026-10-16', { soldOutAt: 18, closed: true, unusual: true })],
    });
    expect(w.savedCount).toBe(1);
  });
});

describe('backup file carries the new flags and still reads old files', () => {
  const full = (sales: SaleRecord[]) => JSON.parse(JSON.stringify(buildBackup({ meats: SEED_MEATS, settings: DEFAULT_SETTINGS, plans: [], sales, cooks: [] }, new Date('2026-10-25'))));
  const parse = (o: unknown) => parseBackupText(JSON.stringify(o));

  it('an old backup with no flags still imports, and the flags stay absent (so the rows still read as closed)', () => {
    const r = parse(full([sale('2026-10-10')]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('closed' in r.value.sales[0]).toBe(false);
      expect('unusual' in r.value.sales[0]).toBe(false);
      expect(isClosedRow(r.value.sales[0])).toBe(true);
    }
  });
  it('flags set to true or false round-trip unchanged', () => {
    const r = parse(full([sale('2026-10-10', { closed: false, unusual: true }), sale('2026-10-11', { closed: true, unusual: false })]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sales[0]).toMatchObject({ closed: false, unusual: true });
      expect(r.value.sales[1]).toMatchObject({ closed: true, unusual: false });
    }
  });
  it('rejects a flag that is not true or false', () => {
    for (const bad of [1, 0, 'yes', null, {}, []]) {
      const a = full([sale('2026-10-10')]);
      a.sales[0].closed = bad;
      expect(parse(a).ok).toBe(false);
      const b = full([sale('2026-10-10')]);
      b.sales[0].unusual = bad;
      expect(parse(b).ok).toBe(false);
    }
  });
});
