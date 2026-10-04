# Future AI capabilities: coach memory and practical nutrition workflows

## Problem Statement

The athlete repeatedly explains preferences and practical constraints to the coach, while temporary circumstances can keep influencing advice after they stop applying. There is no dedicated, editable view of the context the coach remembers.

Nutrition entry is inconvenient on a phone. Familiar meals require repeated typing, and homemade recipes require repeated ingredient entry or estimation. Daily targets and full meal plans also leave a gap when the athlete needs to choose something available and quick to eat now.

These workflows need to preserve trust in the diary: unknown nutrients must remain unknown, suggestions must not become recorded consumption, and changing a saved food or recipe must not rewrite historical meals.

## Solution

Add four connected capabilities to the existing coach chat, My foods, nutrition diary, Profile, and Agent logs:

- **What my coach knows:** an inspectable memory of preferences and constraints, with sources, confirmation dates, optional expiration, editing, deletion, and a control to disable memory use.
- **Voice logging:** speech becomes an editable draft. The athlete corrects the transcription, resolves ambiguities, and reviews interpreted values before saving explicitly supplied food information or logging consumption.
- **What can I eat now?:** two or three practical meal options using recorded intake, effective targets, dietary exclusions, available foods, and preparation time. Explain how each option fits the remaining day and distinguish exact saved values from estimates.
- **Reusable recipes:** convert pasted recipes or text descriptions into reviewed ingredients and portions. Save once, then log whole or partial portions using saved values.

Use deterministic nutrient arithmetic throughout. Keep saving reusable information separate from logging consumption, and make agent changes visible in Agent logs with guarded undo.

## User Stories

### Editable coach memory

1. As an athlete, I want to see what my coach remembers, so that I can understand the context behind its advice.
2. As an athlete, I want to add equipment limitations, so that recommendations fit my gym.
3. As an athlete, I want to record session time limits, so that recommendations fit my schedule.
4. As an athlete, I want to save food preferences, so that I do not repeat them in every conversation.
5. As an athlete, I want to record guidance from my fencing coach, so that the app can account for my current training focus.
6. As an athlete, I want to record temporary circumstances with an expiration, so that travel or other short-term constraints stop influencing later advice.
7. As an athlete, I want to inspect the source of each memory, so that I can understand where it came from.
8. As an athlete, I want to see when a memory was last confirmed, so that I can identify outdated information.
9. As an athlete, I want inferred preferences to be visibly different from facts I supplied, so that I can correct assumptions.
10. As an athlete, I want to confirm or correct an inferred preference, so that future advice uses the right context.
11. As an athlete, I want to edit or delete a memory, so that I remain in control of remembered information.
12. As an athlete, I want to disable memory use without deleting every entry, so that I can choose whether stored context personalizes advice.
13. As an athlete, I want expired and deleted memories excluded from future memory context, so that obsolete information stops being presented as current.
14. As an athlete, I want memory changes shown in Agent logs with safe undo, so that I can inspect and reverse unwanted updates.

### Voice logging

15. As an athlete, I want to dictate what I ate, so that logging is convenient on a phone.
16. As an athlete, I want to review and correct a transcription, so that recognition mistakes do not reach my diary.
17. As an athlete, I want familiar foods and meals matched to saved entries, so that logging reuses their established values.
18. As an athlete, I want to describe changes such as half the usual rice, so that I can record a variation without rebuilding the meal.
19. As an athlete, I want clarification when a food, meal, serving, or quantity is ambiguous, so that the coach does not choose for me.
20. As an athlete, I want to see whether dictated food values are per serving or per 100 grams, so that I can verify the interpretation.
21. As an athlete, I want a named serving such as a 150-gram pot saved with a product, so that later portions are easy to log.
22. As an athlete, I want unclear or missing dictated values highlighted, so that I can supply corrections without invented nutrients.
23. As an athlete, I want to review dictated nutrient values and units before saving, so that mistakes do not enter My foods.
24. As an athlete, I want to save an incomplete food while seeing what prevents logging, so that I can finish entering it later.
25. As an athlete, I want saving dictated food information to leave my diary unchanged, so that buying or identifying a product is not treated as eating it.
26. As an athlete, I want to confirm the meal, day, and amount before committing a voice consumption draft, so that the diary records what I actually ate.
27. As an athlete, I want to cancel a draft or recover from failed transcription, so that unsuccessful input does not create saved foods or meals.
28. As an athlete, I want repeated confirmation or a network retry to produce one change, so that meals are not duplicated.
29. As an athlete, I want voice-initiated changes recorded in Agent logs with safe undo, so that I can correct a mistaken save or log.

