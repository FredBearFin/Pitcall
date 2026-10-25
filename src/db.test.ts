// Runs the real src/db.ts against a real SQLite engine (node:sqlite) through a thin stand-in for expo-sqlite's async API.
// It proves the SQL and the migration, not the phone: expo-sqlite itself is still untested here.
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ raw: null as unknown, adapter: null as unknown }));

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => holder.adapter }));

type Row = Record<string, unknown>;

interface Adapter {
  execAsync(sql: string): Promise<void>;
  getFirstAsync(sql: string, params?: unknown[]): Promise<Row | null>;
  getAllAsync(sql: string, params?: unknown[]): Promise<Row[]>;
  runAsync(sql: string, params?: unknown[]): Promise<void>;
  withExclusiveTransactionAsync(fn: (txn: Adapter) => Promise<void>): Promise<void>;
}

function makeAdapter(raw: DatabaseSync): Adapter {
  const api: Adapter = {
    execAsync: async (sql) => { raw.exec(sql); },
    getFirstAsync: async (sql, params = []) => ((raw.prepare(sql).get(...params) as Row | undefined) ?? null),
    getAllAsync: async (sql, params = []) => raw.prepare(sql).all(...params) as Row[],
    runAsync: async (sql, params = []) => { raw.prepare(sql).run(...params); },
    withExclusiveTransactionAsync: async (fn) => {
      raw.exec('BEGIN EXCLUSIVE');
      try { await fn(api); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  return api;
}

// The schema exactly as version 1 shipped it, i.e. what is already on a phone that has run the old app.
const SCHEMA_V1 = `
CREATE TABLE meat (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, rawCost REAL NOT NULL, price REAL NOT NULL,
  rawWeight REAL NOT NULL, yield REAL NOT NULL, slots REAL NOT NULL, leftoverValue REAL NOT NULL,
  leftoverCap REAL NOT NULL, usualGuess REAL NOT NULL, cookHoursGuess REAL NOT NULL, sort INTEGER NOT NULL
);
CREATE TABLE plan (
  date TEXT NOT NULL, meatId TEXT NOT NULL, ownerPieces INTEGER, pitcallPieces INTEGER NOT NULL,
  rangeLo INTEGER NOT NULL, rangeHi INTEGER NOT NULL, finalPieces INTEGER NOT NULL, mean REAL NOT NULL,
  sigma REAL NOT NULL, cr REAL NOT NULL, cateringLb REAL NOT NULL, yPerPiece REAL NOT NULL, accepted INTEGER NOT NULL,
  PRIMARY KEY (date, meatId)
);
CREATE TABLE sale (
  date TEXT NOT NULL, meatId TEXT NOT NULL, cookedLb REAL NOT NULL, leftoverLb REAL NOT NULL,
  cateringLb REAL NOT NULL, soldOutAt REAL, halfGoneAt REAL, leftoverUse TEXT,
  PRIMARY KEY (date, meatId)
);
CREATE TABLE cook (
  id TEXT PRIMARY KEY NOT NULL, meatId TEXT NOT NULL, rawWeight REAL NOT NULL, putOnMs INTEGER NOT NULL, pullMs INTEGER
);
CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
`;

function open(setup?: (raw: DatabaseSync) => void): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  setup?.(raw);
  holder.raw = raw;
  holder.adapter = makeAdapter(raw);
  return raw;
}
const version = (raw: DatabaseSync) => (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const loadDb = async () => { vi.resetModules(); return import('./db'); }; // fresh module = fresh cached connection

beforeEach(() => { holder.raw = null; holder.adapter = null; });

describe('migration to version 2', () => {
  it('a brand-new install ends at version 2 with the seeded menu and the new columns', async () => {
    const raw = open();
    const db = await loadDb();
    const all = await db.loadAll();
    expect(version(raw)).toBe(2);
    expect(all.meats.length).toBe(5);
    await db.saveSales([{ date: '2026-10-24', meatId: 'brisket', cookedLb: 70, leftoverLb: 5, cateringLb: 0, soldOutAt: null, halfGoneAt: null, leftoverUse: 'binned', closed: true, unusual: true }]);
    expect((await db.loadAll()).sales[0]).toMatchObject({ closed: true, unusual: true });
  });

  it('an existing phone on version 1 keeps every sale, now marked closed and not unusual', async () => {
    const raw = open((r) => {
      r.exec(SCHEMA_V1);
      r.exec("INSERT INTO sale VALUES ('2026-10-10','brisket',70,10,0,NULL,13.5,'binned')");
      r.exec("INSERT INTO sale VALUES ('2026-10-11','brisket',77,0,0,14.25,NULL,NULL)");
      r.exec("INSERT INTO kv VALUES ('seeded','1')");
      r.exec('PRAGMA user_version = 1');
    });
    const db = await loadDb();
    const all = await db.loadAll();
    expect(version(raw)).toBe(2);
    expect(all.sales).toHaveLength(2);
    expect(all.sales[0]).toMatchObject({ date: '2026-10-10', cookedLb: 70, leftoverLb: 10, halfGoneAt: 13.5, leftoverUse: 'binned', closed: true, unusual: false });
    expect(all.sales[1]).toMatchObject({ date: '2026-10-11', soldOutAt: 14.25, closed: true, unusual: false });
  });

  it('a launch that added the columns but died before the version bump retries cleanly instead of failing', async () => {
    const raw = open((r) => {
      r.exec(SCHEMA_V1);
      r.exec("INSERT INTO kv VALUES ('seeded','1')");
      r.exec('ALTER TABLE sale ADD COLUMN closed INTEGER NOT NULL DEFAULT 1');
      r.exec('PRAGMA user_version = 1');
    });
    const db = await loadDb();
    await expect(db.loadAll()).resolves.toBeTruthy();
    expect(version(raw)).toBe(2);
    const cols = (raw.prepare('PRAGMA table_info(sale)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('unusual');
  });

  it('opening an already-migrated database a second time changes nothing', async () => {
    const raw = open();
    let db = await loadDb();
    await db.loadAll();
    db = await loadDb();
    await db.loadAll();
    expect(version(raw)).toBe(2);
    expect((raw.prepare('PRAGMA table_info(sale)').all() as unknown[]).length).toBe(10);
  });
});

describe('Service taps against the real SQL', () => {
  it('the first tap of the night creates a row that is NOT closed; Close then closes it', async () => {
    open();
    const db = await loadDb();
    const prev = await db.stampSale('2026-10-24', 'brisket', 'halfGoneAt', 15, 77, 0);
    expect(prev).toBeNull();
    let row = (await db.loadAll()).sales.find((s) => s.date === '2026-10-24')!;
    expect(row).toMatchObject({ halfGoneAt: 15, cookedLb: 77, leftoverLb: 0, closed: false, unusual: false });

    await db.saveSales([{ ...row, leftoverLb: 6, leftoverUse: 'chili', closed: true }]);
    row = (await db.loadAll()).sales.find((s) => s.date === '2026-10-24')!;
    expect(row).toMatchObject({ closed: true, leftoverLb: 6, halfGoneAt: 15 });
  });

  it('a tap on a row that is already closed leaves it closed', async () => {
    open();
    const db = await loadDb();
    await db.saveSales([{ date: '2026-10-24', meatId: 'brisket', cookedLb: 70, leftoverLb: 5, cateringLb: 0, soldOutAt: null, halfGoneAt: null, leftoverUse: 'binned', closed: true }]);
    await db.stampSale('2026-10-24', 'brisket', 'soldOutAt', 19.5, 0);
    expect((await db.loadAll()).sales[0]).toMatchObject({ soldOutAt: 19.5, closed: true });
  });

  it('"half gone" after the 86 is refused inside the transaction and nothing is written', async () => {
    open();
    const db = await loadDb();
    await db.stampSale('2026-10-24', 'brisket', 'soldOutAt', 14, 77, 0);
    await expect(db.stampSale('2026-10-24', 'brisket', 'halfGoneAt', 17, 77, 0)).rejects.toThrow(/Already 86d/);
    expect((await db.loadAll()).sales[0]).toMatchObject({ soldOutAt: 14, halfGoneAt: null });
  });

  it('undo and clear still work after an 86, and a half-gone tap before the 86 is allowed', async () => {
    open();
    const db = await loadDb();
    await db.stampSale('2026-10-24', 'brisket', 'halfGoneAt', 13, 77, 0);
    await db.stampSale('2026-10-24', 'brisket', 'soldOutAt', 14, 77, 0);
    await db.stampSale('2026-10-24', 'brisket', 'soldOutAt', null, 0); // undo the 86
    await db.stampSale('2026-10-24', 'brisket', 'halfGoneAt', null, 0); // clear half gone
    expect((await db.loadAll()).sales[0]).toMatchObject({ soldOutAt: null, halfGoneAt: null });
  });

  it('a backup restore keeps both flags', async () => {
    open();
    const db = await loadDb();
    const all = await db.loadAll();
    await db.replaceAll({
      ...all,
      sales: [{ date: '2026-10-20', meatId: 'brisket', cookedLb: 70, leftoverLb: 0, cateringLb: 0, soldOutAt: 15, halfGoneAt: null, leftoverUse: null, closed: false, unusual: true }],
      plans: [], cooks: [],
    });
    expect((await db.loadAll()).sales[0]).toMatchObject({ closed: false, unusual: true });
  });
});
