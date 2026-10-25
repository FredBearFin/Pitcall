import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, SEED_MEATS, addDays, buildBackup, buildHistory, completedCooks, computeMeatCount, cookAccuracy, defaultServiceDate,
  dollarSentence, fmtHour, halfGoneMedian, parseBackupText, parseNum, putOnGroups, validateMeatDraft, validateSettingsDraft, weekSummary,
} from './logic';
import type { PlanRecord, SaleRecord } from './types';

const brisket = SEED_MEATS[0];
const sale = (date: string, o: Partial<SaleRecord> = {}): SaleRecord => ({
  date, meatId: 'brisket', cookedLb: 70, leftoverLb: 10, cateringLb: 0, soldOutAt: null, halfGoneAt: null, leftoverUse: 'binned', ...o,
});

describe('dates and numbers', () => {
  it('service date flips to tomorrow in the evening', () => {
    expect(defaultServiceDate(new Date(2026, 9, 17, 20, 0))).toBe('2026-10-18');
    expect(defaultServiceDate(new Date(2026, 9, 17, 9, 0))).toBe('2026-10-17');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('parseNum rejects junk', () => {
    for (const bad of ['', ' ', '-1', 'abc', '1e3', 'NaN', 'Infinity', '1.2.3', '--2']) expect(parseNum(bad)).toBeNull();
    expect(parseNum('12.5')).toBe(12.5);
    expect(parseNum('.5')).toBe(0.5);
    expect(fmtHour(13.25)).toBe('1:15 pm');
    expect(fmtHour(0)).toBe('12:00 am');
  });
});

describe('history pipeline and counts', () => {
  it('empty history still gives a count from usualGuess', () => {
    const r = computeMeatCount({ meat: brisket, settings: DEFAULT_SETTINGS, sales: [], plans: [], date: '2026-10-18', cateringLb: 0 });
    expect(r.result.nStar).toBeGreaterThan(0);
    expect(Number.isFinite(r.forecast.mean)).toBe(true);
    expect(r.result.table[r.result.nStar]).toBeDefined();
  });
  it('only uses earlier days with cooked lb and this meat', () => {
    const sales = [sale('2026-10-10'), sale('2026-10-11', { cookedLb: 0 }), sale('2026-10-12', { meatId: 'ribs' }), sale('2026-10-18')];
    const h = buildHistory({ meat: brisket, settings: DEFAULT_SETTINGS, sales, plans: [], beforeDate: '2026-10-18' });
    expect(h.map((x) => x.date)).toEqual(['2026-10-10']);
    expect(h[0].demandLb).toBeGreaterThan(0);
  });
  it('sold-out day recovers at least what was sold', () => {
    const h = buildHistory({
      meat: brisket, settings: DEFAULT_SETTINGS, sales: [sale('2026-10-10', { leftoverLb: 0, soldOutAt: 15 })], plans: [], beforeDate: '2026-10-18',
    });
    expect(h[0].demandLb).toBeGreaterThanOrEqual(70 - 1e-6);
  });
  it('half-gone median needs 14 taps', () => {
    const few = Array.from({ length: 13 }, (_, i) => sale(`2026-09-${String(i + 1).padStart(2, '0')}`, { halfGoneAt: 13 }));
    expect(halfGoneMedian(few)).toBeNull();
    expect(halfGoneMedian([...few, sale('2026-09-20', { halfGoneAt: 14 })])).toBe(13);
  });
});

describe('dollar sentence and put-on', () => {
  it('compares to owner number', () => {
    const { result } = computeMeatCount({ meat: brisket, settings: DEFAULT_SETTINGS, sales: [], plans: [], date: '2026-10-18', cateringLb: 0 });
    const s = dollarSentence({ result, pieces: result.nStar, ownerPieces: result.nStar + 3 });
    expect(s).toMatch(/your \d+/);
    expect(s).toMatch(/\$/);
    expect(dollarSentence({ result, pieces: result.nStar, ownerPieces: null })).toMatch(/should earn about/);
    expect(dollarSentence({ result, pieces: 9999, ownerPieces: null })).toMatch(/outside/);
  });
  it('groups put-on times and learns from cooks', () => {
    const g0 = putOnGroups({ meat: brisket, settings: DEFAULT_SETTINGS, cooks: [], serviceDate: '2026-10-18', pieces: 4 });
    expect(g0).toHaveLength(1);
    expect(g0[0].pieces).toBe(4);
    const cooks = [0, 1, 2, 3].map((i) => ({ id: `c${i}`, meatId: 'brisket', rawWeight: 14, putOnMs: 1_000_000 * (i + 1), pullMs: 1_000_000 * (i + 1) + 14 * 3600000 }));
    const g1 = putOnGroups({ meat: brisket, settings: DEFAULT_SETTINGS, cooks, serviceDate: '2026-10-18', pieces: 4 });
    expect(g1[0].at.getTime()).toBeLessThan(g0[0].at.getTime()); // 14h cooks vs 12h guess => earlier
    expect(completedCooks([{ id: 'x', meatId: 'brisket', rawWeight: 14, putOnMs: 5, pullMs: null }])).toEqual([]);
    expect(cookAccuracy([], SEED_MEATS)).toBeNull();
    expect(cookAccuracy(cooks, SEED_MEATS)!.avgErrHours).toBeLessThan(3);
  });
});

describe('week summary', () => {
  it('sums savings, counts thrown-away only when binned, and sell-outs', () => {
    const plan = (date: string): PlanRecord => ({
      date, meatId: 'brisket', ownerPieces: 4, pitcallPieces: 6, rangeLo: 5, rangeHi: 7, finalPieces: 6, mean: 50, sigma: 10, cr: 0.8,
      cateringLb: 0, yPerPiece: 7.7, accepted: true,
    });
    const w = weekSummary({
      today: '2026-10-17', meats: SEED_MEATS, settings: DEFAULT_SETTINGS,
      plans: [plan('2026-10-16'), plan('2026-10-01')],
      sales: [
        sale('2026-10-16', { soldOutAt: 18, leftoverLb: 0 }),
        sale('2026-10-15', { leftoverLb: 10, leftoverUse: 'chili' }),
        sale('2026-10-14', { leftoverLb: 6, leftoverUse: 'binned' }),
        sale('2026-10-01', { leftoverLb: 50 }),
      ],
    });
    expect(w.savedCount).toBe(1);
    expect(Number.isFinite(w.savedTotal)).toBe(true);
    expect(w.thrownLb).toBe(6);
    expect(w.thrownDollars).toBeCloseTo(6 * (5 / 0.55), 5);
    expect(w.soldOutByMeat[0]).toMatchObject({ times: 1, days: 3 });
  });
});

describe('meat and settings validation', () => {
  const good = { name: 'Brisket', rawCost: '5', price: '28', rawWeight: '14', yield: '0.55', slots: '1', leftoverValue: '0', leftoverCap: '0', usualGuess: '60', cookHoursGuess: '12', sort: '1' };
  it('accepts good, rejects bad', () => {
    expect(validateMeatDraft(good, 'b').ok).toBe(true);
    for (const [k, v] of [['yield', '0'], ['yield', '1.2'], ['price', '-3'], ['rawWeight', 'abc'], ['slots', ''], ['sort', '1.5'], ['name', '  ']] as const) {
      const r = validateMeatDraft({ ...good, [k]: v }, 'b');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[k]).toBeTruthy();
    }
    expect(validateMeatDraft({ ...good, yield: '1' }, 'b').ok).toBe(true);
  });
  it('settings', () => {
    const s = { smokerSlots: '12', cardFee: '0.03', packaging: '0.5', openHour: '11', closeHour: '20', restHours: '1', onTimeZ: '1.28', lostSaleShare: '0.7' };
    expect(validateSettingsDraft(s, 'lunch').ok).toBe(true);
    expect(validateSettingsDraft({ ...s, lostSaleShare: '1' }, 'lunch').ok).toBe(true);
    expect(validateSettingsDraft({ ...s, lostSaleShare: '0.4' }, 'lunch').ok).toBe(true);
    expect(validateSettingsDraft({ ...s, lostSaleShare: '0.3' }, 'lunch').ok).toBe(false); // below the point where some meats stop paying to cook
    expect(validateSettingsDraft({ ...s, lostSaleShare: '1.1' }, 'lunch').ok).toBe(false);
    expect(validateSettingsDraft({ ...s, lostSaleShare: '' }, 'lunch').ok).toBe(false);
    const r = validateSettingsDraft(s, 'lunch');
    expect(r.ok && r.settings.lostSaleShare).toBe(0.7);
    expect(validateSettingsDraft({ ...s, closeHour: '9' }, 'lunch').ok).toBe(false);
    expect(validateSettingsDraft(s, 'bogus').ok).toBe(false);
    expect(validateSettingsDraft({ ...s, cardFee: '-1' }, 'lunch').ok).toBe(false);
  });
});

describe('backup validator (untrusted input)', () => {
  const base = () => JSON.parse(JSON.stringify(buildBackup({
    meats: SEED_MEATS, settings: DEFAULT_SETTINGS,
    plans: [{ date: '2026-10-16', meatId: 'brisket', ownerPieces: 4, pitcallPieces: 6, rangeLo: 5, rangeHi: 7, finalPieces: 6, mean: 50, sigma: 10, cr: 0.8, cateringLb: 0, yPerPiece: 7.7, accepted: true }],
    sales: [sale('2026-10-16')],
    cooks: [{ id: 'c1', meatId: 'brisket', rawWeight: 14, putOnMs: 1.7e12, pullMs: 1.7e12 + 4e7 }],
  }, new Date('2026-10-17'))));
  const ok = (o: unknown) => parseBackupText(JSON.stringify(o));

  it('round-trips a valid backup', () => {
    const r = ok(base());
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.meats).toHaveLength(5); expect(r.value.sales[0].meatId).toBe('brisket'); }
  });
  it('a backup or saved settings from before lostSaleShare existed loads, and gets the default (never resets to factory)', () => {
    const b = base();
    b.settings.smokerSlots = 33; // a customised value that must survive
    delete b.settings.lostSaleShare;
    const r = ok(b);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.settings.lostSaleShare).toBe(0.7); expect(r.value.settings.smokerSlots).toBe(33); }
  });
  it('lostSaleShare survives a round trip and a present-but-bad value is rejected', () => {
    const b = base();
    b.settings.lostSaleShare = 0.55;
    const r = ok(b);
    expect(r.ok && r.value.settings.lostSaleShare).toBe(0.55);
    for (const bad of [0, 0.39, 1.01, -1, 'x', null]) {
      const c = base();
      c.settings.lostSaleShare = bad;
      expect(ok(c).ok).toBe(false);
    }
  });
  it('rejects garbage and wrong shapes', () => {
    expect(parseBackupText('not json').ok).toBe(false);
    expect(parseBackupText('[]').ok).toBe(false);
    expect(parseBackupText('null').ok).toBe(false);
    expect(parseBackupText('x'.repeat(5_000_001)).ok).toBe(false);
    const mut = (f: (b: any) => void) => { const b = base(); f(b); return ok(b).ok; };
    expect(mut((b) => { b.app = 'other'; })).toBe(false);
    expect(mut((b) => { b.version = 2; })).toBe(false);
    expect(mut((b) => { delete b.settings; })).toBe(false);
    expect(mut((b) => { b.meats = {}; })).toBe(false);
    expect(mut((b) => { b.meats[0].yield = 5; })).toBe(false);
    expect(mut((b) => { b.meats[0].price = '28'; })).toBe(false);
    expect(mut((b) => { b.meats[0].rawCost = null; })).toBe(false);
    expect(mut((b) => { b.meats[0].name = 'x'.repeat(61); })).toBe(false);
    expect(mut((b) => { b.meats[0].id = "a'; DROP TABLE meat;--"; })).toBe(false);
    expect(mut((b) => { b.meats[1].id = b.meats[0].id; })).toBe(false);
    expect(mut((b) => { b.sales[0].meatId = 'ghost'; })).toBe(false);
    expect(mut((b) => { b.sales[0].date = '2026-13-45'; })).toBe(false);
    expect(mut((b) => { b.sales[0].leftoverUse = 'eaten'; })).toBe(false);
    expect(mut((b) => { b.sales[0].cookedLb = -1; })).toBe(false);
    expect(mut((b) => { b.sales.push({ ...b.sales[0] }); })).toBe(false);
    expect(mut((b) => { b.plans[0].accepted = 1; })).toBe(false);
    expect(mut((b) => { b.plans[0].finalPieces = 1.5; })).toBe(false);
    expect(mut((b) => { b.cooks[0].pullMs = 5; })).toBe(false);
    expect(mut((b) => { b.settings.curve = 'wild'; })).toBe(false);
    expect(mut((b) => { b.settings.closeHour = 5; })).toBe(false);
  });
  it('enforces row-count caps', () => {
    const b = base();
    b.cooks = Array.from({ length: 20001 }, (_, i) => ({ id: `c${i}`, meatId: 'brisket', rawWeight: 1, putOnMs: 1.7e12, pullMs: null }));
    expect(ok(b).ok).toBe(false);
    const c = base();
    c.meats = Array.from({ length: 51 }, (_, i) => ({ ...SEED_MEATS[0], id: `m${i}` }));
    c.plans = []; c.sales = []; c.cooks = [];
    expect(ok(c).ok).toBe(false);
  });
  it('ignores prototype-pollution keys', () => {
    const r = parseBackupText(JSON.stringify(base()).replace('"app"', '"__proto__":{"polluted":1},"app"'));
    expect(({} as any).polluted).toBeUndefined();
    expect(r.ok).toBe(true); // extra key is ignored, never copied onto our objects
    if (r.ok) expect(({} as any).polluted ?? (r.value as any).polluted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Review regressions + hostile-backup battery
// ---------------------------------------------------------------------
const goodBackup = () => buildBackup({
  meats: SEED_MEATS, plans: [], sales: [sale('2026-10-10')], cooks: [], settings: DEFAULT_SETTINGS,
}, new Date());

describe('review regressions: logic', () => {
  it('parseNum accepts a comma decimal but not thousands or junk', () => {
    expect(parseNum('1,5')).toBe(1.5);
    expect(parseNum('1,000')).toBeNull();
    expect(parseNum('1,2,3')).toBeNull();
  });
  it('weekSummary does not pollute Object.prototype for reserved meat ids', () => {
    const meat = { ...brisket, id: '__proto__' };
    weekSummary({ today: '2026-10-17', meats: [meat], settings: DEFAULT_SETTINGS, plans: [], sales: [sale('2026-10-16', { meatId: '__proto__' })] });
    expect(({} as Record<string, unknown>).days).toBeUndefined();
    expect(({} as Record<string, unknown>).times).toBeUndefined();
  });
  it('buildHistory with 20000 sales and plans is fast (was O(n^2))', () => {
    const sales: SaleRecord[] = [];
    const plans: PlanRecord[] = [];
    for (let i = 0; i < 20000; i++) {
      const date = new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10);
      sales.push(sale(date, { soldOutAt: 15, leftoverLb: 0 }));
      plans.push({ date, meatId: 'brisket', ownerPieces: 8, pitcallPieces: 9, rangeLo: 8, rangeHi: 10, finalPieces: 9, mean: 60, sigma: 12, cr: 0.8, cateringLb: 0, yPerPiece: 7.7, accepted: true });
    }
    const t = Date.now();
    const h = buildHistory({ meat: brisket, settings: DEFAULT_SETTINGS, sales, plans, beforeDate: '2100-01-01' });
    expect(h.length).toBe(20000);
    expect(Date.now() - t).toBeLessThan(3000);
  });
});

describe('hostile backup import', () => {
  const tryText = (o: unknown) => parseBackupText(JSON.stringify(o));
  it('accepts a good backup and round-trips', () => {
    const r = tryText(goodBackup());
    expect(r.ok).toBe(true);
  });
  it('tolerates a UTF-8 BOM', () => {
    expect(parseBackupText('\uFEFF' + JSON.stringify(goodBackup())).ok).toBe(true);
  });
  it('rejects reserved / prototype-ish ids for meats and cooks', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const b = goodBackup();
      b.meats = [{ ...SEED_MEATS[0], id }];
      b.sales = [];
      expect(tryText(b).ok).toBe(false);
      const c = goodBackup();
      c.cooks = [{ id, meatId: 'brisket', rawWeight: 10, putOnMs: Date.UTC(2026, 0, 1), pullMs: null }];
      expect(tryText(c).ok).toBe(false);
    }
  });
  it('a __proto__ key in the JSON does not change the result or the global prototype', () => {
    const text = JSON.stringify(goodBackup()).replace('{', '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}},');
    const r = parseBackupText(text);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
    if (r.ok) expect(Object.prototype.hasOwnProperty.call(r.value, 'polluted')).toBe(false);
  });
  it('rejects wrong types, non-finite and out-of-range numbers, bad enums and bad dates', () => {
    const mut = (f: (b: any) => void) => { const b: any = JSON.parse(JSON.stringify(goodBackup())); f(b); return tryText(b).ok; };
    expect(mut((b) => { b.meats[0].price = '28'; })).toBe(false);
    expect(mut((b) => { b.meats[0].price = null; })).toBe(false);
    expect(mut((b) => { b.meats[0].yield = 0; })).toBe(false);
    expect(mut((b) => { b.meats[0].yield = 1.5; })).toBe(false);
    expect(mut((b) => { b.meats[0].rawWeight = -1; })).toBe(false);
    expect(mut((b) => { b.meats[0].name = 'x'.repeat(61); })).toBe(false);
    expect(mut((b) => { b.meats[0].name = ''; })).toBe(false);
    expect(mut((b) => { b.meats[0].id = "a'; DROP TABLE meat;--"; })).toBe(false);
    expect(mut((b) => { b.sales[0].date = '2026-02-30'; })).toBe(false);
    expect(mut((b) => { b.sales[0].date = "2026-10-10'; DROP"; })).toBe(false);
    expect(mut((b) => { b.sales[0].leftoverUse = 'dumpster'; })).toBe(false);
    expect(mut((b) => { b.sales[0].meatId = 'ghost'; })).toBe(false);
    expect(mut((b) => { b.sales.push({ ...b.sales[0] }); })).toBe(false);
    expect(mut((b) => { b.settings.curve = 'rocket'; })).toBe(false);
    expect(mut((b) => { b.settings.closeHour = b.settings.openHour; })).toBe(false);
    expect(mut((b) => { b.version = 2; })).toBe(false);
    expect(mut((b) => { b.app = 'other'; })).toBe(false);
    expect(mut((b) => { b.plans = {}; })).toBe(false);
    expect(mut((b) => { b.meats = Array.from({ length: 51 }, (_, i) => ({ ...b.meats[0], id: 'm' + i })); b.sales = []; })).toBe(false);
  });
  it('rejects Infinity from 1e999, and NaN-looking strings', () => {
    const text = JSON.stringify(goodBackup()).replace('"price":28', '"price":1e999');
    expect(parseBackupText(text).ok).toBe(false);
    const t2 = JSON.stringify(goodBackup()).replace('"price":28', '"price":"NaN"');
    expect(parseBackupText(t2).ok).toBe(false);
  });
  it('never throws on garbage, deep nesting, or oversize text', () => {
    for (const t of ['', 'null', '[]', '"x"', '{', '[' .repeat(200000), '{"a":'.repeat(50000), 'x'.repeat(6_000_000), '\u0000\u0001']) {
      expect(() => parseBackupText(t)).not.toThrow();
      expect(parseBackupText(t).ok).toBe(false);
    }
  });
  it('control characters and unicode in names are kept as plain text (bound as parameters)', () => {
    const b = goodBackup();
    b.meats = [{ ...SEED_MEATS[0], name: 'Brisket\u0007\u202e<script>' }];
    b.sales = [];
    const r = tryText(b);
    expect(r.ok).toBe(true);
  });
});