### Practical meal suggestions

30. As an athlete, I want suggestions based on today's recorded intake and effective targets, so that they fit the rest of my day.
31. As an athlete, I want the coach to check whether my diary is reasonably complete, so that missing entries are not mistaken for a true shortfall.
32. As an athlete, I want to state which foods I have available, so that suggestions are practical immediately.
33. As an athlete, I want to set a preparation-time limit, so that suggestions fit the time I have.
34. As an athlete, I want two or three concrete options with quantities, so that I can make a quick choice.
35. As an athlete, I want suggestions to respect my dietary exclusions, so that a nutrient target never overrides a restriction.
36. As an athlete, I want unclear restrictions or missing ingredient information clarified, so that uncertain options are not presented as compliant.
37. As an athlete, I want suggestions to take my food preferences into account, so that the choices are appealing as well as feasible.
38. As an athlete, I want each option's nutrient totals and relationship to the remaining day explained, so that I understand the tradeoffs.
39. As an athlete, I want saved food values distinguished from estimates, so that I know which numbers are established and which are approximate.
40. As an athlete, I want the coach to explain when my available foods cannot satisfy the constraints, so that I can decide what to change.
41. As an athlete, I want to save an option as a reusable meal template, so that I can use it again.
42. As an athlete, I want to log an option only after confirming that I ate it, so that suggestions never inflate recorded intake.
43. As an athlete, I want to adjust the consumed quantity before logging, so that the diary reflects my actual meal.
44. As an athlete, I want saved or logged suggestions visible in Agent logs with guarded undo, so that changes remain reviewable.

### Reusable recipes

45. As an athlete, I want to paste a recipe or type a description of what I cooked, so that I can reuse whichever source I already have.
46. As an athlete, I want recipe ingredients matched to My foods when possible, so that calculations use my actual products.
47. As an athlete, I want to review ambiguous ingredient matches, so that similarly named products are not substituted silently.
48. As an athlete, I want missing ingredient quantities clarified, so that recipe totals are based on known amounts.
49. As an athlete, I want raw and cooked measurements distinguished, so that ingredient weights are interpreted correctly.
50. As an athlete, I want supplied and estimated ingredient values identified separately, so that I understand the basis of the recipe totals.
51. As an athlete, I want to review ingredients, quantities, and the number of portions before saving, so that the reusable recipe matches what I cooked.
52. As an athlete, I want nutrition calculated for the whole recipe and each portion, so that serving choices are easy to compare.
53. As an athlete, I want unknown nutrients and incomplete coverage preserved, so that missing information does not appear as a measured zero.
54. As an athlete, I want saving a recipe to leave consumption unchanged, so that preparing food is not treated as eating it.
55. As an athlete, I want to log a named recipe from chat or the nutrition interface, so that homemade meals are as convenient as saved products.
56. As an athlete, I want to log fractional portions, so that I can record the amount I actually ate.
57. As an athlete, I want unclear references such as yesterday's pasta resolved before logging, so that the correct recipe version is used.
58. As an athlete, I want to edit a recipe for future use while preserving earlier meal values, so that my diary remains historically accurate.
59. As an athlete, I want later edits or removal of an ingredient product to preserve saved recipe values until I explicitly update them, so that recipe nutrition does not change unexpectedly.
60. As an athlete, I want duplicate recipe names resolved explicitly, so that a new recipe does not overwrite an existing one by accident.
61. As an athlete, I want agent-created recipes and logged portions recorded in Agent logs with safe undo, so that I can reverse unwanted changes without losing unrelated meals.

## Implementation Decisions

The roadmap establishes the product requirements. The following architecture and contracts are proposed implementation decisions derived from the existing codebase; provider choices and other unresolved details are listed under Further Notes.

### Shared architecture and contracts

