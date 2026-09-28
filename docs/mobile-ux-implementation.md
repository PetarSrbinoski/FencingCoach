# Mobile-first implementation

Branch: `mobile-first-ux`. Baseline: `aac259a`.

This implements the [mobile UX review](mobile-ux-review.md) in the existing Next.js frontend. All eight routes remain available. Backend services, calculations, API contracts, optimistic concurrency versions, preview tokens, request IDs, and the distinction between accepting a plan and logging food consumption are preserved.

## Navigation and clean defaults

The mobile dock contains Today, Training, Nutrition, Coach, and More. More contains Trends, Competitions, Garmin, Profile, theme, and coach-provider settings. The desktop sidebar begins at 1024px; collapsing it also releases the corresponding content width.

| Screen | Default experience | Further capabilities |
| --- | --- | --- |
| Today `/` | Readiness, short brief, training and food actions, next event | Full brief, readiness explanation, recovery readings, activity history, coach handoff |
| Training `/training` | One selected day with a scrollable week selector | All seven days, adjacent weeks, overrides/reset, competition context; Fencing and Mindset views |
| Nutrition `/nutrition` | Date, Add food, daily intake, entries | Plans → Today / Competition / Shopping; Foods; nutrients, target settings and calculation explanations |
| Competitions `/competitions` | Upcoming event list | Past events, creation/editing in an editor, results and event actions in a menu, nutrition links |
| Trends `/weekly` | Weekly summary and one recovery metric | All recovery metrics and exact values, Training and Nutrition views, expandable activity records |
| Coach `/chat` | Compact toolbar, conversation and multiline composer | History sheet/sidebar, Coach actions, target references, proposal review, pending-reply recovery |
| Garmin `/garmin` | Connection state, latest result, Sync now | Older history import, coverage, technical details |
| Profile `/profile` | Athlete basics | Training goals, nutrition preferences and notes; reachable save/discard bar and recoverable drafts |

Local view selection is URL-backed and responds to browser Back/Forward. Existing dated diary, event, accepted-plan, food and training links are retained. A saved-food portion's chosen date becomes the selected diary date after logging.

## Review findings addressed

| Review finding | Implementation |
| --- | --- |
| 01, 16: clipped chat / phone reading model | Compact action toolbar; visual viewport sizing; multiline composer; only the message panel scrolls; Jump to latest when reading earlier content |
| 02, 22: competition density | Full-width event information; Upcoming/Past views; action menu; separate event/result editors |
| 03, 20: overloaded nutrition | Diary / Plans / Foods; planning subviews; optional calculation and nutrient details; focused food-entry editor |
| 04: remote edit forms | Shared, bounded editors put editing at the current point of interaction |
| 05, 10, 13: small controls | Shared buttons and icon actions at least 44px; 48px inputs/selects; 16px input text; thumb-friendly mental score controls and native dates/times |
| 06: premature desktop layout | Sidebar at 1024px; layouts stack before there is adequate content width; responsive cards replace phone tables |
| 07, 29: type and text density | Smaller page headings; legible control text; shorter introductions; full notes/briefs remain expandable; technical details are secondary |
| 08: dashboard hierarchy | Readiness and brief first; direct training/food actions; secondary recovery and activity information collapsed |
| 09: week-first training | Selected day first; full week and week navigation remain accessible |
| 11: profile save position | Fixed save/discard actions above the dock; grouped fields; keyboard-aware positioning; draft storage and navigation guard |
| 12: form labels | Associated profile labels, labelled food/macro fields and dates, named icon actions, explicit meal-slot controls |
| 14: status contrast | Shared light/dark success and warning tokens; fewer faint labels; status meaning appears in text |
| 15: desktop tables | Fencing and activity cards on phones; dated expandable target references in chat; desktop tables retained where useful |
| 17: background tasks | Human-readable progress; distinction between hiding progress and stopping server work; pending chat/estimate resume controls |
| 18: dense action history | Filter disclosure, compact summaries, expandable Before/After/Undo, direct receipt selection and preserved conflict feedback |
| 19: food logging mixed with management | Saved-food picker plus portion preview; dedicated Foods management view; incremental list reveal; full nutrient editing preserved |
| 21: nested competition planning | Setup disclosure; target-preview editor with affected dates/warnings and explicit acceptance; meal-preview editor; expandable plan/menu history |
| 23: deep-link destinations | Nutrition view inference; linked accepted plan expansion; dated training selection; past-event nutrition access; unavailable-reference feedback |
| 24, 30: charts and accessibility | One metric at a time; exact-value date selector usable without hover; missing-point gaps; unique gradient IDs; reduced-motion and focus styles |
| 25: Garmin hierarchy | Status before sync actions; concise result text; older history and raw details behind disclosures |
| 26: failure feedback | Explicit errors and retries on key resource reads; unavailable readings distinguished from zero; stale day content cleared when changing diary dates |
| 27: confirmations/notifications | Async confirmations remain open on failure and prevent duplicate submission; reset/clear/delete confirmations; capped notifications positioned above the dock |
| 28: navigation discovery | Five mobile destinations, labelled More settings, consistent Trends naming, URL-backed local views |

The implementation uses bottom sheets, full-height mobile editors, sticky editor actions, progressive disclosure and a persistent dock. Swipe-only gestures were not introduced: all actions have visible buttons or menus and remain keyboard accessible.

## Regression coverage

`frontend/e2e/workflows.spec.ts` keeps the existing business-flow assertions and follows the reorganized navigation. It covers profile persistence, guarded Undo conflicts, coach proposals, competition meal acceptance, event results, Garmin sync outcomes, diary edits/repeats, training overrides, shopping coverage and target acceptance.

`frontend/e2e/mobile.spec.ts` adds checks for all eight routes at 320, 390, 768 and 1280px; page overflow and primary-control dimensions; secondary views; URL history; date-correct saved-food portions; failed deletions; unsaved profile navigation; editor size/focus; and positioning under a simulated reduced keyboard viewport. Synthetic data is isolated in `frontend/e2e/mobile-fixtures.cjs`.

Browser tests mock the API and verify frontend behavior and submitted payloads. They do not exercise a live Garmin account or LLM. Physical iOS/Android keyboards, screen readers and native picker rendering still need device verification; browser viewport checks alone cannot establish those results.

Validation commands:

```sh
cd frontend
npm run lint
npx tsc --noEmit
npm test
npx playwright test --config playwright.workflows.config.ts
npm run build
```

The original review records the pre-change measurements; it is not a description of the redesigned branch.

## Validation result

- Frontend lint and TypeScript checks passed.
- All 7 existing frontend unit tests passed.
- The full 36-case desktop/mobile suite passed before the final keyboard and visual refinements.
- All 6 focused follow-up checks passed against the final production build, covering all routes at 320px, secondary views/editors, and the simulated keyboard viewport on both desktop and mobile configurations.
- The final production build completed successfully.

The later expanded full-suite run was interrupted; its partial progress is not counted as a completed run.
