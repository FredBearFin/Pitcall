// Free-trial gate: pure logic, no store, no UI, no clock reads (the caller passes today's service date).
//
// The rule from the spec: the trial does not start when the app is installed. It starts after the owner has logged 14 real
// service nights, so it ends only after the forecast has learned the joint. Then the owner gets 30 more days.
//
//   free     fewer than 14 logged service nights
//   trial    the 14th logged night has happened; 30 days from that date
//   expired  trial is over and there is no active subscription
//   subscribed
//
// A "logged service night" is a distinct service date with at least one CLOSED sale row (a night the owner actually closed
// out; a row made only by a Service tap is not one). A night marked unusual still counts: the owner did the work.
//
// What the UI should do when the state is 'expired' (not built yet): block planning new nights, but NEVER lock the owner's
// own data. Backup export and the Week screen stay available, so a lapsed customer can always take their history with them.
//
// This is a client-side gate with no accounts, so a determined person can get around it (reinstall, clear data). That is an
// accepted trade for a $29 to $49 a month tool; the store subscription is the real enforcement.
import { addDays, isClosedRow } from './logic';
import type { SaleRecord } from './types';

export const FREE_SERVICE_NIGHTS = 14;
export const TRIAL_DAYS = 30;

export type Access =
  | { kind: 'free'; loggedNights: number; nightsLeft: number }
  | { kind: 'trial'; endsOn: string; daysLeft: number }
  | { kind: 'expired'; endedOn: string }
  | { kind: 'subscribed' };

/** Distinct service dates that have at least one closed row, oldest first. */
export function loggedServiceDates(sales: Pick<SaleRecord, 'date' | 'closed'>[]): string[] {
  const set = new Set<string>();
  for (const s of sales) if (isClosedRow(s)) set.add(s.date);
  return [...set].sort();
}

const dayNumber = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / 86400000);
};

export function accessState(a: {
  sales: Pick<SaleRecord, 'date' | 'closed'>[];
  /** Today's SERVICE date (before 4 am still belongs to last night), as 'YYYY-MM-DD'. */
  today: string;
  subscribed: boolean;
}): Access {
  if (a.subscribed) return { kind: 'subscribed' };
  const dates = loggedServiceDates(a.sales);
  if (dates.length < FREE_SERVICE_NIGHTS) {
    return { kind: 'free', loggedNights: dates.length, nightsLeft: FREE_SERVICE_NIGHTS - dates.length };
  }
  const endsOn = addDays(dates[FREE_SERVICE_NIGHTS - 1], TRIAL_DAYS);
  // If the phone's clock was set back, never show more than a full trial; and the trial is inclusive of its last day.
  const left = Math.min(TRIAL_DAYS, dayNumber(endsOn) - dayNumber(a.today));
  if (left >= 0) return { kind: 'trial', endsOn, daysLeft: left };
  return { kind: 'expired', endedOn: endsOn };
}
