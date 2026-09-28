# Product workflow review

Baseline: `e36afbc4dc439d8f2f267a090019043a0d8d296c` (start of implementation).
Initial reviewed commit: `f8de5ee`. Spec: `.scratch/product-workflows/issues/01–18`.
The code-review skill ran Standards and Spec reviews in parallel. Their findings
are kept separate below. Follow-up fixes are included on `feature-rework`.

## Standards

No hard violation of documented `AGENTS.md` guidance was found. Requests remain
centralized in the typed API client. `testing/` and the user-owned `FUTURE.md`
are outside the changes.

Three judgment-call findings:

1. **Possible duplicated code:** target advisory locks appeared in three
   modules despite the shared transaction helper. Fixed by using
   `lock_nutrition_inputs` at all acceptance/reversal boundaries.
2. **Possible primitive obsession/repeated switches:** action kinds/statuses
   were unrestricted strings and workout summaries used `any`. Added explicit
   kind/status unions and checked exercise records. Generic historical snapshot
   payloads remain intentionally flexible; a fully discriminated snapshot union
   remains an optional refactoring suggestion.
3. **Possible divergent change:** the meal router owned version allocation,
   superseding, and menu persistence. Moved this lifecycle logic into
   `stage_accepted_meals` in the meal service, retaining the caller's commit.

A separate implementation observation found that reversal receipts offered
unsupported Undo controls. Fixed the action-kind guard and added a browser
check. The same check exposed an Undo error disappearing during refresh; errors
now remain visible while the receipts reload.

## Spec

Seven concrete gaps were found and fixed:

| Finding and ticket requirement | Fix and verification |
| --- | --- |
| 04: “Validate proposed ingredients against resolved exclusions before accepting a plan.” Singular-only matching missed peanuts/eggs; vegetarian/vegan missed some shellfish. | Plural matching and shellfish rules; four API regressions reject these ingredient names. |
| 02: “Failed or partial syncs distinguish usable readings from unavailable or unchanged readings.” Endpoint failures were swallowed into success. | Fetch failures propagate into durable partial outcomes; API and desktop/mobile browser checks distinguish partial results. |
| 01: “Shopping coverage identifies missing or unusable days accurately.” Named meals with empty/bad ingredients counted as complete. | Every meal needs usable named ingredients and finite positive gram quantities for full coverage. Valid partial quantities remain listed; an API regression checks both cases. |
| 07: “Scale known nutrient quantities and compatible item quantities consistently.” Confidence and source metadata were multiplied. | Only nutrient quantities and item grams scale. Numeric uncertainty/source metadata remain unchanged and are excluded from daily nutrient totals; API regression verifies this. |
| 17: Accepted meals must retain “useful timing and portions” and remain usable. Menus disappeared after acceptance. | Accepted and historical menus now show names, timing, ingredients/grams, provenance, totals and warnings. Browser checks inspect accepted menus after reload. |
| 16: “links that open the exact plan or diary date.” Plan links opened only an event selector. | Links include plan ID; history opens and scrolls to the referenced version, retaining saved context if its event is unavailable. API/browser checks verify navigation. |
| 18: “Refresh all affected target consumers after application/reversal.” Mounted Nutrition views stayed stale. | Shared change notifications refresh affected views in the current tab, across tabs, and on focus; browser check verifies updated target values on return. |

No concrete unrelated feature was found. The current branch has not been merged
to `main`.

Summary: Standards reported three judgment-call findings and one separate UI
observation (no hard violations); Spec reported seven functional gaps. Duplicate
locking was addressed within Standards; dietary exclusion bypasses and all six
other Spec gaps were addressed. The full snapshot-type refactor is optional.
