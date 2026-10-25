import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getKv, setKv } from './db';

export type PermState = 'granted' | 'denied' | 'unavailable';

let handlerSet = false;
function ensureHandler() {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
    }),
  });
}

const CHANNEL = 'puton';

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Put-on alarms',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 250, 500],
  });
}

export async function ensurePermission(): Promise<PermState> {
  if (Platform.OS === 'web') return 'unavailable';
  ensureHandler();
  await ensureChannel();
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return 'granted';
  if (!cur.canAskAgain) return 'denied';
  const req = await Notifications.requestPermissionsAsync();
  return req.granted ? 'granted' : 'denied';
}

export interface Alarm { at: Date; title: string; body: string }

const key = (date: string) => `notif:${date}`;

/** Cancel whatever was scheduled for this service date, then schedule the new future alarms. Returns how many were set. */
export async function replaceSchedule(date: string, alarms: Alarm[], now: Date): Promise<number> {
  if (Platform.OS === 'web') return 0;
  ensureHandler();
  const old = await getKv(key(date));
  if (old) {
    let ids: unknown = [];
    try { ids = JSON.parse(old); } catch { ids = []; }
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === 'string') {
          try { await Notifications.cancelScheduledNotificationAsync(id); } catch { /* already gone */ }
        }
      }
    }
    await setKv(key(date), '[]');
  }
  const newIds: string[] = [];
  for (const a of alarms) {
    if (a.at.getTime() <= now.getTime() + 5000) continue;
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: a.title, body: a.body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: a.at,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}),
      },
    });
    newIds.push(id);
    await setKv(key(date), JSON.stringify(newIds)); // persist as we go so a crash can't orphan alarms
  }
  return newIds.length;
}
