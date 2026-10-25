// The numbers behind the motion layer. No react-native imports here, so vitest can check them.

/** Durations in ms. Feedback is fast so a gloved tap never feels like it is waiting on the screen. */
export const DUR = { press: 90, quick: 160, base: 240, slow: 360 } as const;

/** Cards on a screen arrive one after another, but never more than STAGGER_CAP steps late. */
export const STAGGER_MS = 40;
export const STAGGER_CAP = 6;

export function staggerDelay(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.floor(index)), STAGGER_CAP) * STAGGER_MS;
}

/** How long a number takes to count to its new value: short for small moves, capped so a big dollar figure is not a show. */
export function countDuration(delta: number): number {
  if (!Number.isFinite(delta)) return 240;
  return Math.min(700, Math.max(240, 160 + Math.abs(delta) * 12));
}

/** Width of one tab when the bar is `totalWidth` wide and `reserved` px at the end belong to something else (the gear). */
export function tabWidthOf(totalWidth: number, reserved: number, count: number): number {
  if (!(count > 0) || !Number.isFinite(totalWidth)) return 0;
  return Math.max(0, totalWidth - reserved) / count;
}

/** Left edge of the moving tab marker for tab `index`. */
export function tabIndicatorX(index: number, tabWidth: number, count: number): number {
  const i = Math.min(Math.max(0, Math.round(Number.isFinite(index) ? index : 0)), Math.max(0, count - 1));
  return i * Math.max(0, tabWidth);
}
