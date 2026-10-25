# Launch checklist

Status as of Oct 25, 2026 (evening). "Founder" means only the owner can do it (accounts, money, signatures, a real phone).
"Claude" means it can be built or drafted in a coding session.

## A. Business setup (founder; start first because of waiting times)

- [ ] Check the Werner employment agreement for an outside-business or IP-assignment clause before charging customers.
- [ ] Form the LLC in your state. Nebraska has a newspaper-publication requirement for new LLCs; check the Secretary of State's current rules, fees and timing before filing.
- [ ] Get a free EIN from the IRS (irs.gov), then open a business bank account.
- [ ] Request a D-U-N-S number for the LLC (free, can take days to weeks). Apple and Google organization accounts ask for it.
- [ ] Enroll the LLC in the Apple Developer Program (about $99 a year). Confirm the price on Apple's site before paying.
- [ ] Create a Google Play Console organization account (about $25 once). Confirm whether organization accounts skip the closed-testing requirement that applies to new personal accounts.
- [ ] Pick a support email on a domain you control, and a place to host the privacy policy, terms and support page as public web pages (the stores need URLs).

## B. Decisions only the founder can make

- [ ] Bundle ID. Currently the placeholder `com.fredbearfin.pitcall` in `app.json`. It can be changed freely until the first store submission, and cannot after.
- [ ] Company name and the app's store name. Fill the bracketed items in the three documents in this folder.
- [x] Blank leftover on Close is now an error, with a "None left" button (done while you were away; default chosen: refuse, because a silent 0 teaches the forecast the wrong demand). Say so if you would rather it default to 0.
- [x] An 86 that a big leftover contradicts (more than 15% of what was cooked, at least 5 lb) is kept but ignored by the forecast, and Close warns. Thresholds are `SOLD_OUT_CONTRADICTION_PCT` and `SOLD_OUT_CONTRADICTION_MIN_LB` in `src/logic.ts`.
- [ ] Add a "lost" pounds field to Close (dropped or ruined meat), or accept that it is counted as sold? Not built; today lost meat reads as sold.
- [x] Over-production fix (you flagged it): Settings now has "Sale really lost if you run out", default 0.7 (1 = the old math, every 86 is a lost sale). The old math lost $33 a night to the owner's gut if only half of sell-outs were really lost. Pitcall at 0.7 still leaves about twice the leftover of a balanced owner (37 lb versus 19 a night across five meats). Lower the number for a more waste-averse app, e.g. 0.55. Decide the shipped default; the code constant is `DEFAULT_LOST_SALE_SHARE` in `src/logic.ts`.
- [ ] The Week headline "Pitcall found you $X" is a cautious lower bound that was negative in 57% of simulated weeks even when the true gain was large. Stopgap shipped: a negative figure now reads "Pitcall can't prove a gain this week" instead of red "found you -$X". Better fix is a trailing 4-week figure shown only after about 28 nights (see `docs/SIMULATION.md`, point 5). Your call; it is the number owners will judge the app by.
- [ ] The first week is the app's weak spot (typed guess too high means over-cooking). Consider making the typed "usual night" guess a required, explained step on first run, with a sanity check against the smoker size.
- [ ] Forecast change made while you were away: after one full week the typed guess is level-corrected from the nights seen (commit `caca197`; simulation says guess 30% too high goes from +$4 to +$63 a night over the owner by nights 29-70). It changes the documented "shrink toward the owner's guess" rule after week 1. Revert that single commit if you disagree.
- [ ] Price: one plan at $29 to $49 a month is still unverified. Pick a number.

## C. First real-device run (founder; Claude fixes whatever breaks)

- [ ] Run `npx eas-cli@latest login`, then `npx eas-cli@latest build --profile development --platform android`, and install the build on the Android tablet.
- [ ] Run one full night: set a plan, accept it, confirm the put-on alarm fires with the screen off and with battery saver on, restart the phone and confirm a pending alarm still fires, tap 86 and half gone, close out, export a backup, restore it.
- [ ] Repeat on the iPhone once the Apple Developer account is active (`--platform ios`; iOS device builds need the account).
- [ ] Look at every screen on a small phone and a large one, in the dark and in daylight.

## D. Things Claude can build or has built

- [x] EAS build profiles (`eas.json`: development, preview, production) and `expo-dev-client`. Verified with `expo prebuild` for both platforms.
- [x] Native config: bundle ID, package name, no export-compliance prompt on iOS, `expo-system-ui` so the dark background applies natively.
- [x] Trial-gate logic (`src/trial.ts`): free until 14 closed service nights are logged, then 30 days, then expired. Tested. Not wired into the screens yet.
- [x] Drafts: privacy policy, terms, store listing text (this folder). Need your details and a lawyer's review.
- [ ] Subscription and paywall: needs the store accounts and products to exist first. Plan: RevenueCat plus App Store and Play subscription products, a paywall screen, restore purchases, and wire `accessState` to the real subscription state. When expired, block new planning but never lock backup export or the Week screen.
- [x] Original app icon, splash screen, Android adaptive and monochrome icons (an amber flame inside a twelve-mark clock ring on the dark theme colour; generated by script, so tell me if you want a different mark or a designer's).
- [ ] Screenshots from a real device (list in `store-listing.md`).
- [x] Data-quality fixes: blank leftover, contradicted 86, and the "found you" claim no longer overstating when an 86 is forgotten (commit `a3439a5`).
- [x] Simulation study and 70-night soak test (`docs/SIMULATION.md`, `src/soak.test.ts`). The study is a model, not proof; real nights are the real test.
- [ ] Recover or re-implement the Z-hardened web build's extra protections if you find it (carry-in, lost pounds, food-safety close checks).

## E. Submission

- [ ] Production build: `npx eas-cli@latest build --profile production --platform all`.
- [ ] Create the app in App Store Connect and Play Console, fill the privacy labels to match the privacy policy, upload screenshots and listing text.
- [ ] Submit: `npx eas-cli@latest submit --platform ios` and `--platform android`, or upload by hand.
- [ ] Expect review questions about the subscription and the free period; the reviewer notes in `store-listing.md` are a starting point.
