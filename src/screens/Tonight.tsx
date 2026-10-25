import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CountText, FadeSlide, Pop, PressScale } from '../motion';
import { DUR, staggerDelay } from '../motionMath';
import type { PlanRecord } from '../types';
import { fitToSlots } from '../engine';
import * as db from '../db';
import { ensurePermission, replaceSchedule, type Alarm } from '../notify';
import { C, F } from '../theme';
import { useStore } from '../store';
import { Btn, Card, H, NumField, T } from '../ui';
import {
  addDays, clamp, computeMeatCount, defaultServiceDate, dollarSentence, fmtDateTime, fmtDay, fmtLb, newId, parseNum, putOnGroups,
} from '../logic';

function parseOwner(s: string): number | null | 'bad' {
  if (s.trim() === '') return null;
  const v = parseNum(s);
  if (v === null || !Number.isInteger(v) || v > 10000) return 'bad';
  return v;
}

export default function Tonight() {
  const st = useStore();
  const { meats, settings, plans, sales, cooks, run } = st;
  const [date, setDate] = useState(() => defaultServiceDate(new Date()));
  const [owner, setOwner] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [catering, setCatering] = useState<Record<string, string>>({});
  const [override, setOverride] = useState<Record<string, number>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hydratedFor = useRef<string | null>(null);

  // Hydrate inputs from an already-accepted plan whenever the service date changes (or data first loads).
  useEffect(() => {
    if (!st.ready || hydratedFor.current === date) return;
    hydratedFor.current = date;
    const o: Record<string, string> = {};
    const r: Record<string, boolean> = {};
    const c: Record<string, string> = {};
    const f: Record<string, number> = {};
    for (const p of plans) {
      if (p.date !== date || !p.accepted) continue;
      if (p.ownerPieces != null) o[p.meatId] = String(p.ownerPieces);
      r[p.meatId] = true;
      if (p.cateringLb > 0) c[p.meatId] = String(p.cateringLb);
      f[p.meatId] = p.finalPieces;
    }
    setOwner(o); setRevealed(r); setCatering(c); setOverride(f); setNote(null);
  }, [date, plans, st.ready]);

  const cateringOf = (id: string) => {
    const v = parseNum(catering[id] ?? '');
    return v === null ? 0 : v;
  };

  const calc = useMemo(() => {
    const results: Record<string, ReturnType<typeof computeMeatCount>> = {};
    for (const m of meats) {
      try {
        const c = parseNum(catering[m.id] ?? '');
        results[m.id] = computeMeatCount({ meat: m, settings, sales, plans, date, cateringLb: c === null ? 0 : c });
      } catch { /* skip a meat whose numbers the engine rejects */ }
    }
    const only = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.result]));
    const fitted = fitToSlots(only, meats.filter((m) => results[m.id]), settings.smokerSlots);
    return { results, fitted };
  }, [meats, settings, sales, plans, date, catering]);

  const finalOf = (id: string) => {
    const o = override[id];
    return o !== undefined ? o : calc.fitted[id] ?? 0;
  };
  const planFor = (id: string) => plans.find((p) => p.date === date && p.meatId === id && p.accepted);
  const allRevealed = meats.length > 0 && meats.every((m) => revealed[m.id] || !calc.results[m.id]);
  const ownerBad = meats.some((m) => parseOwner(owner[m.id] ?? '') === 'bad');

  const accept = async () => {
    if (ownerBad) { st.setError('"Your number" must be a whole number of pieces.'); return; }
    setBusy(true);
    setNote(null);
    await run(async () => {
      const now = new Date();
      const rows: PlanRecord[] = [];
      const alarms: Alarm[] = [];
      for (const m of meats) {
        const c = calc.results[m.id];
        if (!c) continue;
        const fin = finalOf(m.id);
        const o = parseOwner(owner[m.id] ?? '');
        rows.push({
          date, meatId: m.id, ownerPieces: o === 'bad' ? null : o, pitcallPieces: c.result.nStar,
          rangeLo: c.result.rangeLo, rangeHi: c.result.rangeHi, finalPieces: fin, mean: c.forecast.mean, sigma: c.forecast.sigma,
          cr: c.result.cr, cateringLb: cateringOf(m.id), yPerPiece: c.result.Y, accepted: true,
        });
        for (const g of putOnGroups({ meat: m, settings, cooks, serviceDate: date, pieces: fin })) {
          alarms.push({ at: g.at, title: `Put on ${g.pieces} ${m.name}`, body: `Load ${g.pieces} now so it is ready for ${fmtDay(date)} service.` });
        }
      }
      await db.savePlans(rows);
      let msg = 'Plan saved.';
      try {
        const future = alarms.filter((a) => a.at.getTime() > now.getTime() + 5000);
        let perm = 'granted';
        if (future.length) perm = await ensurePermission();
        if (perm === 'granted') {
          const n = await replaceSchedule(date, alarms, now);
          msg += n ? ` ${n} put-on alarm${n === 1 ? '' : 's'} set.` : ' No put-on times are in the future, so no alarms.';
        } else {
          await replaceSchedule(date, [], now); // still cancel any stale alarms for this date
          msg += perm === 'denied'
            ? ' Notifications are OFF, so no alarms were set. Turn them on in phone settings.'
            : ' Alarms are not available on this device.';
        }
      } catch (e) {
        // The plan is already saved; an alarm failure must not leave the screen showing a stale, unsaved plan.
        msg += ` BUT the alarms could not be set (${e instanceof Error ? e.message : String(e)}). Set them by hand.`;
      }
      await st.reload();
      setNote(msg);
    });
    setBusy(false);
  };

  const openCook = (id: string) => [...cooks].reverse().find((c) => c.meatId === id && c.pullMs == null);
  const markCook = async (id: string) => {
    await run(async () => {
      const m = meats.find((x) => x.id === id);
      if (!m) return;
      const open = openCook(id);
      if (open) await db.saveCook({ ...open, pullMs: Date.now() });
      else await db.saveCook({ id: newId(), meatId: id, rawWeight: m.rawWeight, putOnMs: Date.now(), pullMs: null });
      await st.reload();
    });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <PressScale scaleTo={0.85} accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => setDate(addDays(date, -1))} style={{ padding: 12 }}><Text style={{ color: C.amber, fontSize: 36 }}>{'<'}</Text></PressScale>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: C.muted, fontSize: 16 }}>Cooking for</Text>
          {/* keyed on the date, so the day name slides in fresh each time it changes */}
          <FadeSlide key={date} dy={8} duration={DUR.quick}><H>{fmtDay(date)}</H></FadeSlide>
        </View>
        <PressScale scaleTo={0.85} accessibilityRole="button" accessibilityLabel="Next day" onPress={() => setDate(addDays(date, 1))} style={{ padding: 12 }}><Text style={{ color: C.amber, fontSize: 36 }}>{'>'}</Text></PressScale>
      </View>

      {meats.length === 0 ? <T muted>No meats yet. Add some in Settings (gear).</T> : null}

      {meats.map((m, idx) => {
        const c = calc.results[m.id];
        if (!c) return <Card key={m.id} index={idx}><H>{m.name}</H><T muted>Cannot compute (check this meat in Settings).</T></Card>;
        const shown = !!revealed[m.id];
        const fin = finalOf(m.id);
        const fitted = calc.fitted[m.id] ?? 0;
        const ownerP = parseOwner(owner[m.id] ?? '');
        const groups = shown ? putOnGroups({ meat: m, settings, cooks, serviceDate: date, pieces: fin }) : [];
        const accepted = planFor(m.id);
        const out = shown && (fin < c.result.rangeLo || fin > c.result.rangeHi);
        const oc = openCook(m.id);
        return (
          <Card key={m.id} index={idx}>
            <H>{m.name}</H>
            <NumField
              label="Your number (pieces)"
              value={owner[m.id] ?? ''}
              onChange={(v) => setOwner({ ...owner, [m.id]: v })}
              editable={!shown}
              unit="pcs"
            />
            {!shown ? (
              <Btn label="Show Pitcall's number" onPress={() => setRevealed({ ...revealed, [m.id]: true })} />
            ) : (
              <FadeSlide dy={10} style={{ marginTop: 12 }}>
                <T muted>Pitcall says</T>
                {/* counts up from 0 when the number is revealed, and counts to the new figure if catering changes it */}
                <CountText from={0} value={c.result.nStar} style={{ color: C.amber, fontSize: 64, fontWeight: '900' }} />
                <T>Good range: {c.result.rangeLo} to {c.result.rangeHi} pieces</T>
                {fitted < c.result.nStar ? (
                  <FadeSlide dy={6}>
                    <Text style={{ color: C.red, fontSize: F.body, fontWeight: '700', marginTop: 6 }}>
                      Smoker full: cooking {fitted} instead of {c.result.nStar}
                    </Text>
                  </FadeSlide>
                ) : null}
                <T style={{ marginTop: 8 }}>{dollarSentence({ result: c.result, pieces: fin, ownerPieces: ownerP === 'bad' ? null : ownerP })}</T>
                <T muted>Forecast {fmtLb(c.forecast.mean)} walk-in, give or take {fmtLb(c.forecast.sigma)}.</T>
                <NumField
                  label="Catering lb (optional)"
                  value={catering[m.id] ?? ''}
                  onChange={(v) => setCatering({ ...catering, [m.id]: v })}
                  step={5}
                  unit="lb"
                />
                <View style={{ marginTop: 10 }}>
                  <T muted>Putting on</T>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <PressScale scaleTo={0.88} accessibilityRole="button" accessibilityLabel="One fewer piece" onPress={() => setOverride({ ...override, [m.id]: Math.max(0, fin - 1) })} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: C.amber, fontSize: 36, fontWeight: '800' }}>-</Text>
                    </PressScale>
                    <Pop trigger={fin} from={0.85} style={{ flex: 1 }}>
                      <Text style={{ textAlign: 'center', color: C.text, fontSize: 40, fontWeight: '800' }}>{fin}</Text>
                    </Pop>
                    <PressScale scaleTo={0.88} accessibilityRole="button" accessibilityLabel="One more piece" onPress={() => setOverride({ ...override, [m.id]: clamp(fin + 1, 0, 10000) })} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: C.amber, fontSize: 36, fontWeight: '800' }}>+</Text>
                    </PressScale>
                  </View>
                  {out ? <FadeSlide dy={6}><Text style={{ color: C.amber, fontSize: 16, marginTop: 4 }}>Outside the good range ({c.result.rangeLo} to {c.result.rangeHi}).</Text></FadeSlide> : null}
                </View>
                {groups.map((g, i) => {
                  const past = g.at.getTime() <= Date.now();
                  return (
                    <FadeSlide key={i} dy={8} delay={staggerDelay(i + 2)}>
                      <T style={{ marginTop: 6 }}>
                        Put on {g.pieces} at <Text style={{ fontWeight: '800', color: C.amber }}>{fmtDateTime(g.at, date)}</Text>
                        {' '}(hold {Math.round(g.holdHours * 10) / 10} h){past ? ' - already past' : ''}
                      </T>
                    </FadeSlide>
                  );
                })}
                {accepted && fin > 0 ? (
                  <Btn
                    kind="ghost"
                    small
                    label={oc ? `Mark pulled (on since ${fmtDateTime(new Date(oc.putOnMs), date)})` : 'Mark put on now'}
                    onPress={() => markCook(m.id)}
                  />
                ) : null}
              </FadeSlide>
            )}
          </Card>
        );
      })}

      {meats.length > 0 ? (
        <>
          {!allRevealed ? <T muted style={{ textAlign: 'center' }}>Type your numbers, then show Pitcall's for each meat to accept.</T> : null}
          <Btn label={busy ? 'Saving...' : plans.some((p) => p.date === date && p.accepted) ? 'Update plan' : 'Accept plan'} onPress={accept} disabled={busy || !allRevealed} />
        </>
      ) : null}
      {note ? <FadeSlide key={note} dy={8}><Text style={{ color: C.green, fontSize: F.body, marginTop: 12, textAlign: 'center' }}>{note}</Text></FadeSlide> : null}
    </ScrollView>
  );
}
