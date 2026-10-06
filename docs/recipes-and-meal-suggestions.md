# Recipes and practical meal suggestions

Implemented local Future AI tickets 03, 04, 05, 07, 08, 09, and 10.

## Using the features

- Nutrition → Foods → My recipes: compose or import text, review sources and yield,
  then save. Open Edit or Log portion from a compact recipe card.
- Nutrition → Plans → Eat now: enter available foods and preparation time. Review
  options and explicitly choose Save as reusable meal or I ate this.
- Coach chat: identify a saved recipe or a dated historical meal, specify its
  amount and destination, and request logging. Ambiguous sources require clarification.
- Voice review: select a familiar recipe or previous meal and adjust only the
  relevant ingredient multipliers before confirming consumption.

The Diary header has no date changer or floating meal shortcut panel. Recent foods use searchable cards with Add
again and Adjust portion; only an opened adjustment shows its amount controls.
Foods eaten starts collapsed with an entry count; links to a specific diary entry
expand the list automatically.

## Data and calculations

Migration `0017_recipes_and_drafts` adds recipes and durable nutrition drafts.
Run the normal Alembic upgrade before starting the updated backend.

Recipe ingredients retain nutrient snapshots and provenance. Arithmetic uses
Decimal and exposes whole-recipe and per-portion values. Missing values remain
unknown, including incomplete micronutrient coverage; unresolved quantities,
measurement basis, yield, or core nutrients block consumption logging. Grams
require known total prepared weight. Explicitly selecting a current food refreshes
its snapshot; otherwise editing a recipe retains its existing ingredient values.

Logging saves the consumed composition and source revision. Editing foods or
recipes does not rewrite previous meals. Historical references use the recorded
composition, and manually edited totals cannot serve as reliable ingredient sources.

Draft revisions guard review and acceptance. Writes and action receipts commit
atomically. Persistent request identifiers make retries idempotent. Undo refuses
to overwrite later changes or remove recipes with recorded consumption.
Suggestions recheck constraints and sources and require a day-fit refresh when
intake, targets, restrictions, or memory change. Refresh preserves reviewed quantities.

Model outputs provide structured ingredient choices; application code computes
the totals. Suggestions expose incomplete diaries and unknown nutrient coverage.
Ingredient-name screening is limited to supported dietary restrictions and cannot
verify packaged allergens or cross-contact. No image input or analysis is included.

## Verification

```bash
.venv/bin/python -m pytest
.venv/bin/mypy backend/app backend/tests llm
.venv/bin/ruff check backend/app backend/tests
cd frontend
npm test
npm run lint
npm run build
cd ..
bash testing/scripts/run_future_ai_checks.sh
```

The final script needs Docker and installed Playwright Chromium. It creates a
disposable PostgreSQL 16 container on port 15439, upgrades/downgrades the migration,
checks concurrent acceptance and receipt-failure rollback, and runs desktop/mobile
browser workflows. Servers use ports 18009 and 13009. External model and speech
adapters are controlled; the script does not call live providers or use production
data. Its trap removes the container and stops its servers. Artifacts are ignored
under `testing/.artifacts/future-ai`.

Existing memory test doubles were updated to support streamed chat; a generation
test was corrected to distinguish child cancellation from request cancellation.

## Standards

The review found that undoing creation retained a unique recipe name and blocked
recreation. Undo now releases the name, with an API regression test. The follow-up
review found no remaining significant issues.

## Spec

The review identified missing chat grams support and incomplete clarification
coverage. Shared conversion now serves chat and the interface. Controlled API
tests cover historical snapshots, ambiguous matches, unknowns, stale selections,
retries, and undo conflicts. Browser checks cover chat clarification, voice source
selection, and infeasible suggestions with recovery. The follow-up review found
no remaining concrete gaps.

Review summary: zero remaining findings in either axis.

Final checks: 383 backend tests passed (5 skipped), 3 PostgreSQL checks passed,
16 browser checks passed, and 2 frontend unit tests passed. Python and TypeScript
type checks, Ruff, and production build passed. Frontend lint retains one existing
estimate-polling dependency warning.
