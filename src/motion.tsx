// Motion layer. Rules:
//  - Cosmetic only: state is committed immediately, an animation never delays or blocks an action.
//  - Short (see DUR) and one-shot: nothing loops, so nothing nags at a pitmaster at 2 am or drains the battery.
//  - Transform and opacity run on the native driver. The only JS-driven values are the counting numbers and the undo countdown.
//  - When the phone's Reduce Motion setting is on, everything snaps to its end state instead of moving.
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View, type PressableProps, type PressableStateCallbackType, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { C } from './theme';
import { DUR, countDuration, tabIndicatorX } from './motionMath';

const OUT = Easing.out(Easing.cubic);
const IN = Easing.in(Easing.cubic);

// ------------------------------------------------------------------ Reduce Motion
let reduceNow = false;
let watching = false;
const listeners = new Set<(v: boolean) => void>();

function watchReduceMotion() {
  if (watching) return;
  watching = true;
  const set = (v: boolean) => {
    reduceNow = v;
    listeners.forEach((f) => f(v));
  };
  AccessibilityInfo.isReduceMotionEnabled().then(set).catch(() => { /* assume motion is fine */ });
  AccessibilityInfo.addEventListener('reduceMotionChanged', set);
}

export function useReduceMotion(): boolean {
  const [v, setV] = useState(reduceNow);
  useEffect(() => {
    watchReduceMotion();
    listeners.add(setV);
    setV(reduceNow);
    return () => { listeners.delete(setV); };
  }, []);
  return v;
}

// ------------------------------------------------------------------ Entrance: fade and slide in
/**
 * Fades and slides its children in when it mounts, and again each time `active` goes from false to true
 * (the tab panes use that). While inactive it sits at opacity 0, so a hidden pane is ready to play on activation.
 */
export function FadeSlide({ children, delay = 0, dy = 12, dx = 0, duration = DUR.base, active = true, style }: {
  children: React.ReactNode; delay?: number; dy?: number; dx?: number; duration?: number; active?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) { v.setValue(0); return; }
    if (reduce) { v.setValue(1); return; }
    v.setValue(0);
    const a = Animated.timing(v, { toValue: 1, duration, delay, easing: OUT, useNativeDriver: true });
    a.start();
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) },
            { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [dx, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// ------------------------------------------------------------------ Press feedback
function usePressScale(scaleTo: number) {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => { if (reduce) scale.setValue(1); }, [reduce, scale]);
  const go = (to: number) => {
    if (reduce) return;
    Animated.spring(scale, { toValue: to, speed: 40, bounciness: 6, useNativeDriver: true }).start();
  };
  return { scale, down: () => go(scaleTo), up: () => go(1) };
}

const APressable = Animated.createAnimatedComponent(Pressable);

/**
 * A Pressable that dips slightly while held and springs back. `style` may be a function of `{ pressed }`
 * like Pressable's own; it is resolved here because an animated component cannot take a style function.
 */
export function PressScale({ scaleTo = 0.97, style, onPressIn, onPressOut, ...rest }: Omit<PressableProps, 'style'> & {
  scaleTo?: number; style?: PressableProps['style'];
}) {
  const { scale, down, up } = usePressScale(scaleTo);
  const [pressed, setPressed] = useState(false);
  const resolved = typeof style === 'function' ? style({ pressed } as PressableStateCallbackType) : style;
  return (
    <APressable
      {...rest}
      onPressIn={(e) => { setPressed(true); down(); onPressIn?.(e); }}
      onPressOut={(e) => { setPressed(false); up(); onPressOut?.(e); }}
      style={[resolved, { transform: [{ scale }] }]}
    />
  );
}

// ------------------------------------------------------------------ Pop: a small bump when a value changes
export function Pop({ trigger, children, style, from = 0.9 }: {
  trigger: unknown; children: React.ReactNode; style?: StyleProp<ViewStyle>; from?: number;
}) {
  const reduce = useReduceMotion();
  const s = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduce) { s.setValue(1); return; }
    s.setValue(from);
    const a = Animated.spring(s, { toValue: 1, speed: 30, bounciness: 12, useNativeDriver: true });
    a.start();
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>;
}