- Extend the existing single-user application, using coach chat and the nutrition interface as entry points. Retain My foods, the nutrition diary, Profile dietary restrictions, effective target resolution, and Agent logs as the established domain concepts.
- Reuse the saved-food service for per-100-gram normalization, named-serving conversion, unit handling, and deterministic portion arithmetic. AI may identify ingredients, transcribe, extract, and propose options; it must not be the calculator for established nutrient values.
- Add structured draft workflows for voice input and text recipe import. Drafts expose interpreted input, matched foods, quantities, nutrient provenance, unresolved questions, and an explicit intended action. Draft creation and review do not mutate the library or diary.
- Keep extraction progress separate from acceptance: processing may be pending, successful, or failed; a completed draft may still need clarification. Only a valid, reviewed draft can be applied. Cancellation prevents subsequent application.
- Follow the existing background-generation and job-observation pattern for transcription, text recipe interpretation, and suggestion generation. Expose retrievable status and actionable errors; preserve typed/manual entry when a provider is unavailable or lacks a required capability.
- Follow the existing proposal workflow for acceptance. Application is idempotent and validates the reviewed draft revision and relevant referenced resource revisions. A changed food, recipe, or draft requires renewed review rather than silently committing different values.
- Keep resource changes and their Agent log receipts in one transaction. Extend the existing action types and snapshots for memory and recipe changes, using resource revisions to reject undo that would overwrite later edits. Show an actionable conflict when reversal is no longer safe.
- Preserve existing HTTP conventions: invalid input is a validation error, missing resources are not-found errors, and stale or conflicting application returns a conflict. UI and chat must share the same domain operations and validation.
- Add database migrations for new persistent memory, draft, and recipe data and any required action metadata. Existing saved foods and historical nutrition entries remain readable without invented ingredient details or backfilled nutrient values.

### Coach memory

- Add a dedicated memory resource containing content, source information, explicit-versus-inferred provenance, creation/update timestamps, nullable last-confirmed time, optional expiration, and a revision. Unconfirmed inferences must not acquire a fabricated confirmation date.
- Provide list, create, edit, confirm, and delete operations, plus an application setting to enable or disable memory use. Surface these through a clearly named “What my coach knows” view accessible from the coaching experience.
- Make expiration effective when context is read; do not rely on a cleanup job running first. Resolve relative dates with the athlete's existing date/time convention and clarify ambiguous expiration wording. Keep expired entries inspectable and visibly inactive until removed.
- Include only current, enabled memory in the shared context supplied to coaching workflows. Current explicit instructions and structured Profile restrictions take precedence over an inferred preference. Conflicting facts require clarification rather than silent replacement of a hard constraint.
- Agent-added and agent-updated memories must be visible and reversible. User confirmation records the confirmation time and the fact that the athlete confirmed the content; provenance remains inspectable.
- Disabling memory stops retrieval and automatic memory updates until re-enabled. It does not disable Profile dietary restrictions. Deletion removes active memory; existing conversation history and audit receipts are separate records and must not be used to silently recreate a deleted memory.

### Voice logging

- Add phone-friendly microphone controls and a review screen with editable transcription, quantities, and explicit Save food versus Log consumption actions. When the athlete dictates food values, expose nutrient fields, serving basis, and serving weight for review. Handle denied recording permission, unsupported audio, failed transcription, and cancellation without committing domain changes.
- Put transcription behind an external-provider adapter. Validate interpreted speech through the same domain services used by manual entry. Do not assume the configured text model supports speech.
- Preserve the stated basis of dictated nutrient values in the review draft. Convert per-serving values to per 100 grams only when the serving's gram weight is known. Quantities expressed in volume alone need an explicit supported conversion; do not assume a density.
- Carry unclear or missing dictated values as unknown with an explanation. Keep a known zero distinct from a missing value. Preserve nutrient units and existing unit-conversion rules, including the separation of IU from mass units.
- Match saved foods before estimating any unsaved ingredients. Never replace explicitly supplied food values or an existing food's unknown fields with guessed nutrients. Resolve duplicate product names through explicit update or a distinct variant.
- Preserve the existing rule that an incomplete saved food can be stored, but calories, protein, carbs, and fat must be available before logging it through the saved-food flow. Optional unknown nutrients remain unknown.
- For speech about a familiar meal, resolve a saved recipe/template or an identifiable historical meal and then apply explicit portion changes. Ask for clarification if “usual” does not identify one known composition.
- Require review before committing interpreted speech drafts even when the utterance describes consumption. This does not add an unrelated review step to the existing direct text command for logging a clearly specified saved-food portion.

### Immediate meal suggestions

