# Implementation summary: `.scratch` issues 02–14

The remaining local testing issues were implemented on `skitTesting`. The
project now has an independent service-test baseline, generated properties,
a fair A/B/C mutation experiment, persisted API checks, three Chromium
nutrition workflows, a report, and a demonstration script. No merge to `main`
and no push were performed.

## What changed and why

| Work | Reason | How it works / evidence |
| --- | --- | --- |
| Frozen schedule, Garmin and nutrition examples | Establish a student-designed comparison point separate from the existing tests. | `testing/baseline/` runs 24 cases against public services; nutrition uses migrated disposable PostgreSQL. [Baseline evidence](evidence/baseline-20260925T102731Z-62389.json) records JUnit, coverage, hashes and 43/60 branches. |
| Generated properties | Explore families of inputs and invariants beyond hand-picked cases. | `testing/properties/` adds 13 property functions with 1,050 configured examples, including bounded Garmin dictionaries/lists with omissions; every generated DB example resets committed state. [Expanded evidence](evidence/expanded-20260925T102831Z-62901.json): 37 cases passed, 53/60 branches, with XML/HTML coverage retained. |
| Mutation A/B/C | Measure whether added assertions distinguish controlled code changes. | Fresh mutmut 3.8.0 workspaces mutate the same 466 schedule/Garmin IDs. A killed 248, B 265, C 287. Three requirement-driven Garmin regressions catch 22 further mutants. [Analysis](mutation-analysis.md) explains scope and survivors. |
| API and browser workflows | Verify persistence and actual user interaction with real API/DB/frontend. | Five API checks cover day type, meal jobs/logs, failure/recovery and workout overrides; four Chromium checks cover smoke plus three full nutrition journeys. [Live-stack evidence](evidence/20260925T102915Z-63179.json) passed with no retries. |
| Accessible names on nutrition controls | Browser red run exposed controls that could not be identified by their visible labels. | Added one `aria-label` and associated review labels/inputs; [UI-01](defects.md) retains the red trace and passing rerun. |
| Report and presentation package | Make the methods, measurements, scope and limitations reviewable. | [Editable report](report.md), PDF, [demo script](demo.md), requirement ledger, defect log, and retained raw stage evidence. Personal/course links are explicit placeholders per your instruction. |

## Reproduce

From the repository root, after `uv sync --frozen`, `npm ci` and Playwright
Chromium installation in `frontend/`, use the commands in [testing/README.md](../../testing/README.md).
The service and e2e wrappers create their own disposable Compose projects and
volumes, apply migrations, run selected tests, then tear down. Mutation scripts
copy source and tests into fresh local workspaces. The external nutrition agent
and USDA lookup are synthetic; live Garmin/model and medical quality are not
covered. The separately run repository suite passed 248 cases; frontend lint
remains unconfigured and interactive. [Quality-gate notes](quality-gates.md)
report these apart from the project measurements.

## Finalization left to the student

Fill name/index, team contributions, repository/submission links and course
eligibility in the report; perform a spoken rehearsal of the prepared seven-minute
demo; verify access to the eventual final revision and submit through the actual
course process. Planned deadline: 28 September 2026, 23:59 Europe/Skopje. The
local branch is intentionally unpublished.
