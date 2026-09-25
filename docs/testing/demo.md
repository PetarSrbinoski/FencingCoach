# Seven-minute demonstration package

**Before presenting:** Fill title-page placeholders in `report.md`; ensure the
isolated stack can start, or use the saved JUnit/Playwright/mutation evidence
below. No live provider or personal account is needed. Planned presentation
length: **7:00**; rehearse speaking pace with a human before submission.

| Time | Show and say | Saved fallback |
| --- | --- | --- |
| 0:00–0:50 | Introduce FencingCoach, the research question and isolated architecture. Point out the independent `testing/` suite and excluded legacy tests. | Report sections 1–2; [collection](evidence/20260925T100425Z-52708-collection.txt). |
| 0:50–1:50 | Open `testing/baseline/test_schedule.py`: seven tokens preserve Monday/Sunday order, invalid lengths fail. Explain partitions and why 43/60 is branch coverage only. | [Baseline JUnit](evidence/baseline-20260925T095243Z-48489-junit.xml) and [coverage](evidence/baseline-20260925T095243Z-48489-coverage.json). |
| 1:50–2:50 | Open one Garmin property and the DB history property. Explain bounded 100 versus 15/20 example budgets, shrinking, and reset per generated DB example. No generated failure occurred. | [Expanded evidence](evidence/expanded-20260925T095932Z-50271.json). |
| 2:50–4:05 | Show mutant `x_extract_sleep__mutmut_11`: removing the preferred nested path makes 7,200 seconds lose to a 3,600-second fallback. Show the C regression and A/B/C status. | [Mutation analysis](mutation-analysis.md), [B raw outcomes](evidence/mutation-B-20260925T100521Z-53548/results.txt), [C raw outcomes](evidence/mutation-C-20260925T100720Z-55056/results.txt). |
| 4:05–5:35 | In Chromium, open Nutrition, choose a manual day type, reload, choose Auto. Then request synthetic estimate, edit kcal, save, reload and delete if time permits. Explain real API/DB with only external agent stubbed. | [Playwright JSON](evidence/20260925T100425Z-52708-playwright.json) and [API JUnit](evidence/20260925T100425Z-52708-backend-smoke.xml). |
| 5:35–6:30 | Read the measured comparison: A 248/466, B 251/466, C 273/466. Explain excluded nutrition/API/browser mutation scope and no equivalent adjustment. | Report section 4 and three stage `stats.json` files. |
| 6:30–7:00 | State limits: no live provider/medical validation; unresolved maintain/mixed-activity/coercion policy; title-page/link prerequisites and no push/submission. | Report sections 6–7 and [defects](defects.md). |

For a live run, `bash testing/scripts/run_e2e.sh` owns and removes a disposable
stack. Start it before the session if showing the browser manually; the wrapper
normally tears down on completion, so a live walkthrough requires a separately
held test stack. The saved results above are the reliable fallback and do not
depend on network or provider availability. The times are a script budget, not
a claim that spoken rehearsal has already been completed.
