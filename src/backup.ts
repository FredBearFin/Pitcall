import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { loadAll, replaceAll } from './db';
import { MAX_BACKUP_BYTES, buildBackup, parseBackupText, type BackupData } from './logic';

export async function exportBackup(): Promise<string> {
  const all = await loadAll();
  const data = buildBackup(
    { meats: all.meats, plans: all.plans, sales: all.sales, cooks: all.cooks, settings: all.settings },
    new Date(),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `pitcall-backup-${stamp}.json`);
  file.create({ overwrite: true });
  await file.write(JSON.stringify(data));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save Pitcall backup' });
  return file.name;
}

/** Pick + validate a file. Returns null if the picker was cancelled. Throws (with a readable message) on any problem; the DB is untouched until validation passes. */
export async function pickBackup(): Promise<BackupData | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const asset = res.assets[0];
  if (typeof asset.size === 'number' && asset.size > MAX_BACKUP_BYTES) throw new Error('Backup file is too large');
  const f = new File(asset.uri);
  if (f.size > MAX_BACKUP_BYTES) throw new Error('Backup file is too large');
  const text = await f.text();
  const parsed = parseBackupText(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export async function applyBackup(d: BackupData): Promise<void> {
  await replaceAll(d);
}
