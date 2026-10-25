import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StatusBar as RNStatusBar, Text, View, type LayoutChangeEvent } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { StoreProvider, useStore } from './src/store';
import { C, F } from './src/theme';
import Tonight from './src/screens/Tonight';
import Service from './src/screens/Service';
import Close from './src/screens/Close';
import Week from './src/screens/Week';
import Settings from './src/screens/Settings';
import Intro from './src/screens/Intro';
import { PressScale, Presence, TabIndicator, TabPane } from './src/motion';
import { tabWidthOf } from './src/motionMath';
import { getKv, setKv } from './src/db';

type Tab = 'Tonight' | 'Service' | 'Close' | 'Week';
const TABS: Tab[] = ['Tonight', 'Service', 'Close', 'Week'];
const TOP = Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 24) : 50;
const BOTTOM = Platform.OS === 'ios' ? 24 : 8;
const GEAR_W = 64;

// Settings and the intro slide over the tabs; the error banner floats over everything.
const OVERLAY = { position: 'absolute', top: TOP, left: 0, right: 0, bottom: 0, backgroundColor: C.bg } as const;
const BANNER = { position: 'absolute', top: TOP, left: 0, right: 0, zIndex: 20, elevation: 20 } as const;

function Shell() {
  const { ready, error, setError } = useStore();
  const [tab, setTab] = useState<Tab>('Tonight');
  const [dir, setDir] = useState(1); // which way the next tab slides in from
  const [barW, setBarW] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // First launch shows a short intro once. 'checking' until the saved flag has been read.
  const [intro, setIntro] = useState<'checking' | 'show' | 'hide'>('checking');

  useEffect(() => {
    if (!ready) return;
    let live = true;
    getKv('introSeen')
      .then((v) => { if (live) setIntro(v ? 'hide' : 'show'); })
      .catch(() => { if (live) setIntro('hide'); }); // never trap the owner behind the intro
    return () => { live = false; };
  }, [ready]);

  const finishIntro = (openSettings: boolean) => {
    setIntro('hide');
    setKv('introSeen', '1').catch(() => { /* worst case the intro shows once more */ });
    if (openSettings) setSettingsOpen(true);
  };

  const selectTab = (t: Tab) => {
    if (t === tab) return;
    setDir(TABS.indexOf(t) > TABS.indexOf(tab) ? 1 : -1);
    setTab(t);
  };

  if (!ready || intro === 'checking') {
    return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={C.amber} /></View>;
  }

  const covered = settingsOpen || intro === 'show';
  const tabW = tabWidthOf(barW, GEAR_W, TABS.length);
  const panes: Record<Tab, React.ReactNode> = {
    Tonight: <Tonight />, Service: <Service />, Close: <Close />, Week: <Week />,
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: TOP }}>
      {/* Tabs stay mounted (and hidden when not current) so typed-but-unsaved numbers and
          the Tonight reveal state survive a tab switch or a trip to Settings. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View
          style={{ flex: 1 }}
          accessibilityElementsHidden={covered}
          importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        >
          <View style={{ flex: 1 }}>
            {TABS.map((t) => (
              <TabPane key={t} active={tab === t} dx={dir * 28}>{panes[t]}</TabPane>
            ))}
          </View>
          <View
            onLayout={(e: LayoutChangeEvent) => setBarW(e.nativeEvent.layout.width)}
            style={{ flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderColor: C.line, paddingBottom: BOTTOM }}
          >
            <TabIndicator index={TABS.indexOf(tab)} tabWidth={tabW} count={TABS.length} />
            {TABS.map((t) => (
              <PressScale
                key={t}
                scaleTo={0.96}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t }}
                onPress={() => selectTab(t)}
                style={{ flex: 1, minHeight: 72, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: tab === t ? C.amber : C.text, fontSize: 20, fontWeight: '800' }}>{t}</Text>
              </PressScale>
            ))}
            <PressScale
              scaleTo={0.9}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              onPress={() => setSettingsOpen(true)}
              style={{ width: GEAR_W, minHeight: 72, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: C.text, fontSize: 30 }}>{'⚙'}</Text>
            </PressScale>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Presence show={settingsOpen} dy={28} style={OVERLAY}>
        <Settings onClose={() => setSettingsOpen(false)} onShowIntro={() => { setSettingsOpen(false); setIntro('show'); }} />
      </Presence>
      <Presence show={intro === 'show'} dy={28} style={OVERLAY}>
        <Intro onDone={finishIntro} />
      </Presence>
      <Presence show={!!error} dy={-40} style={BANNER}>
        <PressScale scaleTo={0.99} onPress={() => setError(null)} style={{ backgroundColor: '#5A1410', padding: 14, borderBottomWidth: 2, borderColor: C.red }}>
          <Text style={{ color: C.text, fontSize: F.body, fontWeight: '700' }}>{error}</Text>
          <Text style={{ color: C.muted, fontSize: 16 }}>Tap to dismiss</Text>
        </PressScale>
      </Presence>
    </View>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <StatusBar style="light" />
      <Shell />
    </StoreProvider>
  );
}
