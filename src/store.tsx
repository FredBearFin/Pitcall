import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Meat, PlanRecord, SaleRecord, Settings } from './types';
import * as db from './db';
import { DEFAULT_SETTINGS, type CookRow } from './logic';

interface Store {
  ready: boolean;
  meats: Meat[];
  settings: Settings;
  plans: PlanRecord[];
  sales: SaleRecord[];
  cooks: CookRow[];
  error: string | null;
  setError: (e: string | null) => void;
  reload: () => Promise<void>;
  /** Run an async action; any throw becomes the visible error banner. Returns undefined on failure. */
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [meats, setMeats] = useState<Meat[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [cooks, setCooks] = useState<CookRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const d = await db.loadAll();
    setMeats(d.meats);
    setSettings(d.settings);
    setPlans(d.plans);
    setSales(d.sales);
    setCooks(d.cooks);
  }, []);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }, []);

  useEffect(() => {
    (async () => {
      await run(async () => {
        await db.getDb();
        await reload();
      });
      setReady(true);
    })();
  }, [reload, run]);

  const value = useMemo(
    () => ({ ready, meats, settings, plans, sales, cooks, error, setError, reload, run }),
    [ready, meats, settings, plans, sales, cooks, error, reload, run],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
