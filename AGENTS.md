# Pitcall: notes for coding agents

Pitcall is an Expo (SDK 58) / React Native / TypeScript phone app that tells a barbecue joint how many briskets, pork butts
and racks of ribs to put on the smoker tonight, and when. Everything runs on the phone: SQLite storage, no server, no accounts.
See `README.md` for the screens and the file layout.

## Expo has changed: do not trust your training data

Expo ships breaking changes every SDK release. Before writing code that touches an Expo, EAS, or React Native API, read the
major version of `expo` in `package.json`, fetch the matching docs at `https://docs.expo.dev/versions/v<major>.0.0/`, and use
`https://docs.expo.dev/llms.txt` as an index. Do not answer from memory.

## How this app is put together (read before changing structure)

- **No Expo Router.** `index.ts` registers `App.tsx`, which holds the four tabs (Tonight, Service, Close, Week) in plain state,
  plus Settings and the first-run Intro as overlays. Do not add `src/app/` or `expo-router` unless asked.
- **The engine is pure.** `src/engine.ts` and `src/logic.ts` have no database, no React and no clock reads in their maths;
  keep it that way so they stay testable. All SQL lives in `src/db.ts`, parameterized only.
- **Motion is cosmetic.** `src/motion.tsx` must never delay or block an action, and must respect Reduce Motion.
- **Service night, not calendar day.** Before 4 am still belongs to the night that just ended (`serviceClock` in `logic.ts`).
- **A tap-only Service row is not a closed night** until Close saves it (`isClosedRow`, `hasDemandSignal`).

## Commands

```bash
npx expo install <package>   # use instead of npm/yarn add: resolves SDK-compatible versions
npx expo start               # dev server (put-on alarms do not fire in Expo Go; use a development build)
npm test                     # vitest
npm run typecheck            # tsc --noEmit
npx expo-doctor              # diagnose dependency and config issues
```

Run `npm test` and `npm run typecheck` before declaring any task done. A bug fix gets a regression test that fails without
the fix (remove the fix and check it goes red).

## Native code and builds

If `ios/` and `android/` do not exist they are generated; never edit them by hand. Configure native behaviour in `app.json` and
config plugins. After adding a library with native code the app needs a development build (`eas build --profile development`
or `npx expo run:ios|android`). Run EAS as `npx eas-cli@latest <command>`.
