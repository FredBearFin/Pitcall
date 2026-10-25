// Pure helpers for the UI layer. NO react-native / expo imports here so vitest can run it.
import type {
  CookRecord, CountResult, CurveKind, DayPoint, Forecast, Meat, PlanRecord, SaleRecord, Settings,
} from './types';
import {
  chooseCount, curveF, fitCookTime, forecastDemand, planPutOn, recoverDemand, savedVsOwner,
} from './engine';

// ---------------------------------------------------------------- dates / format
const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function isValidDateStr(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d && y >= 2000 && y <= 2200;
}
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + n));
}
export function hourOfDay(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}
/** Before this hour (local) the clock still belongs to the previous service night. */
export const NIGHT_ENDS_AT = 4;
/**
 * Which service night a moment belongs to, and the hour on that night's clock.
 * 12:45 am is hour 24.75 of the PREVIOUS night, so a late 86 or a close-out typed after midnight
 * is filed against the night it describes, not a stray row for the new calendar day.
 */
export function serviceClock(now: Date): { date: string; hour: number } {
  const h = hourOfDay(now);
  if (now.getHours() < NIGHT_ENDS_AT) return { date: addDays(toDateStr(now), -1), hour: h + 24 };
  return { date: toDateStr(now), hour: h };
}
/** Tomorrow if it is evening (after 4 pm), else today. */
export function defaultServiceDate(now: Date): string {
  const today = toDateStr(now);
  return now.getHours() >= 16 ? addDays(today, 1) : today;
}
export function fmtHour(h: number): string {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const ap = hh >= 12 ? 'pm' : 'am';
  return `${hh % 12 === 0 ? 12 : hh % 12}:${pad(mm)} ${ap}`;
}
export function fmtMoney(x: number): string {
  const r = Math.round(x);
  return `${r < 0 ? '-' : ''}$${Math.abs(r).toLocaleString('en-US')}`;
}
export function fmtLb(x: number): string {
  return `${(Math.round(x * 10) / 10).toString()} lb`;
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${DAYS[new Date(y, m - 1, d).getDay()]} ${m}/${d}`;
}
export function fmtDateTime(d: Date, refDate: string): string {
  const day = toDateStr(d);
  const t = fmtHour(hourOfDay(d));
  return day === refDate ? t : `${DAYS[d.getDay()]} ${t}`;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

// ---------------------------------------------------------------- numeric input parsing
/** Parse a user-typed non-negative decimal. Returns null for anything else (empty, NaN, negative, 1e3, ...). */
export function parseNum(s: string): number | null {
  let t = s.trim();
  if (/^\d*,\d{1,2}$/.test(t)) t = t.replace(',', '.'); // comma-decimal keyboards: "1,5" -> 1.5
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

interface FieldSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  minExclusive?: boolean;
  int?: boolean;
  hint?: string;
}

export const MEAT_FIELDS: FieldSpec[] = [
  { key: 'rawCost', label: 'Raw cost $/lb', min: 0, max: 1000, hint: 'what you pay per raw lb' },
  { key: 'price', label: 'Price $/lb cooked', min: 0, max: 1000 },
  { key: 'rawWeight', label: 'Raw lb per piece', min: 0, max: 500, minExclusive: true },
  { key: 'yield', label: 'Yield (0-1)', min: 0, max: 1, minExclusive: true, hint: 'sellable cooked lb / raw lb' },
  { key: 'slots', label: 'Smoker slots per piece', min: 0, max: 100, minExclusive: true },
  { key: 'leftoverValue', label: 'Leftover value $/lb', min: 0, max: 1000, hint: '0 = you throw it out' },
  { key: 'leftoverCap', label: 'Leftover cap lb/day', min: 0, max: 10000 },
  { key: 'usualGuess', label: 'Usual walk-in lb/day', min: 0, max: 10000 },
  { key: 'cookHoursGuess', label: 'Cook hours per piece', min: 0, max: 72, minExclusive: true },
  { key: 'sort', label: 'Display order', min: 0, max: 1000, int: true },
];

export const SETTINGS_FIELDS: FieldSpec[] = [
  { key: 'smokerSlots', label: 'Smoker slots (total)', min: 0, max: 1000, minExclusive: true, int: true },
  { key: 'cardFee', label: 'Card fee share (0.03 = 3%)', min: 0, max: 0.5 },
  { key: 'packaging', label: 'Packaging $/lb sold', min: 0, max: 100 },
  { key: 'openHour', label: 'Open hour (11 = 11am)', min: 0, max: 24 },
  { key: 'closeHour', label: 'Close hour (20 = 8pm)', min: 0, max: 24 },
  { key: 'restHours', label: 'Rest hours after pull', min: 0, max: 24 },
  { key: 'onTimeZ', label: 'On-time z (1.28 = 90%)', min: 0, max: 5 },
  {
    key: 'lostSaleShare', label: 'Sale really lost if you run out (0.7 = 70%)', min: 0.4, max: 1,
    hint: '1 = every customer walks away. Lower = some order another meat instead, so Pitcall cooks less and wastes less.',
  },
];

function checkField(f: FieldSpec, raw: string): { v?: number; err?: string } {
  const t = raw.trim();
  if (t === '') return { err: 'Required' };
  if (t.startsWith('-')) return { err: 'Cannot be negative' };
  const v = parseNum(t);
  if (v === null) return { err: 'Enter a plain number' };
  if (f.int && !Number.isInteger(v)) return { err: 'Whole number only' };
  if (f.minExclusive ? v <= f.min : v < f.min) return { err: `Must be ${f.minExclusive ? 'above' : 'at least'} ${f.min}` };
  if (v > f.max) return { err: `Must be at most ${f.max}` };
  return { v };
}

export function validateMeatDraft(
  draft: Record<string, string>, id: string,
): { ok: true; meat: Meat } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const vals: Record<string, number> = {};
  const name = (draft.name ?? '').trim();
  if (!name) errors.name = 'Required';
  else if (name.length > 60) errors.name = 'At most 60 characters';
  for (const f of MEAT_FIELDS) {
    const r = checkField(f, draft[f.key] ?? '');
    if (r.err) errors[f.key] = r.err;
    else vals[f.key] = r.v as number;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    meat: {
      id, name,
      rawCost: vals.rawCost, price: vals.price, rawWeight: vals.rawWeight, yield: vals.yield, slots: vals.slots,
      leftoverValue: vals.leftoverValue, leftoverCap: vals.leftoverCap, usualGuess: vals.usualGuess,
      cookHoursGuess: vals.cookHoursGuess, sort: vals.sort,
    },
  };
}

export function validateSettingsDraft(
  draft: Record<string, string>, curve: string,
): { ok: true; settings: Settings } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const vals: Record<string, number> = {};
  for (const f of SETTINGS_FIELDS) {
    const r = checkField(f, draft[f.key] ?? '');
    if (r.err) errors[f.key] = r.err;
    else vals[f.key] = r.v as number;
  }
  if (!isCurve(curve)) errors.curve = 'Pick a curve';
  if (!errors.openHour && !errors.closeHour && vals.closeHour <= vals.openHour) errors.closeHour = 'Must be after open';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      smokerSlots: vals.smokerSlots, cardFee: vals.cardFee, packaging: vals.packaging, openHour: vals.openHour,
      closeHour: vals.closeHour, restHours: vals.restHours, curve: curve as CurveKind, onTimeZ: vals.onTimeZ,
      lostSaleShare: vals.lostSaleShare,
    },
  };
}

export function isCurve(x: unknown): x is CurveKind {
  return x === 'steady' || x === 'lunch' || x === 'morning';
}

// ---------------------------------------------------------------- defaults
/**
 * Default share of a sale that is really lost when a meat runs out. 1 would treat every 86 as a customer walking away, which
 * made Pitcall over-cook (simulation: with only half the sales truly lost, it lost $28 a night to the owner's gut). 0.7 costs
 * almost nothing if every sell-out really is lost and stays ahead of the owner down to a true share of about 0.5.
 */
export const DEFAULT_LOST_SALE_SHARE = 0.7;
export const DEFAULT_SETTINGS: Settings = {
  smokerSlots: 12, cardFee: 0.03, packaging: 0.5, openHour: 11, closeHour: 20, restHours: 1, curve: 'lunch', onTimeZ: 1.28,
  lostSaleShare: DEFAULT_LOST_SALE_SHARE,
};

export const SEED_MEATS: Meat[] = [
  { id: 'brisket', name: 'Brisket', rawCost: 5.0, price: 28, rawWeight: 14, yield: 0.55, slots: 1, leftoverValue: 0, leftoverCap: 0, usualGuess: 60, cookHoursGuess: 12, sort: 1 },
  { id: 'butt', name: 'Pork butt', rawCost: 2.5, price: 16, rawWeight: 8, yield: 0.6, slots: 1, leftoverValue: 4, leftoverCap: 20, usualGuess: 40, cookHoursGuess: 10, sort: 2 },
  { id: 'ribs', name: 'Ribs', rawCost: 3.5, price: 22, rawWeight: 3.5, yield: 0.65, slots: 0.5, leftoverValue: 0, leftoverCap: 0, usualGuess: 30, cookHoursGuess: 5, sort: 3 },
  { id: 'sausage', name: 'Sausage', rawCost: 4.0, price: 14, rawWeight: 5, yield: 0.95, slots: 0.5, leftoverValue: 3, leftoverCap: 10, usualGuess: 20, cookHoursGuess: 2, sort: 4 },
  { id: 'turkey', name: 'Turkey', rawCost: 2.2, price: 18, rawWeight: 12, yield: 0.6, slots: 1, leftoverValue: 3, leftoverCap: 10, usualGuess: 20, cookHoursGuess: 6, sort: 5 },
];

export function newId(): string {
  return `m${Date.now().toString(36)}${Math.floor(Math.random() * 1679616).toString(36)}`;
}

// ---------------------------------------------------------------- history -> DayPoint pipeline
/** Walk-in cooked lb actually sold on a day (never negative). */
export function walkInSold(s: Pick<SaleRecord, 'cookedLb' | 'leftoverLb' | 'cateringLb'>): number {
  return Math.max(0, s.cookedLb - s.leftoverLb - s.cateringLb);
}

/** A row made by a Service tap is not a closed night until Close saves it. Missing flag = closed (old data). */
export const isClosedRow = (s: Pick<SaleRecord, 'closed'>): boolean => s.closed !== false;
/**
 * Whether a row says anything about demand. A closed night does. A tap-only row does only if the meat
 * sold out (leftover is 0 by definition then); a half-gone-only row has a placeholder leftover of 0
 * and would otherwise read as "demand = everything cooked".
 */
export const hasDemandSignal = (s: Pick<SaleRecord, 'closed' | 'soldOutAt'>): boolean => isClosedRow(s) || s.soldOutAt != null;

/** Largest weight any field may hold (lb). Keeps every saved row exportable and importable. */
export const MAX_LB = 100000;

/**
 * An 86 and a big leftover cannot both be true: a meat that sold out should have close to nothing left. Past this much
 * leftover the 86 time is not believed. Default: more than 15% of what was cooked, and at least 5 lb (a small remainder is
 * normal, e.g. a last portion held back). Tunable; Z finding F8.
 */
export const SOLD_OUT_CONTRADICTION_PCT = 0.15;
export const SOLD_OUT_CONTRADICTION_MIN_LB = 5;
export const soldOutContradictionLb = (cookedLb: number): number =>
  Math.max(SOLD_OUT_CONTRADICTION_MIN_LB, SOLD_OUT_CONTRADICTION_PCT * cookedLb);

/** The sell-out time to trust: null when there is none, or when the leftover contradicts it (then demand is what actually sold). */
export function trustedSoldOutAt(s: Pick<SaleRecord, 'soldOutAt' | 'leftoverLb' | 'cookedLb'>): number | null {
  if (s.soldOutAt == null) return null;
  return s.leftoverLb > soldOutContradictionLb(s.cookedLb) ? null : s.soldOutAt;
}

/**
 * A closed night with essentially nothing left sold out even if nobody tapped 86 (the cook forgot, or it went in the rush).
 * "Essentially nothing" = at most 2% of what was cooked, or 0.5 lb, whichever is larger. Used only where the
 * safe assumption is "it was demand-limited at the owner's count" (the "Pitcall found you" claim), so a forgotten tap makes that
 * claim smaller, never bigger. Simulation: with 60% of taps forgotten the claim overstated the truth by 44% before this.
 */
export const RAN_OUT_PCT = 0.02;
export const RAN_OUT_MIN_LB = 0.5;
export function ranOut(s: Pick<SaleRecord, 'soldOutAt' | 'leftoverLb' | 'cookedLb' | 'closed'>): boolean {
  if (trustedSoldOutAt(s) != null) return true;
  return isClosedRow(s) && s.cookedLb > 0 && s.leftoverLb <= Math.max(RAN_OUT_MIN_LB, RAN_OUT_PCT * s.cookedLb);
}

/** What the Close screen's leftover box starts with: the saved figure for a closed night, blank otherwise (never a fake 0). */
export const leftoverDraftText = (s: Pick<SaleRecord, 'leftoverLb' | 'closed'> | undefined): string =>
  s && isClosedRow(s) ? String(s.leftoverLb) : '';

export type CloseCheck =
  | { kind: 'skip' }
  | { kind: 'error'; error: string }
  | { kind: 'ok'; leftover: number; catering: number; warning: string | null };

/**
 * Validate one meat's Close entries. Pure, so every rule is testable.
 *  - nothing planned, nothing typed, no row yet: skip (nothing to record)
 *  - every weight is a plain non-negative number no bigger than MAX_LB
 *  - leftover is REQUIRED whenever anything was cooked: a blank is not "0". A blank saved as 0 reads as "sold exactly what
 *    was cooked" and teaches the forecast the wrong demand (Z finding F7b)
 *  - leftover + catering cannot exceed what was cooked (F7)
 *  - an 86 that contradicts a big leftover is allowed but warned about, and the 86 time is then ignored (F8)
 */
export function closeCheck(a: {
  name: string;
  hasPlan: boolean;
  hasRow: boolean;
  cookedText: string; // what was typed when there is no plan
  cooked: number | null; // from the plan, or the parsed typed figure
  leftoverText: string;
  cateringText: string;
  soldOutAt: number | null;
}): CloseCheck {
  if (!a.hasPlan && !a.hasRow && a.cookedText.trim() === '') return { kind: 'skip' };
  const cat = parseNum(a.cateringText);
  if (a.cooked === null || cat === null) return { kind: 'error', error: `${a.name}: enter plain numbers (no negatives).` };
  const blank = a.leftoverText.trim() === '';
  if (blank && a.cooked > 0) return { kind: 'error', error: `${a.name}: enter the leftover (tap "None left" if there was none).` };
  const left = blank ? 0 : parseNum(a.leftoverText);
  if (left === null) return { kind: 'error', error: `${a.name}: enter plain numbers (no negatives).` };
  if (a.cooked > MAX_LB || left > MAX_LB || cat > MAX_LB) return { kind: 'error', error: `${a.name}: number too big.` };
  if (left + cat > a.cooked + 0.001) {
    return { kind: 'error', error: `${a.name}: leftover + catering is more than the ${fmtLb(a.cooked)} cooked.` };
  }
  const warning = a.soldOutAt != null && left > soldOutContradictionLb(a.cooked)
    ? `${a.name}: you tapped 86 but ${fmtLb(left)} is left. Saved. Pitcall will ignore the 86 time for this night.`
    : null;
  return { kind: 'ok', leftover: left, catering: cat, warning };
}

/** Why a Service tap must be refused for this row, or null. "Half gone" after the 86 would store a time later than the sell-out. */
export function stampBlocked(row: Pick<SaleRecord, 'soldOutAt'> | null | undefined, field: 'soldOutAt' | 'halfGoneAt'): string | null {
  if (field === 'halfGoneAt' && row && row.soldOutAt != null) return 'Already 86d. "Half gone" has to come before the 86.';
  return null;
}

export const MIN_HALF_GONE_TAPS = 14;

export function halfGoneMedian(sales: SaleRecord[]): number | null {
  // Ignore impossible taps (a half-gone time later than the same night's sell-out) already sitting in old data.
  const taps = sales
    .filter((s) => s.halfGoneAt != null && (s.soldOutAt == null || s.halfGoneAt <= s.soldOutAt))
    .map((s) => s.halfGoneAt as number);
  return taps.length >= MIN_HALF_GONE_TAPS ? median(taps) : null;
}

/** Turn this meat's sale records into recovered-demand day points (only days before beforeDate). */
export function buildHistory(a: {
  meat: Meat; settings: Settings; sales: SaleRecord[]; plans: PlanRecord[]; beforeDate: string;
}): DayPoint[] {
  // Nights the owner marked unusual (storm, event, closed early) are real but must not teach the forecast.
  const mine = a.sales.filter((s) => s.meatId === a.meat.id && !s.unusual);
  const F = curveF(a.settings.curve, a.settings.openHour, a.settings.closeHour, halfGoneMedian(mine));
  const out: DayPoint[] = [];
  const planByDate = new Map<string, PlanRecord>();
  for (const p of a.plans) if (p.meatId === a.meat.id && p.accepted) planByDate.set(p.date, p);
  for (const s of mine) {
    if (s.date >= a.beforeDate || s.cookedLb <= 0 || !hasDemandSignal(s)) continue;
    const plan = planByDate.get(s.date);
    const mean = plan && plan.mean > 0 ? plan.mean : a.meat.usualGuess;
    const sigma = plan && plan.sigma > 0 ? plan.sigma : Math.max(1, 0.3 * a.meat.usualGuess);
    const r = recoverDemand({ soldLb: walkInSold(s), soldOutAt: trustedSoldOutAt(s), F, mean, sigma });
    out.push({ date: s.date, demandLb: r.demandLb });
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : 1));
}

export function computeMeatCount(a: {
  meat: Meat; settings: Settings; sales: SaleRecord[]; plans: PlanRecord[]; date: string; cateringLb: number;
}): { forecast: Forecast; result: CountResult } {
  const history = buildHistory({ ...a, beforeDate: a.date });
  const forecast = forecastDemand({ history, date: a.date, usualGuess: a.meat.usualGuess });
  const result = chooseCount({
    mean: forecast.mean, sigma: forecast.sigma, meat: a.meat, settings: a.settings, cateringLb: a.cateringLb,
  });
  return { forecast, result };
}

// ---------------------------------------------------------------- cook times
export interface CookRow { id: string; meatId: string; rawWeight: number; putOnMs: number; pullMs: number | null }

export function completedCooks(cooks: CookRow[], meatId?: string): CookRecord[] {
  const out: CookRecord[] = [];
  for (const c of cooks) {
    if (meatId && c.meatId !== meatId) continue;
    if (c.pullMs == null) continue;
    const h = (c.pullMs - c.putOnMs) / 3600000;
    if (h < 0.25 || h > 72) continue; // ignore fat-finger cooks
    out.push({ id: c.id, meatId: c.meatId, rawWeight: c.rawWeight, putOnMs: c.putOnMs, pullMs: c.pullMs });
  }
  return out;
}
const hoursOf = (c: CookRecord) => (c.pullMs - c.putOnMs) / 3600000;

export interface PutOnGroup { at: Date; pieces: number; holdHours: number }

export function putOnGroups(a: {
  meat: Meat; settings: Settings; cooks: CookRow[]; serviceDate: string; pieces: number;
}): PutOnGroup[] {
  if (a.pieces <= 0) return [];
  const done = completedCooks(a.cooks, a.meat.id).map((c) => ({ rawWeight: c.rawWeight, hours: hoursOf(c) }));
  const fit = fitCookTime(done, a.meat.cookHoursGuess);
  const list = planPutOn({
    serviceDate: a.serviceDate, pieces: a.pieces, rawWeight: a.meat.rawWeight, fit,
    openHour: a.settings.openHour, restHours: a.settings.restHours, z: a.settings.onTimeZ,
  });
  const groups: PutOnGroup[] = [];
  for (const p of list) {
    const key = Math.round(p.putOnAt.getTime() / 60000);
    const g = groups.find((x) => Math.round(x.at.getTime() / 60000) === key);
    if (g) g.pieces += 1;
    else groups.push({ at: p.putOnAt, pieces: 1, holdHours: p.holdHours });
  }
  return groups;
}

/** Mean |actual - predicted| hours, each cook predicted by a fit without itself. */
export function cookAccuracy(cooks: CookRow[], meats: Meat[]): { n: number; avgErrHours: number } | null {
  const done = completedCooks(cooks).sort((a, b) => b.putOnMs - a.putOnMs).slice(0, 30);
  const errs: number[] = [];
  for (const c of done) {
    const meat = meats.find((m) => m.id === c.meatId);
    if (!meat) continue;
    const others = done.filter((o) => o.id !== c.id && o.meatId === c.meatId).map((o) => ({ rawWeight: o.rawWeight, hours: hoursOf(o) }));
    const fit = fitCookTime(others, meat.cookHoursGuess);
    errs.push(Math.abs(hoursOf(c) - fit.T(c.rawWeight)));
  }
  if (!errs.length) return null;
  return { n: errs.length, avgErrHours: errs.reduce((s, x) => s + x, 0) / errs.length };
}

// ---------------------------------------------------------------- dollar sentence
export function dollarSentence(a: {
  result: CountResult; pieces: number; ownerPieces: number | null;
}): string {
  const row = (n: number) => a.result.table[n] ?? null;
  const mine = row(a.pieces);
  if (!mine) return `Cooking ${a.pieces} is outside the table Pitcall can price.`;
  const risk = `about ${Math.round(mine.pSellOut * 100)}% chance of selling out, ${fmtLb(mine.expLeftoverLb)} left over`;
  const owner = a.ownerPieces != null ? row(a.ownerPieces) : null;
  if (owner && a.ownerPieces !== a.pieces) {
    const d = mine.profit - owner.profit;
    const cmp = Math.abs(d) < 0.5 ? 'about the same as' : `${fmtMoney(Math.abs(d))} ${d > 0 ? 'more' : 'less'} than`;
    return `${a.pieces} should earn about ${fmtMoney(mine.profit)}, ${cmp} your ${a.ownerPieces} (${risk}).`;
  }
  return `${a.pieces} should earn about ${fmtMoney(mine.profit)} (${risk}).`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ---------------------------------------------------------------- week summary
export interface WeekSummary {
  from: string; to: string;
  savedTotal: number; savedCount: number;
  thrownLb: number; thrownDollars: number;
  soldOutByMeat: { meatId: string; name: string; times: number; days: number }[];
}

export function weekSummary(a: {
  today: string; meats: Meat[]; settings: Settings; plans: PlanRecord[]; sales: SaleRecord[];
}): WeekSummary {
  const from = addDays(a.today, -6);
  const inWin = (d: string) => d >= from && d <= a.today;
  const meatOf = (id: string) => a.meats.find((m) => m.id === id);
  let savedTotal = 0;
  let savedCount = 0;
  for (const p of a.plans) {
    if (!inWin(p.date) || p.ownerPieces == null || !p.accepted) continue;
    const meat = meatOf(p.meatId);
    const s = a.sales.find((x) => x.date === p.date && x.meatId === p.meatId);
    if (!meat || !s || !hasDemandSignal(s)) continue; // an unclosed, not-sold-out night has no real demand figure yet
    savedTotal += savedVsOwner({
      ownerPieces: p.ownerPieces, pitcallPieces: p.pitcallPieces, yPerPiece: p.yPerPiece, cateringLb: s.cateringLb,
      walkInSoldLb: walkInSold(s), soldOut: ranOut(s), meat, settings: a.settings,
    });
    savedCount += 1;
  }
  let thrownLb = 0;
  let thrownDollars = 0;
  const tally = new Map<string, { times: number; days: number }>();
  for (const s of a.sales) {
    if (!inWin(s.date)) continue;
    const meat = meatOf(s.meatId);
    if (!meat || !hasDemandSignal(s)) continue; // tap-only rows are not nights we can count
    if (s.leftoverLb > 0 && (s.leftoverUse === 'binned' || s.leftoverUse == null)) {
      thrownLb += s.leftoverLb;
      thrownDollars += s.leftoverLb * (meat.rawCost / meat.yield);
    }
    let t = tally.get(s.meatId);
    if (!t) tally.set(s.meatId, (t = { times: 0, days: 0 }));
    t.days += 1;
    if (trustedSoldOutAt(s) != null) t.times += 1;
  }
  const soldOutByMeat = a.meats
    .filter((m) => tally.has(m.id))
    .map((m) => ({ meatId: m.id, name: m.name, ...(tally.get(m.id) as { times: number; days: number }) }));
  return { from, to: a.today, savedTotal, savedCount, thrownLb, thrownDollars, soldOutByMeat };
}

/**
 * How the Week screen words the savings figure. The figure is a deliberately cautious lower bound (when a meat runs out the app
 * cannot see what would have sold, so it counts the worst case against itself). Simulation: that bound is negative in over half
 * of weeks even when the true gain is large. A negative bound is therefore "cannot prove a gain", never "Pitcall cost you".
 */
export function moneyHeadline(savedTotal: number, savedCount: number): { kind: 'gain' | 'unproven'; amount: number } {
  if (savedCount > 0 && savedTotal < 0) return { kind: 'unproven', amount: 0 };
  return { kind: 'gain', amount: Math.max(0, savedTotal) };
}

// ---------------------------------------------------------------- backup (untrusted-input validator)
export const BACKUP_APP = 'pitcall-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 5_000_000;
export const MAX_MEATS = 50;
export const MAX_ROWS = 20000;

export type LeftoverUse = 'chopped' | 'chili' | 'staff' | 'binned';

export interface BackupData {
  meats: Meat[];
  plans: PlanRecord[];
  sales: SaleRecord[];
  cooks: CookRow[];
  settings: Settings;
}
export interface BackupFile extends BackupData { app: string; version: number; exportedAt: string }

export function buildBackup(d: BackupData, now: Date): BackupFile {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), ...d };
}

type R<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;

function num(o: Record<string, unknown>, k: string, min: number, max: number, opt?: { int?: boolean; exMin?: boolean }): number | null {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (opt?.exMin ? v <= min : v < min) return null;
  if (v > max) return null;
  if (opt?.int && !Number.isInteger(v)) return null;
  return v;
}
function numOrNull(o: Record<string, unknown>, k: string, min: number, max: number, opt?: { int?: boolean }): number | null | undefined {
  if (o[k] === null) return null;
  const v = num(o, k, min, max, opt);
  return v === null ? undefined : v;
}
function str(o: Record<string, unknown>, k: string, maxLen: number, re?: RegExp): string | null {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0 || v.length > maxLen) return null;
  if (re && !re.test(v)) return null;
  return v;
}
/** An optional true/false field: absent is fine (old backups), anything else that is not a boolean is not. */
function optBool(o: Record<string, unknown>, k: string): { ok: true; v: boolean | undefined } | { ok: false } {
  const v = o[k];
  if (v === undefined) return { ok: true, v: undefined };
  return typeof v === 'boolean' ? { ok: true, v } : { ok: false };
}
const ID_RE = /^[A-Za-z0-9_-]+$/;
/** Ids end up as object keys all over the UI; '__proto__', 'constructor', 'toString'... must never be accepted. */
const reservedId = (id: string) => id in Object.prototype;

function checkMeat(x: unknown, i: number): R<Meat> {
  const w = `meats[${i}]`;
  if (!isObj(x)) return bad(`${w} is not an object`);
  const id = str(x, 'id', 64, ID_RE);
  if (id === null || reservedId(id)) return bad(`${w}.id invalid`);
  const name = str(x, 'name', 60);
  if (name === null) return bad(`${w}.name invalid`);
  const m: Meat = {
    id, name, rawCost: 0, price: 0, rawWeight: 1, yield: 1, slots: 1, leftoverValue: 0, leftoverCap: 0, usualGuess: 0, cookHoursGuess: 1, sort: 0,
  };
  const spec: [keyof Meat, number, number, { int?: boolean; exMin?: boolean }?][] = [
    ['rawCost', 0, 1000], ['price', 0, 1000], ['rawWeight', 0, 500, { exMin: true }], ['yield', 0, 1, { exMin: true }],
    ['slots', 0, 100, { exMin: true }], ['leftoverValue', 0, 1000], ['leftoverCap', 0, 10000], ['usualGuess', 0, 10000],
    ['cookHoursGuess', 0, 72, { exMin: true }], ['sort', 0, 1000, { int: true }],
  ];
  for (const [k, lo, hi, o] of spec) {
    const v = num(x, k, lo, hi, o);
    if (v === null) return bad(`${w}.${k} out of range`);
    (m[k] as number) = v;
  }
  return { ok: true, value: m };
}

function checkSettings(x: unknown): R<Settings> {
  if (!isObj(x)) return bad('settings is not an object');
  const g = (k: string, lo: number, hi: number, o?: { int?: boolean; exMin?: boolean }) => num(x, k, lo, hi, o);
  const smokerSlots = g('smokerSlots', 0, 1000, { int: true, exMin: true });
  const cardFee = g('cardFee', 0, 0.5);
  const packaging = g('packaging', 0, 100);
  const openHour = g('openHour', 0, 24);
  const closeHour = g('closeHour', 0, 24);
  const restHours = g('restHours', 0, 24);
  const onTimeZ = g('onTimeZ', 0, 5);
  // Settings saved before this field existed have none: they get the default. A present but out-of-range value is rejected.
  const lostSaleShare = x.lostSaleShare === undefined ? DEFAULT_LOST_SALE_SHARE : g('lostSaleShare', 0.4, 1);
  if ([lostSaleShare, smokerSlots, cardFee, packaging, openHour, closeHour, restHours, onTimeZ].some((v) => v === null)) return bad('settings has an out-of-range value');
  if ((closeHour as number) <= (openHour as number)) return bad('settings: close must be after open');
  if (!isCurve(x.curve)) return bad('settings.curve invalid');
  return {
    ok: true,
    value: {
      smokerSlots: smokerSlots as number, cardFee: cardFee as number, packaging: packaging as number, openHour: openHour as number,
      closeHour: closeHour as number, restHours: restHours as number, curve: x.curve, onTimeZ: onTimeZ as number,
      lostSaleShare: lostSaleShare as number,
    },
  };
}

export function validateBackup(input: unknown): R<BackupData> {
  if (!isObj(input)) return bad('Backup is not a JSON object');
  if (input.app !== BACKUP_APP) return bad('Not a Pitcall backup file');
  if (input.version !== BACKUP_VERSION) return bad('Unsupported backup version');
  for (const k of ['meats', 'plans', 'sales', 'cooks'] as const) {
    const v = input[k];
    if (!Array.isArray(v)) return bad(`${k} must be a list`);
    if (v.length > (k === 'meats' ? MAX_MEATS : MAX_ROWS)) return bad(`${k} has too many rows`);
  }
  const meats: Meat[] = [];
  const ids = new Set<string>();
  for (const [i, x] of (input.meats as unknown[]).entries()) {
    const r = checkMeat(x, i);
    if (!r.ok) return r;
    if (ids.has(r.value.id)) return bad(`duplicate meat id ${r.value.id}`);
    ids.add(r.value.id);
    meats.push(r.value);
  }
  const settingsR = checkSettings(input.settings);
  if (!settingsR.ok) return settingsR;

  const plans: PlanRecord[] = [];
  const planKeys = new Set<string>();
  for (const [i, x] of (input.plans as unknown[]).entries()) {
    const w = `plans[${i}]`;
    if (!isObj(x)) return bad(`${w} is not an object`);
    const meatId = str(x, 'meatId', 64, ID_RE);
    if (meatId === null || !ids.has(meatId)) return bad(`${w}.meatId unknown`);
    if (!isValidDateStr(x.date)) return bad(`${w}.date invalid`);
    const key = `${x.date}|${meatId}`;
    if (planKeys.has(key)) return bad(`${w} duplicates another plan`);
    planKeys.add(key);
    const owner = numOrNull(x, 'ownerPieces', 0, 10000, { int: true });
    const pitcall = num(x, 'pitcallPieces', 0, 10000, { int: true });
    const lo = num(x, 'rangeLo', 0, 10000, { int: true });
    const hi = num(x, 'rangeHi', 0, 10000, { int: true });
    const fin = num(x, 'finalPieces', 0, 10000, { int: true });
    const mean = num(x, 'mean', 0, 100000);
    const sigma = num(x, 'sigma', 0, 100000);
    const cr = num(x, 'cr', 0, 1);
    const cat = num(x, 'cateringLb', 0, 100000);
    const y = num(x, 'yPerPiece', 0, 500);
    if (owner === undefined || pitcall === null || lo === null || hi === null || fin === null || mean === null || sigma === null || cr === null || cat === null || y === null) {
      return bad(`${w} has an invalid number`);
    }
    if (hi < lo) return bad(`${w} range inverted`);
    if (typeof x.accepted !== 'boolean') return bad(`${w}.accepted must be true/false`);
    plans.push({ date: x.date, meatId, ownerPieces: owner, pitcallPieces: pitcall, rangeLo: lo, rangeHi: hi, finalPieces: fin, mean, sigma, cr, cateringLb: cat, yPerPiece: y, accepted: x.accepted });
  }

  const sales: SaleRecord[] = [];
  const saleKeys = new Set<string>();
  for (const [i, x] of (input.sales as unknown[]).entries()) {
    const w = `sales[${i}]`;
    if (!isObj(x)) return bad(`${w} is not an object`);
    const meatId = str(x, 'meatId', 64, ID_RE);
    if (meatId === null || !ids.has(meatId)) return bad(`${w}.meatId unknown`);
    if (!isValidDateStr(x.date)) return bad(`${w}.date invalid`);
    const key = `${x.date}|${meatId}`;
    if (saleKeys.has(key)) return bad(`${w} duplicates another sale`);
    saleKeys.add(key);
    const cooked = num(x, 'cookedLb', 0, 100000);
    const left = num(x, 'leftoverLb', 0, 100000);
    const cat = num(x, 'cateringLb', 0, 100000);
    const so = numOrNull(x, 'soldOutAt', 0, 48);
    const hg = numOrNull(x, 'halfGoneAt', 0, 48);
    if (cooked === null || left === null || cat === null || so === undefined || hg === undefined) return bad(`${w} has an invalid number`);
    const use = x.leftoverUse;
    if (use !== null && use !== 'chopped' && use !== 'chili' && use !== 'staff' && use !== 'binned') return bad(`${w}.leftoverUse invalid`);
    const closed = optBool(x, 'closed');
    const unusual = optBool(x, 'unusual');
    if (!closed.ok) return bad(`${w}.closed must be true/false`);
    if (!unusual.ok) return bad(`${w}.unusual must be true/false`);
    sales.push({
      date: x.date, meatId, cookedLb: cooked, leftoverLb: left, cateringLb: cat, soldOutAt: so, halfGoneAt: hg, leftoverUse: use,
      ...(closed.v === undefined ? {} : { closed: closed.v }),
      ...(unusual.v === undefined ? {} : { unusual: unusual.v }),
    });
  }

  const cooks: CookRow[] = [];
  const cookIds = new Set<string>();
  const MS_MIN = Date.UTC(2000, 0, 1);
  const MS_MAX = Date.UTC(2200, 0, 1);
  for (const [i, x] of (input.cooks as unknown[]).entries()) {
    const w = `cooks[${i}]`;
    if (!isObj(x)) return bad(`${w} is not an object`);
    const id = str(x, 'id', 64, ID_RE);
    if (id === null || reservedId(id) || cookIds.has(id)) return bad(`${w}.id invalid or duplicate`);
    cookIds.add(id);
    const meatId = str(x, 'meatId', 64, ID_RE);
    if (meatId === null || !ids.has(meatId)) return bad(`${w}.meatId unknown`);
    const rw = num(x, 'rawWeight', 0, 500, { exMin: true });
    const on = num(x, 'putOnMs', MS_MIN, MS_MAX);
    const pull = numOrNull(x, 'pullMs', MS_MIN, MS_MAX);
    if (rw === null || on === null || pull === undefined) return bad(`${w} has an invalid number`);
    if (pull !== null && pull < on) return bad(`${w} pulled before put on`);
    cooks.push({ id, meatId, rawWeight: rw, putOnMs: on, pullMs: pull });
  }
  return { ok: true, value: { meats, plans, sales, cooks, settings: settingsR.value } };
}

/** Parse + validate raw backup text. Never throws. */
export function parseBackupText(text: string): R<BackupData> {
  if (typeof text !== 'string') return bad('Unreadable file');
  if (text.length > MAX_BACKUP_BYTES) return bad('Backup file is too large');
  let json: unknown;
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); // tolerate a UTF-8 BOM
  } catch {
    return bad('File is not valid JSON');
  }
  return validateBackup(json);
}