- Add a suggestion workflow that reads the athlete's selected day, effective targets, diary totals, Profile restrictions/preferences, enabled relevant memories, available foods, and preparation-time limit. Read targets through the existing effective-target resolver; do not substitute model-generated targets or change target policy.
- Treat diary completeness as context to clarify with the athlete, not something inferred solely from low totals. Explain that the apparent remainder is based on recorded intake when completeness is uncertain.
- Generate two or three distinct feasible options when possible. Each option includes ingredients, quantities, preparation-time information, calculated nutrients, provenance, and an explanation of its fit against the remaining day.
- Validate hard exclusions after generation using the existing dietary-rule workflow. Unsupported restriction wording or insufficient ingredient detail requires clarification. Existing checks screen ingredient names; they do not establish product allergen or cross-contact guarantees.
- Enforce stated availability and preparation constraints. Unknown preparation time is not zero. If fewer than two valid options exist, return the valid options and explain the limiting constraints rather than relaxing them silently.
- Calculate remaining amounts and option totals deterministically, preserving unknown coverage and visibly marking any estimated ingredients. Exceeding a target does not create a negative portion recommendation.
- Keep suggestion generation read-only with respect to foods, recipes, targets, and consumption. Offer separate actions to save a reusable template or confirm actual consumption. Recheck dietary constraints when turning a suggestion into a saved/logged action, and refresh the fit explanation if intake or targets have changed.

### Recipes and reusable meal templates

- Add a reusable recipe representation containing a name, ingredient lines, quantities and measurement basis, nutrient-source snapshots, portion count, calculated totals, provenance, and a revision. A reusable meal template uses the same composition model where possible rather than a separate arithmetic system.
- Retain references to matched saved foods for explanation and explicit future updates, while storing the ingredient values used in the saved recipe. Editing or deleting a source food must not silently recalculate an existing recipe.
- Require positive, finite quantities and a positive portion count. Clarify raw-versus-cooked basis and unsupported quantity conversions before producing loggable portion values. Unresolved drafts can remain drafts without pretending to be completed recipes.
- Compute recipe totals by summing ingredient values and compute per-portion values by dividing by the confirmed portion count. Fractional consumption scales those saved per-portion values. Logging by grams requires a known total prepared weight; never invent one from a portion count.
- Preserve unknown nutrient values and partial coverage across ingredient aggregation. Missing required core nutrients prevent portion logging until resolved; known subtotals must not be presented as complete totals. Any accepted estimated ingredient values remain visibly estimated.
- Save a recipe only after review of matches, quantities, measurement basis, and yield. Saving does not consume it. Later explicit requests to log an unambiguous saved recipe portion may use the established chat logging behavior.
- Snapshot the recipe revision, consumed portion, nutrient totals, ingredient provenance, and uncertainty into each nutrition entry. Recipe edits create a new revision for future use; old logs and repeat-meal operations continue using their recorded snapshots.
- Guard recipe creation, edits, and portion logs with the same duplicate, idempotency, and undo rules as the other workflows. Undoing recipe creation must not remove already recorded consumption; refuse reversal or preserve the required snapshot when later dependencies make deletion unsafe.

## Testing Decisions

- **Confirmed test seam:** use public API workflows as the primary behavior seam, plus focused browser tests for recording and review screens. The API/browser split was confirmed by the user; image-upload coverage was removed with the image features. Prefer exercising a full user operation through existing HTTP boundaries over exposing internal helper functions solely for tests.
- **Good tests:** assert observable drafts, validation errors, persisted resources, diary totals, history preservation, and Agent log/undo outcomes. Do not assert exact AI wording, private call ordering, prompt text, or database layout. Use independently calculated expected values for arithmetic.
- **Controlled external dependencies:** substitute deterministic transcription and model responses at the external-provider boundary. Keep real routing, validation, arithmetic, persistence, and action handling. Live-provider evaluations are optional and are not the acceptance gate.
- **Test placement and prior art:** put new tests under the project's dedicated `testing/` tree. Reuse the API and isolated PostgreSQL setup, saved-food workflow tests, nutrition workflow tests, and food-library Playwright patterns. Existing backend tests for dietary planning, diary repetition, coach proposals, and Agent actions also demonstrate the required behavior patterns.
- **Memory and context workflows:** create explicit and inferred memories, inspect source and confirmation data, edit and confirm them, expire them using a controlled clock, disable/re-enable use, and delete them. Through chat requests with a controlled provider, verify that supplied context includes only applicable memory while hard Profile restrictions remain effective. Verify action receipts, successful undo, and conflict after a later edit.
- **Voice workflows:** submit recorded speech, poll completion, review/correct the transcription and draft, resolve ambiguous matches, and explicitly confirm the intended save or log action. Saving dictated food information must not log consumption. Cover per-serving normalization, missing gram weight, duplicate names, unclear dictated values, unknown versus zero, unit preservation, failed transcription, cancellation, retry, and stale references.
- **Arithmetic acceptance example:** reviewed, explicitly dictated food values of 90 kcal, 6 g protein, 12 g carbs, and 2 g fat per 150 g normalize to 60 kcal, 4 g protein, 8 g carbs, and 4/3 g fat per 100 g. Logging half the named serving yields 45 kcal, 3 g protein, 6 g carbs, and 1 g fat. An unspecified fiber value stays unknown throughout.
- **Suggestion workflows:** seed known foods, diary entries, targets, restrictions, and preparation times; request options and assert feasible quantities and deterministic totals. Cover incomplete diaries, already-exceeded targets, unsupported restrictions, prohibited ingredients, unavailable foods, unknown preparation times, no feasible options, and mixed saved/estimated provenance. Verify that requesting or saving an option does not log consumption, while confirmed consumption logs exactly once.
- **Recipe workflows:** import each supported input form, review ingredient matches and raw/cooked basis, save a four-portion recipe, and log one and half portions. A recipe totaling 2,000 kcal yields 500 kcal per portion and 250 kcal per half portion. Verify missing nutrients, invalid yields, duplicate names, ambiguous recipe references, ingredient-food changes, recipe edits, repeated logs, and unchanged historical values.
- **Transactions and revisions:** use isolated PostgreSQL integration coverage for repeated/concurrent application, atomic resource/action writes, stale drafts, and undo conflicts. Reuse the migration check when schema changes are implemented; SQLite-only tests cannot establish production locking behavior.
- **Focused browser coverage:** exercise microphone permission failure and successful draft review with controlled audio/provider input; separate save/log controls; recipe review; memory inspection and disabling; and accessible, phone-sized layouts. Reload after application to verify persistence and visible Agent logs. Keep broad nutrient and conflict matrices at the API seam.

