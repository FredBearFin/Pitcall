import { describe, expect, it } from 'vitest';
import { addDays } from './logic';
import { accessState, loggedServiceDates, FREE_SERVICE_NIGHTS, TRIAL_DAYS } from './trial';

const night = (date: string, o: { closed?: boolean } = {}) => ({ date, ...o });
/** n consecutive closed nights starting 2026-10-01 */
const nights = (n: number) => Array.from({ length: n }, (_, i) => night(addDays('2026-10-01', i)));
const st = (sales: ReturnType<typeof nights>, today: string, subscribed = false) => accessState({ sales, today, subscribed });

describe('free phase: the trial has not started until 14 nights are logged', () => {
  it('a brand-new install is free with 14 nights to go', () => {
    expect(st([], '2026-10-25')).toEqual({ kind: 'free', loggedNights: 0, nightsLeft: 14 });
  });
  it('13 logged nights is still free, with 1 to go, however many months have passed', () => {
    expect(st(nights(13), '2027-06-01')).toEqual({ kind: 'free', loggedNights: 13, nightsLeft: 1 });
  });
});

describe('trial phase: 30 days from the date of the 14th logged night', () => {
  const sales = nights(14); // the 14th logged night is 2026-10-14
  it('starts on the 14th night with the full 30 days left', () => {
    expect(st(sales, '2026-10-14')).toEqual({ kind: 'trial', endsOn: '2026-11-13', daysLeft: 30 });
  });
  it('counts down day by day, and the last day is still the trial', () => {
    expect(st(sales, '2026-11-12')).toMatchObject({ kind: 'trial', daysLeft: 1 });
    expect(st(sales, '2026-11-13')).toMatchObject({ kind: 'trial', daysLeft: 0 });
  });
  it('is expired the day after, and stays expired', () => {
    expect(st(sales, '2026-11-14')).toEqual({ kind: 'expired', endedOn: '2026-11-13' });
    expect(st(sales, '2027-03-01')).toMatchObject({ kind: 'expired' });
  });
  it('logging more nights during the trial does not extend it', () => {
    expect(st(nights(40), '2026-11-14')).toMatchObject({ kind: 'expired', endedOn: '2026-11-13' });
  });
  it('a phone clock set back never shows more than a full trial', () => {
    expect(st(sales, '2026-09-01')).toMatchObject({ kind: 'trial', daysLeft: TRIAL_DAYS });
  });
});

describe('what counts as a logged night', () => {
  it('a row made only by a Service tap (closed: false) does not count', () => {
    const taps = Array.from({ length: 20 }, (_, i) => night(addDays('2026-10-01', i), { closed: false }));
    expect(st(taps, '2026-10-25')).toMatchObject({ kind: 'free', loggedNights: 0 });
  });
  it('rows from before the closed flag existed (no flag) count as closed', () => {
    expect(loggedServiceDates([night('2026-10-01'), night('2026-10-02', { closed: true })])).toEqual(['2026-10-01', '2026-10-02']);
  });
  it('several meats on the same night are one night', () => {
    const sales = [night('2026-10-01'), night('2026-10-01'), night('2026-10-01'), night('2026-10-02')];
    expect(loggedServiceDates(sales)).toEqual(['2026-10-01', '2026-10-02']);
  });
  it('the order rows arrive in does not matter', () => {
    const sales = nights(14).reverse();
    expect(st(sales, '2026-10-14')).toMatchObject({ kind: 'trial', endsOn: '2026-11-13' });
  });
  it('a night that is closed and also has a tap-only twin on another meat still counts once', () => {
    expect(loggedServiceDates([night('2026-10-01', { closed: false }), night('2026-10-01', { closed: true })])).toEqual(['2026-10-01']);
  });
});

describe('subscribed', () => {
  it('overrides every other state, even an expired trial or an empty history', () => {
    expect(st([], '2026-10-25', true)).toEqual({ kind: 'subscribed' });
    expect(st(nights(14), '2027-01-01', true)).toEqual({ kind: 'subscribed' });
  });
});

describe('constants match the spec', () => {
  it('14 logged nights, then 30 days', () => {
    expect(FREE_SERVICE_NIGHTS).toBe(14);
    expect(TRIAL_DAYS).toBe(30);
  });
});
