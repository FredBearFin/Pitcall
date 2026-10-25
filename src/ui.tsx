import React from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { BTN_H, C, F } from './theme';
import { parseNum } from './logic';
import { FadeSlide, Pop, PressScale } from './motion';
import { staggerDelay } from './motionMath';

export function Btn(p: {
  label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; style?: StyleProp<ViewStyle>; disabled?: boolean; small?: boolean;
}) {
  const kind = p.kind ?? 'primary';
  const bg = kind === 'primary' ? C.amber : kind === 'danger' ? C.red : C.card2;
  const fg = kind === 'ghost' ? C.text : '#000';
  return (
    <PressScale
      accessibilityRole="button"
      onPress={p.onPress}
      disabled={p.disabled}
      style={({ pressed }) => [
        s.btn, { backgroundColor: bg, opacity: p.disabled ? 0.4 : pressed ? 0.7 : 1, minHeight: p.small ? 56 : BTN_H }, p.style,
      ]}
    >
      <Text style={[s.btnText, { color: fg, fontSize: p.small ? F.body : 24 }]}>{p.label}</Text>
    </PressScale>
  );
}

/** A card. Pass `index` (its position on the screen) and the cards arrive one after another. */
export function Card({ children, style, index }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; index?: number }) {
  return (
    <FadeSlide dy={14} delay={staggerDelay(index ?? 0)}>
      <View style={[s.card, style]}>{children}</View>
    </FadeSlide>
  );
}

export function H({ children }: { children: React.ReactNode }) {
  return <Text style={s.h}>{children}</Text>;
}
export function T({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: StyleProp<any> }) {
  return <Text style={[s.t, muted && { color: C.muted }, style]}>{children}</Text>;
}

/** Big numeric field with - / + steppers. Value is kept as a string so typing is free-form. */
export function NumField(p: {
  label: string; value: string; onChange: (v: string) => void; step?: number; editable?: boolean; unit?: string;
}) {
  const step = p.step ?? 1;
  const bump = (d: number) => {
    const cur = parseNum(p.value) ?? 0;
    const next = Math.max(0, Math.round((cur + d) * 100) / 100);
    p.onChange(String(next));
  };
  const ed = p.editable !== false;
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={s.label}>{p.label}</Text>
      <View style={s.row}>
        <PressScale scaleTo={0.9} accessibilityRole="button" accessibilityLabel={`Less ${p.label}`} disabled={!ed} onPress={() => bump(-step)} style={[s.step, !ed && { opacity: 0.3 }]}>
          <Text style={s.stepText}>-</Text>
        </PressScale>
        <TextInput
          style={s.input}
          value={p.value}
          onChangeText={p.onChange}
          editable={ed}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={C.muted}
          selectTextOnFocus
        />
        <PressScale scaleTo={0.9} accessibilityRole="button" accessibilityLabel={`More ${p.label}`} disabled={!ed} onPress={() => bump(step)} style={[s.step, !ed && { opacity: 0.3 }]}>
          <Text style={s.stepText}>+</Text>
        </PressScale>
        {p.unit ? <Text style={[s.t, { marginLeft: 8, color: C.muted }]}>{p.unit}</Text> : null}
      </View>
    </View>
  );
}

/** Big tick box. Reports its state to screen readers as well as showing it, and the box pops when ticked. */
export function Check(p: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <PressScale
      scaleTo={0.98}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: p.value }}
      onPress={() => p.onChange(!p.value)}
      style={s.checkRow}
    >
      <Pop trigger={p.value} from={0.8}>
        <View style={[s.box, p.value && { backgroundColor: C.amber, borderColor: C.amber }]}>
          {p.value ? <Text style={{ color: '#000', fontSize: 28, fontWeight: '900' }}>{'✓'}</Text> : null}
        </View>
      </Pop>
      <View style={{ flex: 1 }}>
        <Text style={s.t}>{p.label}</Text>
        {p.hint ? <Text style={{ color: C.muted, fontSize: F.small }}>{p.hint}</Text> : null}
      </View>
    </PressScale>
  );
}

export function Chips<V extends string>(p: { options: { v: V; label: string }[]; value: V | null; onChange: (v: V) => void }) {
  return (
    <View style={[s.row, { flexWrap: 'wrap', marginTop: 6 }]}>
      {p.options.map((o) => {
        const on = o.v === p.value;
        return (
          <PressScale key={o.v} scaleTo={0.94} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => p.onChange(o.v)} style={[s.chip, on && { backgroundColor: C.amber, borderColor: C.amber }]}>
            <Text style={{ fontSize: F.body, color: on ? '#000' : C.text, fontWeight: '600' }}>{o.label}</Text>
          </PressScale>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  btn: { borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, marginTop: 10 },
  btnText: { fontWeight: '800' },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.line },
  h: { color: C.text, fontSize: F.big, fontWeight: '800' },
  t: { color: C.text, fontSize: F.body, marginTop: 4 },
  label: { color: C.muted, fontSize: F.small, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 64, marginTop: 10 },
  box: { width: 44, height: 44, borderRadius: 10, borderWidth: 2, borderColor: C.line, marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  step: { width: 64, height: 64, borderRadius: 12, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: C.amber, fontSize: 36, fontWeight: '800' },
  input: {
    flex: 1, minWidth: 80, height: 64, marginHorizontal: 8, borderRadius: 12, backgroundColor: '#000', color: C.text,
    fontSize: F.huge, fontWeight: '800', textAlign: 'center', borderWidth: 1, borderColor: C.line,
  },
  chip: { minHeight: 56, paddingHorizontal: 16, borderRadius: 28, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center', marginRight: 8, marginTop: 6 },
});
