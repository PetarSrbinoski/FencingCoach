# Coach memory

Implements local Future AI tickets 01 (Manage coach memory) and 02 (Remember context through chat).
Open **Coach → Coach options → What my coach knows** to add, inspect, edit, confirm,
delete or disable memory. Agent logs are available from the same screen and from
Coach actions. Disabling stops context retrieval and agent writes, while manual
maintenance remains available. Profile dietary restrictions always remain active.

## Provenance and eligibility

Manual entries are explicit and confirmed when supplied. Chat entries preserve the
source conversation ID, athlete message ID, title and quoted evidence even if the
conversation is deleted. Corrections preserve original provenance and record the
latest source. An inferred entry remains labelled inferred after confirmation;
its confirmation timestamp records the athlete's confirmation of the current content.

Automatic inference is deliberately bounded: only first-person, habitual food
preferences with current-message evidence are eligible. The initial English
screen recognizes “I prefer/like/dislike” or “I usually/always/normally/generally
eat/have/choose”, together with a meal or common food term. Transient, uncertain,
health or allergy statements are ineligible. Unsupported wording requires
clarification or an explicit request. The coach must not infer hard restrictions,
medical facts or training prescriptions. Inferences cannot update explicit or
confirmed memories. Known positive food mentions that conflict with Profile require clarification before
chat writes; supported dislike/avoidance statements remain compatible with those
exclusions. Free-text conflicts also carry an instruction to clarify in context.
Current instructions outrank inferred preferences, and memories never update Profile.

The provider must quote evidence from the current persisted athlete message.
History, summaries and receipts cannot supply evidence for a new memory. Retried
tool calls use a durable message/evidence identity; replaying a deleted operation
returns its deleted state without recreating it. A new explicit request can add a
fact again. Deletion removes active memory; tombstones and audit/conversation
records remain available for guarded undo and are excluded from memory retrieval.

## Expiration and transactions

`expires_on` is the **inclusive last active date** in configured `ATHLETE_TIMEZONE`.
An entry expires at the start of the next local day, with no cleanup job required.
“Until Sunday” means the upcoming Sunday (today if Sunday). “Next Sunday”, “soon”
and “a while” require clarification. Temporary statements require an expiry;
common relative dates are checked against the athlete clock within the sentence
supporting the memory, so unrelated questions about today do not add an expiry. Expired entries
remain inspectable. Meal planning also excludes memories expired by the planned day.

Every memory mutation and receipt commit in one transaction. UI request keys and
chat evidence keys persist with Agent actions; reusing a key with different input
returns a conflict. Edits, confirmation and deletion require the reviewed revision.
Undo compares revisions and always assigns a fresh revision, including when
restoring a deletion. Undo cannot erase later work, even when later content matches
an older version. Original confirmation times survive undo; creation/update times
and revisions remain available in the memory details.

Shared chat/brief context and meal planning include a bounded set of current
memories with provenance and confirmation status. Memory text is data, not system
instructions; context explicitly requires clarification when facts conflict.

## Verification

- API/provider workflows: `.venv/bin/pytest backend/tests/test_coach_memory_workflow_api.py -q`
- Real API browser workflows, desktop and phone: `cd frontend && npx playwright test --config=playwright.memory.config.ts`
- Disposable PostgreSQL migration: `bash backend/tests/support/check_memory_migration.sh`

Browser tests run isolated SQLite persistence and a controlled external chat model.
Migration checks run PostgreSQL, preserve pre-existing profile/chat/action data,
exercise new API writes and undo, and verify downgrade/re-upgrade. No real providers
or production databases are needed.