## Out of Scope

- Publishing issues, adding GitHub labels, or changing an external tracker as part of this specification task.
- Implementing these features as part of writing this document.
- All image input and analysis: nutrition-label photos, recipe screenshots, image uploads, OCR/vision providers, and meal-photo portion or nutrient estimation. These are excluded product features, not deferred work.
- Automatically logging suggestions, prepared recipes, or unreviewed voice input as consumption.
- Replacing deterministic target calculation, redesigning full meal planning, or changing training prescriptions automatically from memory.
- A pantry inventory system, automatic stock tracking, grocery ordering, shopping optimization, or recipe URL crawling.
- A universal food-composition database, unsupported raw/cooked conversions, or treating estimated nutrients as supplied product facts.
- Broadening ingredient-name dietary checks into certified allergen or cross-contact detection.
- Multi-user accounts, shared recipe libraries, and a redesign of authentication.
- A general long-term media archive or retroactive erasure of conversation history and audit receipts through the memory delete control.

## Further Notes

- Source: [FUTURE.md](../FUTURE.md). This spec covers all four selected ideas: 3 (memory), 6 (voice logging), 7 (immediate meal suggestions), and 8 (recipes, originally idea 1 from the second discussion). The roadmap and spec both reflect the user's removal of all image features.
- Preserve the roadmap priorities: memory and recipes are high priority; voice logging and immediate suggestions are medium priority. All four were estimated as medium difficulty in the roadmap; that is not an implementation estimate or delivery commitment.
- Suggested delivery sequence: memory can proceed independently; establish reusable recipe/template composition; voice logging can start independently using existing saved foods and diary workflows; build immediate suggestions on the existing dietary and repeat-meal workflows plus reusable composition.
- The current application has saved foods, deterministic portion calculations, dietary screening, preparation-time metadata, nutrition-entry snapshots, asynchronous jobs, proposal acceptance, and revision-aware Agent logs. It does not currently expose dedicated editable memory, structured reusable recipes, or voice logging workflows. Reuse existing behavior without assuming the new capabilities already exist.
- No project domain glossary or ADR documents were found in this checkout. Vocabulary follows the existing product documentation and implemented resources.
- Implementation must still select the transcription provider, supported audio formats, recording duration/size limits, and temporary-audio retention. Expose applicable limits and provider failures in the voice workflow. Those choices were not specified in the roadmap and are not claimed as prior user decisions.
- The exact navigation placement of memory and recipes, automatic inferred-memory eligibility, and draft lifetime remain implementation details. The required controls, provenance, expiry, review, and conflict behavior above must remain observable regardless of placement or provider.
- Acceptance requires memory, voice logging, practical meal suggestions, text-based reusable recipes, and their shared invariants. The work can be split into implementation tickets later without changing the separation between saving reusable data and recording consumption.
