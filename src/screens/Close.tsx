import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { SaleRecord } from '../types';
import * as db from '../db';
import { C, F } from '../theme';
import { useStore } from '../store';
import { Btn, Card, Check, Chips, H, NumField, T } from '../ui';
import { FadeSlide } from '../motion';
import { DUR } from '../motionMath';
import { fmtDay, fmtLb, parseNum, serviceClock, type LeftoverUse } from '../logic';

interface Draft { cooked: string; leftover: string; use: LeftoverUse; catering: string; unusual: boolean }
const USES: { v: LeftoverUse; label: string }[] = [
  { v: 'chopped', label: 'Chopped' }, { v: 'chili', label: 'Chili' }, { v: 'staff', label: 'Staff' }, { v: 'binned', label: 'Binned' },
];

export default function Close() {
  const st = useStore();
  const { meats, plans, sales, run } = st;
  // The service NIGHT being closed, not the calendar day: closing out at 12:30 am is still last night.
  const today = serviceClock(new Date()).date;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const hydrated = useRef<string | null>(null); // date the drafts were built for

  const planOf = (id: string) => plans.find((p) => p.date === today && p.meatId === id && p.accepted);

  useEffect(() => {
    if (!st.ready || hydrated.current === today) return;
    hydrated.current = today; // re-hydrate when the app stays open past midnight
    const d: Record<string, Draft> = {};
    for (const m of meats) {
      const s = sales.find((x) => x.date === today && x.meatId === m.id);
      const p = planOf(m.id);
      d[m.id] = {
        cooked: s && s.cookedLb > 0 ? String(s.cookedLb) : '',
        leftover: s ? String(s.leftoverLb) : '0',
        use: s?.leftoverUse ?? 'binned',
        catering: s ? String(s.cateringLb) : p && p.cateringLb > 0 ? String(p.cateringLb) : '0',
        unusual: s?.unusual ?? false,
      };
    }
    setDrafts(d);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.ready, today]);

  const get = (id: string): Draft => drafts[id] ?? { cooked: '', leftover: '0', use: 'binned', catering: '0', unusual: false };
  const set = (id: string, patch: Partial<Draft>) => setDrafts({ ...drafts, [id]: { ...get(id), ...patch } });
  const cookedOf = (id: string): number | null => {
    const p = planOf(id);
    if (p) return Math.round(p.finalPieces * p.yPerPiece * 10) / 10;
    return parseNum(get(id).cooked);
  };

  const save = async () => {
    setMsg(null);
    setFormError(null);
    const rows: SaleRecord[] = [];
    for (const m of meats) {
      const d = get(m.id);
      const existing = sales.find((x) => x.date === today && x.meatId === m.id);
      const cooked = cookedOf(m.id);
      const left = parseNum(d.leftover);
      const cat = parseNum(d.catering);
      if (cooked === null && !existing && d.cooked.trim() === '') continue; // nothing cooked, nothing to record
      if (cooked === null || left === null || cat === null) { setFormError(`${m.name}: enter plain numbers (no negatives).`); return; }
      if (cooked > 100000 || left > 100000 || cat > 100000) { setFormError(`${m.name}: number too big.`); return; }
      if (left + cat > cooked + 0.001) { setFormError(`${m.name}: leftover + catering is more than the ${fmtLb(cooked)} cooked.`); return; }
      rows.push({
        date: today, meatId: m.id, cookedLb: cooked, leftoverLb: left, cateringLb: cat,
        soldOutAt: existing?.soldOutAt ?? null, halfGoneAt: existing?.halfGoneAt ?? null, leftoverUse: left > 0 ? d.use : null,
        closed: true, unusual: d.unusual,
      });
    }
    if (!rows.length) { setFormError('Nothing to save. Enter cooked lb for a meat first.'); return; }
    const ok = await run(async () => { await db.saveSales(rows); await st.reload(); return true; });
    if (ok) setMsg(`Saved ${rows.length} meat${rows.length === 1 ? '' : 's'} for today.`);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <H>Close</H>
      <T muted>Closing out {fmtDay(today)}. Pounds left over, what happened to them, and any catering.</T>
      {meats.map((m, idx) => {
        const d = get(m.id);
        const p = planOf(m.id);
        const left = parseNum(d.leftover) ?? 0;
        return (
          <Card key={m.id} index={idx} style={{ marginTop: 14 }}>
            <H>{m.name}</H>
            {p ? (
              <T muted>Cooked today: {fmtLb(p.finalPieces * p.yPerPiece)} ({p.finalPieces} pieces from the plan)</T>
            ) : (
              <NumField label="Cooked lb (no plan today)" value={d.cooked} onChange={(v) => set(m.id, { cooked: v })} step={5} unit="lb" />
            )}
            <NumField label="Leftover lb" value={d.leftover} onChange={(v) => set(m.id, { leftover: v })} step={0.5} unit="lb" />
            {left > 0 ? (
              <FadeSlide dy={8} duration={DUR.quick}>
                <T muted style={{ marginTop: 8 }}>What did it become?</T>
                <Chips options={USES} value={d.use} onChange={(v) => set(m.id, { use: v })} />
              </FadeSlide>
            ) : null}
            <NumField label="Catering lb sold" value={d.catering} onChange={(v) => set(m.id, { catering: v })} step={1} unit="lb" />
            <Check
              label="Unusual night"
              hint="Storm, event, closed early, power out. Pitcall will not learn from it."
              value={d.unusual}
              onChange={(v) => set(m.id, { unusual: v })}
            />
          </Card>
        );
      })}
      {formError ? <FadeSlide key={formError} dy={8} duration={DUR.quick}><Text style={{ color: C.red, fontSize: F.body, marginTop: 8 }}>{formError}</Text></FadeSlide> : null}
      {msg ? <FadeSlide key={msg} dy={8} duration={DUR.quick}><Text style={{ color: C.green, fontSize: F.body, marginTop: 8 }}>{msg}</Text></FadeSlide> : null}
      {meats.length ? <Btn label="Save" onPress={save} /> : null}
    </ScrollView>
  );
}
