import { describe, expect, it } from 'vitest';
import { DUR, STAGGER_CAP, STAGGER_MS, countDuration, staggerDelay, tabIndicatorX, tabWidthOf } from './motionMath';

describe('motion math', () => {
  it('staggers cards in order and stops adding delay after the cap', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBe(STAGGER_MS);
    expect(staggerDelay(STAGGER_CAP)).toBe(STAGGER_CAP * STAGGER_MS);
    expect(staggerDelay(50)).toBe(STAGGER_CAP * STAGGER_MS);
  });

  it('treats bad stagger indexes as no delay', () => {
    expect(staggerDelay(NaN)).toBe(0);
    expect(staggerDelay(Infinity)).toBe(0);
    expect(staggerDelay(-3)).toBe(0);
    expect(staggerDelay(2.9)).toBe(2 * STAGGER_MS);
  });

  it('keeps count-up time between 240 and 700 ms whatever the size of the move', () => {
    for (const d of [0, 1, -1, 10, -40, 1000, -99999, NaN, Infinity]) {
      const t = countDuration(d);
      expect(t).toBeGreaterThanOrEqual(240);
      expect(t).toBeLessThanOrEqual(700);
    }
    expect(countDuration(1000)).toBe(700);
    expect(countDuration(0)).toBe(240);
    expect(countDuration(-20)).toBe(countDuration(20));
  });

  it('never makes a press slower than the other motions', () => {
    expect(DUR.press).toBeLessThan(DUR.quick);
    expect(DUR.quick).toBeLessThan(DUR.base);
    expect(DUR.base).toBeLessThan(DUR.slow);
  });

  it('splits the tab bar after leaving room for the gear', () => {
    expect(tabWidthOf(400, 60, 4)).toBe(85);
    expect(tabWidthOf(40, 60, 4)).toBe(0);
    expect(tabWidthOf(400, 60, 0)).toBe(0);
    expect(tabWidthOf(NaN, 60, 4)).toBe(0);
  });

  it('puts the tab marker under the active tab and clamps wild indexes', () => {
    expect(tabIndicatorX(0, 85, 4)).toBe(0);
    expect(tabIndicatorX(2, 85, 4)).toBe(170);
    expect(tabIndicatorX(9, 85, 4)).toBe(255);
    expect(tabIndicatorX(-1, 85, 4)).toBe(0);
    expect(tabIndicatorX(NaN, 85, 4)).toBe(0);
    expect(tabIndicatorX(1, -5, 4)).toBe(0);
  });
});
