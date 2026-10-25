import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { C, F } from '../theme';
import { Btn, Card, H, T } from '../ui';
import { FadeSlide } from '../motion';

interface Page { title: string; lines: string[]; openSettings?: boolean }

export const INTRO_PAGES: Page[] = [
  {
    title: 'What Pitcall does',
    lines: [
      'Each evening it tells you how many briskets, pork butts and racks of ribs to put on for tomorrow, and what time to load each one.',
      'It learns from your own sales, so it gets better the more nights you give it.',
      'Everything stays on this phone. No account, no signal needed.',
    ],
  },
  {
    title: 'Set your meats first',
    lines: [
      'The starting menu uses made-up prices, yields and weights.',
      'Open Settings (the gear at the bottom right) and enter what you really pay per raw pound, what you charge per cooked pound, the raw weight of a piece, and how much of it you actually sell after cooking.',
      "Pitcall's numbers are only as good as these.",
    ],
    openSettings: true,
  },
  {
    title: 'Your day with it',
    lines: [
      'Tonight: type your own number first, then tap to see Pitcall\'s. Accept the plan and it sets an alarm for each put-on time.',
      'Service: tap the big 86 button when a meat sells out. Optional: tap Half gone when about half is left.',
      'Close: enter the pounds left over, what happened to them, and any catering. About 30 seconds.',
    ],
  },
  {
    title: 'Give it two weeks',
    lines: [
      'For the first couple of weeks it leans on the usual-day guesses you entered. A night you skip teaches it nothing, so fill in Close every night.',
      'If a night was a storm, an event or a short day, tick Unusual night on Close and Pitcall will not learn from it.',
      'Export a backup from Settings now and then and save it to iCloud Drive or Google Drive. If the phone is lost, the history is lost with it.',
    ],
  },
];

export default function Intro({ onDone }: { onDone: (openSettings: boolean) => void }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1); // pages slide in from the right going forward, from the left going back
  const page = INTRO_PAGES[i];
  const last = i === INTRO_PAGES.length - 1;
  const go = (n: number) => { setDir(n > i ? 1 : -1); setI(n); };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T muted>{i + 1} of {INTRO_PAGES.length}</T>
          <Btn label="Skip" kind="ghost" small onPress={() => onDone(false)} style={{ marginTop: 0, minWidth: 110 }} />
        </View>
        {/* keyed on the page, so each page slides in fresh from the side it came from */}
        <FadeSlide key={i} dx={dir * 36} dy={0}>
          <Card style={{ marginTop: 14 }}>
            <H>{page.title}</H>
            {page.lines.map((l, k) => (
              <FadeSlide key={k} dy={8} delay={80 + k * 70}>
                <Text style={{ color: C.text, fontSize: F.body, marginTop: 12, lineHeight: 28 }}>{l}</Text>
              </FadeSlide>
            ))}
          </Card>
          {page.openSettings ? <Btn label="Open Settings now" kind="ghost" onPress={() => onDone(true)} /> : null}
        </FadeSlide>
        <View style={{ flexDirection: 'row', marginTop: 4 }}>
          {i > 0 ? <Btn label="Back" kind="ghost" onPress={() => go(i - 1)} style={{ flex: 1, marginRight: 8 }} /> : null}
          <Btn label={last ? 'Start' : 'Next'} onPress={() => (last ? onDone(false) : go(i + 1))} style={{ flex: 2 }} />
        </View>
      </ScrollView>
    </View>
  );
}
