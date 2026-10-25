import React, { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { Meat, Settings as SettingsT } from '../types';
import * as db from '../db';
import { applyBackup, exportBackup, pickBackup } from '../backup';
import { C, F } from '../theme';
import { useStore } from '../store';
import { Btn, Card, Chips, H, T } from '../ui';
import { FadeSlide } from '../motion';
import { DUR } from '../motionMath';
import {
  MEAT_FIELDS, SETTINGS_FIELDS, newId, validateMeatDraft, validateSettingsDraft,
} from '../logic';

type D = Record<string, string>;
const meatDraft = (m: Meat): D => ({ name: m.name, ...Object.fromEntries(MEAT_FIELDS.map((f) => [f.key, String((m as unknown as Record<string, number>)[f.key])])) });
const settingsDraft = (s: SettingsT): D => Object.fromEntries(SETTINGS_FIELDS.map((f) => [f.key, String((s as unknown as Record<string, number>)[f.key])]));

function Field(p: { label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; text?: boolean }) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ color: C.muted, fontSize: F.small }}>{p.label}{p.hint ? `  (${p.hint})` : ''}</Text>
      <TextInput
        value={p.value}
        onChangeText={p.onChange}
        keyboardType={p.text ? 'default' : 'decimal-pad'}
        maxLength={p.text ? 60 : 12}
        placeholderTextColor={C.muted}
        style={{
          height: 60, borderRadius: 12, backgroundColor: '#000', color: C.text, fontSize: 24, paddingHorizontal: 14,
          borderWidth: 2, borderColor: p.error ? C.red : C.line, marginTop: 4,
        }}
      />
      {p.error ? <Text style={{ color: C.red, fontSize: 16, marginTop: 2 }}>{p.error}</Text> : null}
    </View>
  );
}

export default function Settings({ onClose, onShowIntro }: { onClose: () => void; onShowIntro?: () => void }) {
  const st = useStore();
  const { meats, settings, run } = st;
  const [mDrafts, setMDrafts] = useState<Record<string, D>>({});
  const [mErrors, setMErrors] = useState<Record<string, Record<string, string>>>({});
  const [sDraft, setSDraft] = useState<D | null>(null);
  const [curve, setCurve] = useState<string | null>(null);
  const [sErrors, setSErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const md = (m: Meat) => mDrafts[m.id] ?? meatDraft(m);
  const sd = sDraft ?? settingsDraft(settings);
  const curveV = curve ?? settings.curve;

  const saveMeat = async (m: Meat) => {
    setMsg(null);
    const r = validateMeatDraft(md(m), m.id);
    if (!r.ok) { setMErrors({ ...mErrors, [m.id]: r.errors }); return; }
    setMErrors({ ...mErrors, [m.id]: {} });
    await run(async () => {
      await db.saveMeat(r.meat);
      await st.reload();
      const { [m.id]: _drop, ...rest } = mDrafts;
      setMDrafts(rest);
      setMsg(`${r.meat.name} saved.`);
    });
  };

  const removeMeat = (m: Meat) => {
    Alert.alert(`Remove ${m.name}?`, 'This also deletes its plans, sales and cook history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { run(async () => { await db.deleteMeat(m.id); await st.reload(); }); } },
    ]);
  };

  const addMeat = async () => {
    const m: Meat = {
      id: newId(), name: 'New meat', rawCost: 3, price: 15, rawWeight: 8, yield: 0.6, slots: 1, leftoverValue: 0, leftoverCap: 0,
      usualGuess: 20, cookHoursGuess: 8, sort: meats.length + 1,
    };
    await run(async () => { await db.saveMeat(m); await st.reload(); setMsg('Added. Edit the numbers below.'); });
  };

  const saveSettings = async () => {
    setMsg(null);
    const r = validateSettingsDraft(sd, curveV);
    if (!r.ok) { setSErrors(r.errors); return; }
    setSErrors({});
    await run(async () => {
      await db.saveSettings(r.settings);
      await st.reload();
      setSDraft(null); setCurve(null);
      setMsg('Settings saved.');
    });
  };

  const doExport = async () => {
    setMsg(null); setBusy(true);
    await run(async () => { const n = await exportBackup(); setMsg(`Backup ready: ${n}`); });
    setBusy(false);
  };

  const doImport = async () => {
    setMsg(null); setBusy(true);
    await run(async () => {
      const data = await pickBackup(); // throws on any validation failure; DB untouched
      if (!data) return;
      const go = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Replace everything?',
          `This file has ${data.meats.length} meats, ${data.plans.length} plans, ${data.sales.length} sales and ${data.cooks.length} cooks. All current data will be replaced.`,
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: 'Replace', style: 'destructive', onPress: () => resolve(true) }],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!go) return;
      await applyBackup(data);
      await st.reload();
      st.bumpEpoch(); // rebuild Tonight, Service, Close and Week from the restored data
      setMDrafts({}); setSDraft(null); setCurve(null);
      setMsg('Backup restored.');
    });
    setBusy(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 4 }}>
        <View style={{ flex: 1 }}><H>Settings</H></View>
        <Btn label="Done" kind="ghost" onPress={onClose} style={{ marginTop: 0, minWidth: 110 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {msg ? <FadeSlide key={msg} dy={8} duration={DUR.quick}><Text style={{ color: C.green, fontSize: F.body, marginBottom: 10 }}>{msg}</Text></FadeSlide> : null}

        <Card index={0}>
          <H>The day and smoker</H>
          {SETTINGS_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint} value={sd[f.key]} error={sErrors[f.key]} onChange={(v) => setSDraft({ ...sd, [f.key]: v })} />
          ))}
          <T muted style={{ marginTop: 10 }}>Demand curve</T>
          <Chips
            options={[{ v: 'lunch', label: 'Lunch rush' }, { v: 'steady', label: 'Steady' }, { v: 'morning', label: 'Morning' }]}
            value={curveV as 'lunch' | 'steady' | 'morning'}
            onChange={(v) => setCurve(v)}
          />
          {sErrors.curve ? <Text style={{ color: C.red, fontSize: 16 }}>{sErrors.curve}</Text> : null}
          <Btn label="Save settings" onPress={saveSettings} />
        </Card>

        {meats.map((m, idx) => {
          const d = md(m);
          const e = mErrors[m.id] ?? {};
          return (
            <Card key={m.id} index={idx + 1}>
              <H>{m.name}</H>
              <Field text label="Name" value={d.name} error={e.name} onChange={(v) => setMDrafts({ ...mDrafts, [m.id]: { ...d, name: v } })} />
              {MEAT_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint} value={d[f.key]} error={e[f.key]} onChange={(v) => setMDrafts({ ...mDrafts, [m.id]: { ...d, [f.key]: v } })} />
              ))}
              <Btn label={`Save ${m.name}`} onPress={() => saveMeat(m)} />
              <Btn label="Remove" kind="danger" small onPress={() => removeMeat(m)} />
            </Card>
          );
        })}
        <Btn label="+ Add meat" kind="ghost" onPress={addMeat} />

        <Card style={{ marginTop: 18 }}>
          <H>Backup</H>
          <T muted>One file with all your meats, plans, sales, cooks and settings. Save it to iCloud Drive or Google Drive.</T>
          <Btn label="Export backup" onPress={doExport} disabled={busy} />
          <Btn label="Import backup" kind="ghost" onPress={doImport} disabled={busy} />
        </Card>

        {onShowIntro ? (
          <Card>
            <H>Help</H>
            <Btn label="Show the intro again" kind="ghost" onPress={onShowIntro} />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
