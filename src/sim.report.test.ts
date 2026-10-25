// Not part of the normal suite: run `PITCALL_SIM=1 npx vitest run src/sim.report.test.ts` to regenerate docs/SIMULATION.results.md.
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { BASE, OWNERS, summarize, type Scenario, type Summary } from './sim';

const run = process.env.PITCALL_SIM ? describe : describe.skip;
const SC: Scenario[] = [
  { ...BASE, label: 'Base: balanced owner (knows the average night, +-20% gut error)' },
  { ...BASE, label: 'Sharp owner (+10% cushion, only +-8% gut error)', owner: { name: 'sharp', bias: 1.1, sd: 0.08 } },
  { ...BASE, label: 'Over-cooker (25% extra so he never runs out)', owner: OWNERS.overcooker },
  { ...BASE, label: 'Under-cooker (15% light)', owner: OWNERS.undercooker },
  { ...BASE, label: 'Typed usual-night guess 30% too high (true = 0.7x guess)', guessError: 0.7 },
  { ...BASE, label: 'Typed usual-night guess 30% too low (true = 1.3x guess)', guessError: 1.3 },
  { ...BASE, label: 'Typed usual-night guess 67% too high (true = 0.6x guess)', guessError: 0.6 },
  { ...BASE, label: 'Typed usual-night guess 33% too low (true = 1.5x guess)', guessError: 1.5 },
  { ...BASE, label: 'Real arrivals are even all day, app assumes lunch rush', trueCurve: 'steady' },
  { ...BASE, label: '10% freak nights (storm / event), not marked unusual', freakRate: 0.1 },
  { ...BASE, label: 'Cook forgets to tap 86 on 60% of sell-outs', tapMissRate: 0.6 },
  { ...BASE, label: 'Very noisy demand (CV 50%)', cv: 0.5 },
  { ...BASE, label: 'Tight smoker (20 slots; seed meats need about 28 on a normal night)', smokerSlots: 20 },
  { ...BASE, label: 'Only 75% of a sell-out is really lost (the rest order another meat)', trueLostShare: 0.75 },
  { ...BASE, label: 'Only 50% of a sell-out is really lost', trueLostShare: 0.5 },
  { ...BASE, label: 'Only 25% of a sell-out is really lost', trueLostShare: 0.25 },
  { ...BASE, label: 'OLD MATH (assumed 100% lost) when 100% is lost', appLostShare: 1, trueLostShare: 1 },
  { ...BASE, label: 'OLD MATH (assumed 100% lost) when only 50% is lost', appLostShare: 1, trueLostShare: 0.5 },
  { ...BASE, label: 'OLD MATH (assumed 100% lost) when only 25% is lost', appLostShare: 1, trueLostShare: 0.25 },
];
const $ = (x: number) => `${x < 0 ? '-' : '+'}$${Math.abs(x).toFixed(0)}`;
run('simulation report', () => {
  it('writes the results table', () => {
    const rows: Summary[] = SC.map((s, i) => summarize({ ...s, restaurants: 150 }, 1000 + i * 100000));
    const L: string[] = [];
    L.push('| Scenario | Wk 1 | Wk 2 | Nights 15-28 | Nights 29-70 | Restaurants ahead (29-70) | Sold-out nights: owner / Pitcall | Leftover lb/night: owner / Pitcall | App "found you" vs truth (70 nights) |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const w = r.windows;
      L.push(`| ${r.scenario.label} | ${$(w[0].mean)} | ${$(w[1].mean)} | ${$(w[2].mean)} | ${$(w[3].mean)} (p10 ${$(w[3].p10)}, p90 ${$(w[3].p90)}) | ${Math.round(w[3].ahead * 100)}% | ${Math.round(r.ownerSellOutRate * 100)}% / ${Math.round(r.pitcallSellOutRate * 100)}% | ${r.ownerLeftoverLb.toFixed(0)} / ${r.pitcallLeftoverLb.toFixed(0)} | claims ${$(r.claimedTotal)}, truth ${$(r.trueTotal)} |`);
    }
    L.push('');
    L.push('Nightly profit level for scale (base): owner $' + rows[0].ownerNightlyProfit.toFixed(0) + ', Pitcall $' + rows[0].pitcallNightlyProfit.toFixed(0) + ' (all five seed meats, 150 simulated restaurants x 70 nights).');
    writeFileSync('/tmp/claude-0/-home-claude/9a04bf03-7a1e-5af0-96b7-2240a1005722/scratchpad/sim-table.md', L.join('\n') + '\n');
    writeFileSync('/tmp/claude-0/-home-claude/9a04bf03-7a1e-5af0-96b7-2240a1005722/scratchpad/sim-rows.json', JSON.stringify(rows, null, 1));
  }, 600000);
});
