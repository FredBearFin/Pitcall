# Pitcall

Phone app that tells a BBQ joint how many briskets, pork butts and ribs to put on tonight, and when.
Expo SDK 58 · React Native · TypeScript · SQLite on the phone · no server, no accounts.

## Run it

```bash
npm install
npx expo start          # scan the QR with Expo Go, or press a/i for an emulator
npm test                # 151 tests (engine, logic, hostile backup files, regression fixes, cook-time floor, close-out rules, trial gate, motion timings, and the real SQL against SQLite)
npm run typecheck
```

If put-on alarms don't fire in Expo Go, build a development client instead:
`npx expo run:android` (or `npx eas-cli@latest build --profile development --platform android`; profiles are in `eas.json`).

Launch material (privacy policy, terms, store listing, and the founder checklist) is in `docs/launch/`.

## Layout

| File | What it is |
|---|---|
| `src/types.ts` | Shared data shapes + engine function signatures |
| `src/engine.ts` | Pure math: demand recovery, forecast, newsvendor count, cook clock, savings check |
| `src/logic.ts` | Pure helpers: history pipeline, week summary, backup validator |
| `src/db.ts` | SQLite (parameterized SQL only) |
| `src/store.tsx`, `src/notify.ts`, `src/backup.ts` | App state, local alarms, JSON backup |
| `src/screens/` | Tonight, Service, Close, Week, Settings, and a first-run Intro |

## Day-to-day

1. **Tonight** — type your own number first, tap "Show Pitcall's number", adjust, Accept (sets put-on alarms).
2. **Service** — tap "86 <meat>" when it sells out (10-second undo); optional "Half gone".
3. **Close** — leftover lb, what it became, catering lb. Save.
4. **Week** — "Pitcall found you $X" against your own numbers (can be negative).

## Pilot fixes (Oct 25)

- The "Pitcall says" number is now always inside its own "Good range" (it used to fall outside it when a leftover outlet's daily cap bound).
- A row made only by a Service tap is no longer read as a closed night. Close marks the night closed; a tap-only row counts as demand only if the meat sold out.
- "Half gone" can no longer be tapped after the 86, and old half-gone times later than the 86 are ignored.
- Service, Close and Week use the service night, not the calendar day: before 4 am still belongs to the night that just ended, and Close says which night it is closing.
- First-run intro (4 short pages, reopen it from Settings) and an "Unusual night" tick on Close that keeps a storm or event out of what the forecast learns.
- Database moves to version 2 (adds `closed` and `unusual` to `sale`). Existing rows stay "closed", because a tap-only row from the old version cannot be told apart from a closed one. Backups carry both flags and old backups still import.
- Close no longer saves a blank leftover as 0. A leftover is required whenever anything was cooked (a "None left" button types the 0), because a fake 0 reads as "sold exactly what was cooked" and teaches the forecast the wrong demand.
- An 86 that the leftover contradicts (more than 15% of the cooked weight and at least 5 lb still left) saves with a warning, and its sell-out time is ignored by the forecast and the week summary, so it cannot inflate demand. Tunable: `SOLD_OUT_CONTRADICTION_PCT` and `SOLD_OUT_CONTRADICTION_MIN_LB` in `logic.ts`.
- All Close validation now lives in `closeCheck` (pure, tested) instead of inside the screen.

## Motion

Every movement is cosmetic and short (90 to 360 ms). Nothing loops. Code: `src/motion.tsx` (components), `src/motionMath.ts` (timings, tested).

- Tabs: the screen slides a short way from the side you are moving toward, and a marker slides under the active tab. Settings and the intro slide up over the app; the error banner drops in and out.
- Cards fade and rise in a short stagger (capped, so a long screen is not slow). Buttons, steppers, chips and ticks give a small press-scale.
- Numbers count up: the headline count on Tonight, and the money on Week each time the tab opens.
- Service: the 86 undo bar floats over the top instead of pushing the cards down, with a bar draining over the 10 seconds. A card gives a small bump when its meat is 86'd.
- Intro pages slide in from the side you are moving toward.
- With the phone's Reduce Motion setting on, everything snaps with no movement.

Written without a device run: look at it on a real phone before judging the feel (the durations are one place to tweak: `DUR` in `motionMath.ts`).

## Known gaps (prototype)

Not run on a real device yet (the SQL is tested against SQLite, but expo-sqlite, notifications, the screens and the animations are not). Not built: event/holiday calendar screen,
all-meat weekday factor, multiple leftover outlets, week profit/break-even, per-piece weights (so "largest piece first" is not a thing yet), billing and the trial,
a web build. Step 1 uses a single conditional-expectation pass rather than iterated EM. Lint is not set up.

## License

Proprietary. All rights reserved (see `LICENSE`).
