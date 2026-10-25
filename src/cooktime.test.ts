// Regression test for Z finding F10 / spec W5: a cook-time model is never below 0.25 h, however odd the logged cooks are.
import { describe, expect, it } from 'vitest';
import { fitCookTime } from './engine';

describe('cook time floor (F10)', () => {
  it('two contradictory cooks cannot make a heavy piece take zero or negative time', () => {
    const fit = fitCookTime([{ rawWeight: 10, hours: 12 }, { rawWeight: 12, hours: 4 }], 12);
    for (const w of [1, 6, 10, 14, 16, 18, 20, 40, 100]) expect(fit.T(w)).toBeGreaterThanOrEqual(0.25);
  });

  it('ordinary data is untouched by the floor', () => {
    const fit = fitCookTime([{ rawWeight: 10, hours: 10 }, { rawWeight: 14, hours: 13 }, { rawWeight: 12, hours: 11.5 }], 12);
    expect(fit.T(12)).toBeGreaterThan(8);
    expect(fit.T(12)).toBeLessThan(14);
  });

  it('holds for 2000 random sets of cooks', () => {
    let seed = 20261025;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 2000; i++) {
      const n = 2 + Math.floor(rnd() * 6);
      const cooks = Array.from({ length: n }, () => ({ rawWeight: 2 + rnd() * 18, hours: 0.25 + rnd() * 24 }));
      const fit = fitCookTime(cooks, 1 + rnd() * 16);
      for (const w of [1, 5, 10, 15, 20, 30, 60]) expect(fit.T(w)).toBeGreaterThanOrEqual(0.25);
    }
  });
});
