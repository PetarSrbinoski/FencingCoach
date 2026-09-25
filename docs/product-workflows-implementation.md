# Product workflow implementation

Source: `.scratch/product-workflows/issues/01–18`.

## Delivered workflows

| Tickets | Behavior | Regression coverage |
| --- | --- | --- |
| 01 | Nested/legacy day meals, unknown nutrients, gram shopping quantities, partial coverage, preserved plans on failure | `test_mealplan_workflow_api.py`, browser meal/shopping scenario |
| 02 | Durable Garmin completion status, refreshed fetch times, valid readiness extraction, page/focus refresh | `test_garmin_sync_freshness_api.py`, browser sync scenario |
| 03 | Inclusive competition dates, event links, automatic training precedence, retained manual work | `test_competition_calendar_workflow_api.py`, browser calendar scenario |
| 04 | Separate hard dietary exclusions and soft preferences, bounded validation/retry, saved input context | `test_dietary_planning_workflow_api.py`, browser profile save/reload scenario |
| 05–07 | Selected-date diary, manual entry, revision-checked editing, independently scaled repeat snapshots | `test_nutrition_diary_workflow_api.py`, browser diary scenario |
| 08 | Structured results, validation, legacy-field preservation, explicit clear | `test_competition_results_workflow_api.py`, browser results scenario |
| 09–12 | Atomic coach receipts, retained conversation references, action filters/pagination, exact guarded undo | `test_agent_actions_workflow_api.py`, `test_chat_api.py`, browser Agent logs scenario |
| 13 | Confirmed-weight target policy, explicit goals, macro/energy reconciliation and provenance | `test_target_policy_workflow_api.py`, `test_targets.py`, `nutrition-policy.md` |
| 14–15 | Deterministic dated preview, explicit/idempotent acceptance, immutable versions, effective assignments, deactivation and review state | Competition preview/acceptance API tests, browser preview scenario |
| 16 | Shared read-only date-range lookup and saved answer/version cards | `test_coach_nutrition_lookup_api.py`, browser target-answer scenario |
| 17 | Known-source ingredient quantities, calculated meal/day totals, timing and preparation limits, per-date drafts/acceptance/replacement/history | `test_competition_meals_workflow_api.py`, browser meal-draft scenario |
| 18 | Pending coach comparisons, explicit Apply/Cancel, atomic plan receipts, guarded assignment reversal | `test_coach_plan_actions_workflow_api.py`, browser proposal scenario |

## Verification

- Backend tests use public API seams with controlled provider responses. A failed final AI reply is explicitly tested after four successful coach writes; receipts survive conversation deletion.
- Frontend regression scenarios run in Chromium at desktop and 390 × 844 mobile sizes with controlled API responses. They verify main success flows, result validation, a diary edit conflict, draft review, cancellation and guarded undo.
- Browser command: `cd frontend && npx playwright test --config=playwright.workflows.config.ts`.
- Browser report and any traces/screenshots are under `.scratch/product-workflows/browser-artifacts/`. The protected `testing/` directory is unchanged.
- Backend suite: 318 passed, 5 skipped. Browser suite: 18 passed across desktop and mobile.
- A disposable PostgreSQL 16 container was migrated from an empty database through `0014_workout_day_revisions`. A concurrent direct workout edit and Undo request verified that Undo waits for the edit transaction and then returns a conflict without overwriting it. Stale and repeated target acceptances were also checked against PostgreSQL. A persistent workout-date revision also protects later set-and-reset edits when no override remains.
- Ruff, mypy, frontend ESLint, TypeScript, and the production build were run. ESLint configuration/dependencies were added because the original lint command opened an interactive setup prompt.
- Standards and spec review reports, with the fixes made from each, are in `product-workflows-review.md`.

## Practical limits

- Competition meal drafts use known personal-food and cached USDA records. Missing core nutrient data cannot be used to claim target compliance. Preparation-time limits require known food preparation times. Budget affordability is disclosed as unverified when prices are unavailable.
- Dietary exclusions use a documented bounded ingredient-name screen. Ambiguous restrictions require clarification; packaged allergens and cross-contact require label review.
- Live provider generation and Garmin credentials were not used in regression checks. No production data was modified, no deployment was performed, and the branch is not merged to `main`.
