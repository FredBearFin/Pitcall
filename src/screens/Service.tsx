import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, Text, View } from 'react-native';
import * as db from '../db';
import { C, F } from '../theme';
import { useStore } from '../store';
import { Btn, Card, H, T } from '../ui';
import { Pop, Presence } from '../motion';
import { fmtHour, serviceClock, stampBlocked } from '../logic';

interface UndoState { meatId: string; name: string; field: 'soldOutAt' | 'halfGoneAt'; prev: number | null; date: string }

const UNDO_SECONDS = 10;

export default function Service() {
  const { meats, plans, sales, run, reload, setError } = useStore();
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [left, setLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Drains from full to empty over the undo window. JS-driven (it animates width), but it is one thin bar for ten seconds.
  const progress = useRef(new Animated.Value(1)).current;
  // The service NIGHT, not the calendar day: a tap at 12:45 am belongs to the night that just ended.
  const today = serviceClock(new Date()).date;

  const clearTimer = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    progress.stopAnimation();
  };
  useEffect(() => clearTimer, []);

  const startUndo = (u: UndoState) => {
    clearTimer();
    setUndo(u);
    setLeft(UNDO_SECONDS);
    progress.setValue(1);
    Animated.timing(progress, { toValue: 0, duration: UNDO_SECONDS * 1000, easing: Easing.linear, useNativeDriver: false }).start();
    timer.current = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) { clearTimer(); setUndo(null); return 0; }
        return l - 1;
      });
    }, 1000);
  };

  const stamp = async (meatId: string, name: string, field: 'soldOutAt' | 'halfGoneAt') => {
    const { date, hour } = serviceClock(new Date());
    const blocked = stampBlocked(sales.find((x) => x.date === date && x.meatId === meatId), field);
    if (blocked) { setError(blocked); return; }
    const plan = plans.find((p) => p.date === date && p.meatId === meatId && p.accepted);
    const cooked = plan ? plan.finalPieces * plan.yPerPiece : 0;
    const prev = await run(() => db.stampSale(date, meatId, field, Math.round(hour * 100) / 100, cooked, plan?.cateringLb ?? 0));
    if (prev === undefined) return;
    await run(reload);
    startUndo({ meatId, name, field, prev, date });
  };

  const doUndo = async () => {
    if (!undo) return;
    const u = undo;
    clearTimer();
    setUndo(null);
    await run(() => db.stampSale(u.date, u.meatId, u.field, u.prev, 0));
    await run(reload);
  };

  const clearField = async (meatId: string, field: 'soldOutAt' | 'halfGoneAt') => {
    await run(() => db.stampSale(today, meatId, field, null, 0));
    await run(reload);
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Floats over the top instead of pushing the cards down, so the next 86 button is still under the thumb. */}
      <Presence show={!!undo} dy={-56} style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, elevation: 10 }}>
        {undo ? (
          <View style={{ backgroundColor: C.amberDark, borderBottomWidth: 2, borderColor: C.amber }}>
            <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ color: C.text, fontSize: F.body, flex: 1 }}>
                {undo.field === 'soldOutAt' ? `86'd ${undo.name}` : `${undo.name} half gone`} ({left}s)
              </Text>
              <Btn label="UNDO" onPress={doUndo} style={{ marginTop: 0, minWidth: 120 }} />
            </View>
            <Animated.View style={{ height: 4, backgroundColor: C.amber, width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
          </View>
        ) : null}
      </Presence>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <H>Service</H>
        <T muted>Tap when a meat runs out. Works with no signal.</T>
        {meats.length === 0 ? <T muted>No meats yet. Add some in Settings (gear).</T> : null}
        {meats.map((m, idx) => {
          const s = sales.find((x) => x.date === today && x.meatId === m.id);
          const out = s?.soldOutAt != null;
          return (
            // The whole card gives a small bump the moment the meat is 86'd, as confirmation.
            <Pop key={m.id} trigger={out} from={0.97}>
              <Card index={idx} style={{ marginTop: 14 }}>
                <Btn
                  label={out ? `86'd at ${fmtHour(s!.soldOutAt as number)}  -  ${m.name}` : `86 ${m.name}`}
                  kind={out ? 'ghost' : 'primary'}
                  style={{ minHeight: 96, marginTop: 0 }}
                  onPress={() => { if (!out) stamp(m.id, m.name, 'soldOutAt'); }}
                />
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  {/* Once the meat is 86'd, a new "half gone" tap would be later than the sell-out; show the old one but offer no new one. */}
                  {out && s?.halfGoneAt == null ? (
                    <T muted style={{ flex: 1 }}>Sold out.</T>
                  ) : (
                    <Btn
                      small
                      kind="ghost"
                      style={{ flex: 1 }}
                      label={s?.halfGoneAt != null ? `Half gone at ${fmtHour(s.halfGoneAt)}` : 'Half gone'}
                      onPress={() => { if (s?.halfGoneAt == null) stamp(m.id, m.name, 'halfGoneAt'); }}
                    />
                  )}
                  {out || s?.halfGoneAt != null ? (
                    <Btn small kind="ghost" label="Clear" style={{ marginLeft: 8 }} onPress={() => { clearField(m.id, out ? 'soldOutAt' : 'halfGoneAt'); }} />
                  ) : null}
                </View>
              </Card>
            </Pop>
          );
        })}
      </ScrollView>
    </View>
  );
}
