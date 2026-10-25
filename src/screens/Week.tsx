import React from 'react';
import { ScrollView, Text } from 'react-native';
import { C } from '../theme';
import { useStore } from '../store';
import { Card, H, T } from '../ui';
import { CountText, usePaneActive } from '../motion';
import { cookAccuracy, fmtDay, fmtLb, fmtMoney, moneyHeadline, serviceClock, weekSummary } from '../logic';

export default function Week() {
  const { meats, settings, plans, sales, cooks } = useStore();
  const active = usePaneActive();
  const today = serviceClock(new Date()).date; // same night rule as Service and Close
  const w = weekSummary({ today, meats, settings, plans, sales });
  const acc = cookAccuracy(cooks, meats);
  const head = moneyHeadline(w.savedTotal, w.savedCount);
  const good = head.kind === 'gain';
  // Keyed on whether this tab is showing, so the money figures count up from zero each time the tab opens.
  const replay = active ? 'on' : 'off';
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <H>Week</H>
      <T muted>{fmtDay(w.from)} to {fmtDay(w.to)}</T>

      <Card index={0} style={{ marginTop: 14 }}>
        <T muted>Money</T>
        {good ? (
          <Text style={{ color: C.green, fontSize: 34, fontWeight: '900', marginTop: 4 }}>
            Pitcall found you <CountText key={replay} from={0} value={head.amount} format={fmtMoney} />
          </Text>
        ) : (
          <Text style={{ color: C.text, fontSize: 24, fontWeight: '800', marginTop: 4 }}>Pitcall can't prove a gain this week</Text>
        )}
        <T muted>
          {w.savedCount === 0
            ? 'Type your own number on Tonight and fill in Close, and this fills in.'
            : good
              ? `Counted over ${w.savedCount} meat-night${w.savedCount === 1 ? '' : 's'} where you typed your number first.`
              : `Counted over ${w.savedCount} meat-night${w.savedCount === 1 ? '' : 's'}. When a meat runs out, Pitcall cannot see what you would have sold, so it counts the worst case against itself. That is not the same as saying your number was better.`}
        </T>
      </Card>

      <Card index={1}>
        <T muted>Thrown away</T>
        <Text style={{ color: C.text, fontSize: 28, fontWeight: '800', marginTop: 4 }}>
          {fmtLb(w.thrownLb)} / <CountText key={replay} from={0} value={w.thrownDollars} format={fmtMoney} />
        </Text>
        <T muted>Binned leftovers at cost. Leftovers that became chopped, chili or staff meals do not count.</T>
      </Card>

      <Card index={2}>
        <T muted>Sold out early</T>
        {w.soldOutByMeat.length === 0 ? <T>No days recorded yet.</T> : null}
        {w.soldOutByMeat.map((r) => (
          <T key={r.meatId}>
            <Text style={{ fontWeight: '800' }}>{r.name}</Text>: {r.times} of {r.days} day{r.days === 1 ? '' : 's'}
          </T>
        ))}
      </Card>

      <Card index={3}>
        <T muted>Cook-time accuracy</T>
        <T>
          {acc
            ? `Off by about ${Math.round(acc.avgErrHours * 10) / 10} hours on average (last ${acc.n} cook${acc.n === 1 ? '' : 's'}).`
            : 'No cooks logged yet. Use "Mark put on now" and "Mark pulled" on Tonight.'}
        </T>
      </Card>
    </ScrollView>
  );
}
