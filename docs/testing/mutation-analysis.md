# Mutation analysis and survivor disposition

The [report](report.md) gives stage selections and scores. The full raw
all-ID results and generated source are archived under [A](evidence/mutation-A-20260925T100433Z-52813/),
[B](evidence/mutation-B-20260925T100521Z-53548/), and
[C](evidence/mutation-C-20260925T100720Z-55056/). There are 466 identical IDs
in each result file, with no no-tests, timeout, skipped, suspicious, or
interrupted cases. The two-file source hash and source revision match across
all three `experiment.json` records. Each stage first passed clean tests and
mutmut's forced-fail instrumentation check.

| Mutant ID suffix (all under `app.services.garmin_extract`) | B → C | Diff / classification | Disposition |
| --- | --- | --- | --- |
| `x_extract_sleep__mutmut_11` | survived → killed | Removes nested preferred `dailySleepDTO.sleepTimeSeconds`; missing coverage of a supported input shape. | GAR-03 regression verifies 7,200 s preferred over 3,600 s flat fallback. |
| `x_extract_body_battery__mutmut_1` | survived → killed | Removes stats source, so series fallback wrongly wins; missing precedence coverage. | GAR-03 regression checks stats 80 before series 30. |
| `x__build__mutmut_2` | survived → killed | Replaces the missing metric's retained payload with `None`; weak diagnostic assertion. | GAR-01 regression checks retained payload for a missing nested sleep reading. |
| `x_extract_calories__mutmut_28` | survived → killed at B | Passes `None` instead of kind `calories`, bypassing its plausibility range. | Generated bounded values detect incorrectly trusted values. |
| `x_extract_training_status__mutmut_21` | survived at C | Changes only the detail string decision for empty payloads; status and scalar meaning remain. | No exact-message requirement; irrelevant to the defined semantic score, but retained in the unadjusted denominator. |
| `x__build__mutmut_4` | survived at C | Drops a missing-value detail string. | Diagnostic wording policy unresolved; no brittle exact-message assertion. |

These examples are representative; the remaining 193 C survivors have not all
been classified for equivalence. None is removed from the denominator and no
equivalent-adjusted score is reported. A survivor means the selected suite did
not distinguish the mutant, not that a real defect exists. Regression tests
were added only where a supported path, precedence rule, or retained payload
had a meaningful expected outcome. The pure mutation selection excludes
nutrition/database and browser tests, so the score has no claim outside the
two allowlisted service files.