// ------------------------------------------------------------------ Counting number
/**
 * Shows `format(value)` and counts to a new value when it changes. Pass `from` to count up from that number on first show.
 * Drive it with a `key` to replay from `from` (the Week screen does, each time its tab opens).
 */
export function CountText({ value, format = (n: number) => String(Math.round(n)), from, style }: {
  value: number; format?: (n: number) => string; from?: number; style?: StyleProp<TextStyle>;
}) {
  const reduce = useReduceMotion();
  const start = from ?? value;
  const [shown, setShown] = useState(start);
  const av = useRef(new Animated.Value(start)).current;
  const last = useRef(start);
  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    if (reduce || last.current === target) {
      av.stopAnimation();
      av.setValue(target);
      setShown(target);
      last.current = target;
      return;
    }
    const id = av.addListener(({ value: x }) => setShown(x));
    const a = Animated.timing(av, { toValue: target, duration: countDuration(target - last.current), easing: OUT, useNativeDriver: false });
    a.start(({ finished }) => { if (finished) setShown(target); });
    last.current = target;
    return () => { a.stop(); av.removeListener(id); };
  }, [value, reduce, av]);
  return <Text style={style}>{format(shown)}</Text>;
}

// ------------------------------------------------------------------ Presence: slide in AND out
/**
 * Mounts its children with a slide-and-fade when `show` turns true, and keeps them on screen long enough to
 * slide out when it turns false (the last children shown are reused for the exit, so a null prop cannot blank them mid-exit).
 */
export function Presence({ show, children, dy = -20, style }: {
  show: boolean; children: React.ReactNode; dy?: number; style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(show ? 1 : 0)).current;
  const [mounted, setMounted] = useState(show);
  const lastChildren = useRef<React.ReactNode>(children);
  if (show) lastChildren.current = children;
  useEffect(() => {
    if (show) {
      setMounted(true);
      if (reduce) { v.setValue(1); return; }
      const a = Animated.timing(v, { toValue: 1, duration: DUR.base, easing: OUT, useNativeDriver: true });
      a.start();
      return () => a.stop();
    }
    if (reduce) { v.setValue(0); setMounted(false); return; }
    const a = Animated.timing(v, { toValue: 0, duration: DUR.quick, easing: IN, useNativeDriver: true });
    a.start(({ finished }) => { if (finished) setMounted(false); });
    return () => a.stop();
  }, [show, reduce, v]);
  if (!show && !mounted) return null;
  return (
    <Animated.View
      pointerEvents={show ? 'auto' : 'none'}
      style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) }] }]}
    >
      {show ? children : lastChildren.current}
    </Animated.View>
  );
}

// ------------------------------------------------------------------ Tabs
const PaneActiveContext = createContext(true);
/** True while this tab pane is the one on screen. */
export const usePaneActive = () => useContext(PaneActiveContext);

/** A tab's screen. Stays mounted (so typed numbers survive) but hidden; slides in from `dx` when it becomes active. */
export function TabPane({ active, dx, children }: { active: boolean; dx: number; children: React.ReactNode }) {
  return (
    <PaneActiveContext.Provider value={active}>
      <View style={{ flex: 1, display: active ? 'flex' : 'none' }}>
        <FadeSlide active={active} dx={dx} dy={0} style={{ flex: 1 }}>{children}</FadeSlide>
      </View>
    </PaneActiveContext.Provider>
  );
}

/** The amber bar over the active tab. It springs from tab to tab; the first placement and Reduce Motion are instant. */
export function TabIndicator({ index, tabWidth, count }: { index: number; tabWidth: number; count: number }) {
  const reduce = useReduceMotion();
  const x = useRef(new Animated.Value(tabIndicatorX(index, tabWidth, count))).current;
  const placed = useRef(false);
  useEffect(() => {
    const to = tabIndicatorX(index, tabWidth, count);
    if (!placed.current || reduce || tabWidth <= 0) {
      x.setValue(to);
      placed.current = tabWidth > 0;
      return;
    }
    const a = Animated.spring(x, { toValue: to, speed: 22, bounciness: 5, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [index, tabWidth, count, reduce, x]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, height: 4, width: tabWidth, backgroundColor: C.amber, transform: [{ translateX: x }] }}
    />
  );
}
