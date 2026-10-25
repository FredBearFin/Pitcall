import * as SQLite from 'expo-sqlite';
import type { Meat, PlanRecord, SaleRecord, Settings } from './types';
import {
  type BackupData, type CookRow, DEFAULT_SETTINGS, SEED_MEATS, stampBlocked, validateBackup,
} from './logic';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('pitcall.db');
      await migrate(db);
      return db;
    })();
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS meat (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, rawCost REAL NOT NULL, price REAL NOT NULL,
  rawWeight REAL NOT NULL, yield REAL NOT NULL, slots REAL NOT NULL, leftoverValue REAL NOT NULL,
  leftoverCap REAL NOT NULL, usualGuess REAL NOT NULL, cookHoursGuess REAL NOT NULL, sort INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plan (
  date TEXT NOT NULL, meatId TEXT NOT NULL, ownerPieces INTEGER, pitcallPieces INTEGER NOT NULL,
  rangeLo INTEGER NOT NULL, rangeHi INTEGER NOT NULL, finalPieces INTEGER NOT NULL, mean REAL NOT NULL,
  sigma REAL NOT NULL, cr REAL NOT NULL, cateringLb REAL NOT NULL, yPerPiece REAL NOT NULL, accepted INTEGER NOT NULL,
  PRIMARY KEY (date, meatId)
);
CREATE TABLE IF NOT EXISTS sale (
  date TEXT NOT NULL, meatId TEXT NOT NULL, cookedLb REAL NOT NULL, leftoverLb REAL NOT NULL,
  cateringLb REAL NOT NULL, soldOutAt REAL, halfGoneAt REAL, leftoverUse TEXT,
  PRIMARY KEY (date, meatId)
);
CREATE TABLE IF NOT EXISTS cook (
  id TEXT PRIMARY KEY NOT NULL, meatId TEXT NOT NULL, rawWeight REAL NOT NULL, putOnMs INTEGER NOT NULL, pullMs INTEGER
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
`;

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const v = row?.user_version ?? 0;
  if (v < 1) {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(SCHEMA_V1);
      const seeded = await txn.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', ['seeded']);
      if (!seeded) {
        for (const m of SEED_MEATS) await insertMeat(txn, m);
        await txn.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', ['settings', JSON.stringify(DEFAULT_SETTINGS)]);
        await txn.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', ['seeded', '1']);
      }
    });
    await db.execAsync('PRAGMA user_version = 1');
  }
  if (v < 2) {
    // v2: a Service tap creates a row that is not a closed night until Close saves it (closed = 0 then),
    // and Close can mark a night unusual so the forecast does not learn from it.
    // Rows that already exist were written by Close or by a tap and cannot be told apart, so they stay closed.
    // Idempotent on purpose: if an earlier launch added the columns but died before the version bump, retrying must not fail.
    await db.withExclusiveTransactionAsync(async (txn) => {
      const cols = await txn.getAllAsync<{ name: string }>('PRAGMA table_info(sale)');
      const has = (n: string) => cols.some((c) => c.name === n);
      if (!has('closed')) await txn.execAsync('ALTER TABLE sale ADD COLUMN closed INTEGER NOT NULL DEFAULT 1');
      if (!has('unusual')) await txn.execAsync('ALTER TABLE sale ADD COLUMN unusual INTEGER NOT NULL DEFAULT 0');
      await txn.execAsync('PRAGMA user_version = 2');
    });
  }
}

type Q = Pick<SQLite.SQLiteDatabase, 'runAsync'>;

function insertMeat(q: Q, m: Meat) {
  return q.runAsync(
    'INSERT OR REPLACE INTO meat (id,name,rawCost,price,rawWeight,yield,slots,leftoverValue,leftoverCap,usualGuess,cookHoursGuess,sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [m.id, m.name, m.rawCost, m.price, m.rawWeight, m.yield, m.slots, m.leftoverValue, m.leftoverCap, m.usualGuess, m.cookHoursGuess, m.sort],
  );
}
function insertPlan(q: Q, p: PlanRecord) {
  return q.runAsync(
    'INSERT OR REPLACE INTO plan (date,meatId,ownerPieces,pitcallPieces,rangeLo,rangeHi,finalPieces,mean,sigma,cr,cateringLb,yPerPiece,accepted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [p.date, p.meatId, p.ownerPieces, p.pitcallPieces, p.rangeLo, p.rangeHi, p.finalPieces, p.mean, p.sigma, p.cr, p.cateringLb, p.yPerPiece, p.accepted ? 1 : 0],
  );
}
function insertSale(q: Q, s: SaleRecord) {
  return q.runAsync(
    'INSERT OR REPLACE INTO sale (date,meatId,cookedLb,leftoverLb,cateringLb,soldOutAt,halfGoneAt,leftoverUse,closed,unusual) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [s.date, s.meatId, s.cookedLb, s.leftoverLb, s.cateringLb, s.soldOutAt, s.halfGoneAt, s.leftoverUse, s.closed === false ? 0 : 1, s.unusual ? 1 : 0],
  );
}
function insertCook(q: Q, c: CookRow) {
  return q.runAsync('INSERT OR REPLACE INTO cook (id,meatId,rawWeight,putOnMs,pullMs) VALUES (?,?,?,?,?)', [c.id, c.meatId, c.rawWeight, c.putOnMs, c.pullMs]);
}

export interface AllData {
  meats: Meat[]; settings: Settings; plans: PlanRecord[]; sales: SaleRecord[]; cooks: CookRow[];
}

export async function loadAll(): Promise<AllData> {
  const db = await getDb();
  const meats = await db.getAllAsync<Meat>('SELECT * FROM meat ORDER BY sort, name');
  const planRows = await db.getAllAsync<Omit<PlanRecord, 'accepted'> & { accepted: number }>('SELECT * FROM plan ORDER BY date');
  const saleRows = await db.getAllAsync<Omit<SaleRecord, 'closed' | 'unusual'> & { closed: number; unusual: number }>('SELECT * FROM sale ORDER BY date');
  const sales: SaleRecord[] = saleRows.map((r) => ({ ...r, closed: !!r.closed, unusual: !!r.unusual }));
  const cooks = await db.getAllAsync<CookRow>('SELECT * FROM cook ORDER BY putOnMs');
  const srow = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', ['settings']);
  let settings = DEFAULT_SETTINGS;
  if (srow) {
    try {
      const parsed = JSON.parse(srow.value);
      const check = validateBackup({ app: 'pitcall-backup', version: 1, meats: [], plans: [], sales: [], cooks: [], settings: parsed });
      if (check.ok) settings = check.value.settings;
    } catch { /* fall back to defaults */ }
  }
  return { meats, settings, plans: planRows.map((p) => ({ ...p, accepted: !!p.accepted })), sales, cooks };
}

export async function saveMeat(m: Meat): Promise<void> {
  await insertMeat(await getDb(), m);
}

export async function deleteMeat(id: string): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM plan WHERE meatId = ?', [id]);
    await txn.runAsync('DELETE FROM sale WHERE meatId = ?', [id]);
    await txn.runAsync('DELETE FROM cook WHERE meatId = ?', [id]);
    await txn.runAsync('DELETE FROM meat WHERE id = ?', [id]);
  });
}

export async function saveSettings(s: Settings): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', ['settings', JSON.stringify(s)]);
}

export async function savePlans(plans: PlanRecord[]): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const p of plans) await insertPlan(txn, p);
  });
}

export async function saveSales(sales: SaleRecord[]): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const s of sales) await insertSale(txn, s);
  });
}

/** Set one timestamp column on today's sale row, creating the row if missing. Returns the previous value. */
export async function stampSale(
  date: string, meatId: string, field: 'soldOutAt' | 'halfGoneAt', value: number | null, cookedLbIfNew: number, cateringLbIfNew = 0,
): Promise<number | null> {
  const db = await getDb();
  let prev: number | null = null;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const row = await txn.getFirstAsync<SaleRecord>('SELECT * FROM sale WHERE date = ? AND meatId = ?', [date, meatId]);
    const blocked = value != null ? stampBlocked(row, field) : null; // clearing or undoing is always allowed
    if (blocked) throw new Error(blocked); // rolls the transaction back; the UI shows it in the error banner
    if (!row) {
      // Not a closed night yet: Close flips this to closed when the owner saves it.
      await insertSale(txn, {
        date, meatId, cookedLb: cookedLbIfNew, leftoverLb: 0, cateringLb: cateringLbIfNew, soldOutAt: null, halfGoneAt: null, leftoverUse: null,
        closed: false,
      });
    } else prev = row[field];
    // field name comes from a closed union, never user input; value is bound
    const sql = field === 'soldOutAt' ? 'UPDATE sale SET soldOutAt = ? WHERE date = ? AND meatId = ?' : 'UPDATE sale SET halfGoneAt = ? WHERE date = ? AND meatId = ?';
    await txn.runAsync(sql, [value, date, meatId]);
  });
  return prev;
}

export async function saveCook(c: CookRow): Promise<void> {
  await insertCook(await getDb(), c);
}

export async function getKv(key: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return r ? r.value : null;
}
export async function setKv(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value]);
}

/** Replace ALL data with already-validated backup data, in one transaction. */
export async function replaceAll(d: BackupData): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM plan');
    await txn.runAsync('DELETE FROM sale');
    await txn.runAsync('DELETE FROM cook');
    await txn.runAsync('DELETE FROM meat');
    for (const m of d.meats) await insertMeat(txn, m);
    for (const p of d.plans) await insertPlan(txn, p);
    for (const s of d.sales) await insertSale(txn, s);
    for (const c of d.cooks) await insertCook(txn, c);
    await txn.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', ['settings', JSON.stringify(d.settings)]);
    await txn.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', ['seeded', '1']);
  });
}
