# Mobile UX review — FencingCoach

> Pre-change audit of `aac259a`. The redesign is tracked in [Mobile-first implementation](mobile-ux-implementation.md). Code line numbers below refer to the audit baseline.
Reviewed 28 September 2026 against commit `aac259a`. This is a design review and implementation proposal; application code and business logic were not changed.

**Assessment:** the navigation shell has a good mobile foundation, but several screens still behave like desktop workspaces stacked into a phone. The highest-value redesign is to organize each screen around one immediate task, with secondary information available on demand. Increasing whitespace alone would make the long pages worse.

## Evidence and scope

Inspected all eight route implementations, shared navigation, forms, chart primitives, dialogs, menus, toast feedback, food library, competition target/meal planning, action receipts, diagnostics, and the typed API client. Read existing workflow tests to understand acceptance, history, date selection, and undo semantics.

Rendered the current frontend using Playwright Chromium with synthetic API responses at 320, 390, and 768 CSS pixels wide, with an 844px viewport height. No live database, Garmin sync, or LLM mutation was used. Screenshots, measurements, and the reproducible fixture script are in `.scratch/mobile-ux-audit/`. Measurements below describe these fixtures, not every possible production state. Code inspection covers additional states that were not exercised end to end against the backend. Physical iOS/Android keyboards, screen readers, and browser chrome remain device-test work; this is not a formal accessibility conformance audit.

| Verified example | Observation |
| --- | --- |
| Chat, 390px | New chat starts at x=336 and ends at x=497 inside a clipping container. Much of the control is invisible. At 320px it is completely outside the visible content. |
| Competitions, 390px | Upcoming event text collapses beside a nonshrinking action row. Follow-up measurement: the row is 308px wide and its information block receives **0px** of layout width; text visibly overflows that block. |
| Competitions, 320px | Document scroll width is 363px: actual page overflow, in addition to the intentionally scrolling past-events table. |
| Nutrition, 390px | Page height about 5,501px. Targets start at y=1,565; diary entries at y=2,752; competition nutrition at y=3,203; shopping at y=5,083. Accepted history is still collapsed. |
| Training, 390px | Page height about 3,561px; fencing analysis starts at y=1,869 and the mental form appears later. |
| Home, 390px | Coach Brief heading starts at y=953; next competition at y=1,373. |
| Weekly, 390px | Activities start at y=2,298 beneath two bar charts and six summary/trend cards. |
| Profile, 390px | Loaded form height about 2,634px. All six custom dropdown triggers have no field-label association. |
| Contextual editing, 390px | After tapping Edit, the competition name input is 722px above the viewport; the nutrition editor heading is 1,523px above it. Focus stays on the original Edit control. |
| 768px breakpoint | Nutrition scroll width 807px, Competitions 831px, Garmin 798px. The 224px sidebar plus 96px content padding leave about 448px for layouts that already enable multiple columns. |

Visual evidence: [Chat clipping](../.scratch/mobile-ux-audit/390-chat.png), [competition layout](../.scratch/mobile-ux-audit/390-competitions.png), [full Nutrition page](../.scratch/mobile-ux-audit/390-nutrition.png), [loaded Profile](../.scratch/mobile-ux-audit/390-profile-loaded.png). The initial 390px Profile capture caught loading; the separate loaded capture above confirms its full form. The 24 primary route/viewport renders produced no page JavaScript errors. Internal table overflow reported by the measurement script is distinguished from document overflow in the findings. Follow-up interaction checks confirmed More → Weekly navigation, opened History and Agent logs, and measured the offscreen edit forms; detailed results are in `.scratch/mobile-ux-audit/followup.json`.

Useful existing patterns to retain: the five-item dock and Radix More sheet; active navigation states; safe-area insets; 48px base inputs; mostly stacked mobile grids; decimal input modes in estimate review; explicit nutrition confirmation and plan acceptance; distinguishable unknown nutrient values; durable coach receipts and guarded undo; confirmation for diary/event deletion; dated deep links; several inline loading/error states.

No map interface or drag-and-drop calendar is present. Calendar-like interactions are the training week, event lists, and native date/time inputs. Recommendations below address those actual components.

## Findings and concrete reworks

Categories: **Quick win** = local component/copy/layout change; **Structural rework** = screen or flow reorganization; **Mobile enhancement** = added mobile presentation or interaction. Critical means a core control or core content is visibly inaccessible, not merely unattractive.

### 01. Chat actions are clipped

**CURRENT ISSUE:** `/chat` places Agent logs, History, and New chat in a single `flex` row, with wide uppercase buttons and no wrapping. The outer chat container uses `overflow-hidden`. Confirmed clipping at both phone widths. [Code](../frontend/src/app/chat/page.tsx#L384).

**WHY IT MATTERS:** starting a conversation is a core action. A control being present in the DOM does not make it usable when it is offscreen and clipped.

**PROPOSED REWORK:** one compact toolbar: conversation title, 44–48px History control, 44–48px New chat control, and an overflow menu for Coach actions. Keep clear accessible names for icon buttons.

**IMPLEMENTATION GUIDANCE:** immediate fix: wrap or stack the row and remove unnecessary horizontal button padding. Final layout: move existing `setAgentLogsOpen`, `setHistoryOpen`, and `startNewConversation` handlers into the compact toolbar; preserve every action. Do not fix this by globally hiding horizontal overflow.

**PRIORITY:** Critical. **CATEGORY:** Quick win, followed by structural rework.

### 02. Competition information loses its available width

**CURRENT ISSUE:** upcoming rows place event information beside Plan nutrition, Add result, Edit, and Delete in a `shrink-0` row. At 390px the actions consume almost all the card width; at 320px they cause document overflow. [Code](../frontend/src/app/competitions/page.tsx#L336).

**WHY IT MATTERS:** dates, event names, locations, and notes become difficult to read precisely where athletes need an unambiguous event summary.

**PROPOSED REWORK:** full-width event title and date first; location and explicit priority below; Plan nutrition on a separate action row; result and management actions in an accessible menu or event detail view.

**IMPLEMENTATION GUIDANCE:** change the row to `flex-col` below a content-appropriate breakpoint. Give the information block `w-full min-w-0`; allow action wrapping. Retain the event ID anchor and existing result/edit/delete handlers. Do not shrink text to make the toolbar fit.

**PRIORITY:** Critical. **CATEGORY:** Quick win.

### 03. Nutrition combines too many distinct jobs

**CURRENT ISSUE:** `/nutrition` always stacks date, estimator, library, targets, duplicate totals, micros, entries, competition planning, today's meal plan, and shopping. Representative height is 5,501px before opening editors/history. [Code](../frontend/src/app/nutrition/page.tsx#L556).

**WHY IT MATTERS:** a frequent task such as checking intake or editing lunch requires scanning unrelated planning tools. The first screen barely reaches meal entry, and the diary itself is several screens away.

**PROPOSED REWORK:** three local destinations: **Diary / Plans / Foods**. Diary shows date, compact intake summary, entries, and Add food. Plans holds daily and competition plans; shopping is a clearly labeled destination within Plans. Foods holds library management.

**IMPLEMENTATION GUIDANCE:** reuse `FoodLibrary`, `CompetitionNutritionPlanner`, and current plan rendering. Keep `selectedDay`, refresh behavior, pending estimate recovery, and all API payloads. Store the selected view in the URL and map existing `day`, `entry`, `food`, `competition`, and `plan` links to the correct view. Do not eagerly mount every heavy panel behind CSS-only tabs.

**PRIORITY:** High. **CATEGORY:** Structural rework.

### 04. Edit actions open forms away from the tapped item

**CURRENT ISSUE:** nutrition Edit/Repeat opens a card above targets and diary entries; competition Edit changes the form above the event list; Add result inserts another card above the list. Those handlers do not focus or scroll to the editor. [Nutrition](../frontend/src/app/nutrition/page.tsx#L359), [competitions](../frontend/src/app/competitions/page.tsx#L102).

**WHY IT MATTERS:** users can see no apparent response, tap again, or lose the item they were editing after a long scroll.

**PROPOSED REWORK:** contextual editors with a clear title, destination date, Save, and Cancel. Use a short sheet for Repeat and a full-height dialog for longer edits.

**IMPLEMENTATION GUIDANCE:** render the existing draft state inside a controlled Radix dialog; focus the first relevant field and return focus to the triggering row. Keep edits/version conflict handling, repeat request IDs, and result validation unchanged. As an interim fix, scroll and focus the inline editor when it opens.

**PRIORITY:** High. **CATEGORY:** Quick win / mobile enhancement.

### 05. Shared actions are smaller than the base inputs

**CURRENT ISSUE:** default buttons are 40px, small buttons 32px; diary Delete is 28px; dialog close is approximately 26px; toast dismiss is a 14px icon without padding. Mental entry Delete is 12px. [Button](../frontend/src/components/ui/button.tsx#L8), [dialog](../frontend/src/components/ui/dialog.tsx#L47), [toast](../frontend/src/components/ui/toast.tsx#L88), [training](../frontend/src/app/training/page.tsx#L390).

**WHY IT MATTERS:** many actions require precision while the user is holding a phone, eating, or training. Small adjacent actions also increase accidental deletion risk.

**PROPOSED REWORK:** use 48px primary controls, at least 44×44px icon hit areas, and 8px spacing between independent actions. Keep icons visually modest within the larger targets.

**IMPLEMENTATION GUIDANCE:** add mobile size variants centrally, then remove conflicting `h-7`, `h-8`, and inline dimensions at callers. Increase menu rows and disclosure hit areas too. Recheck wrapping after increasing sizes. This is a comfort target: WCAG 2.2 AA uses 24×24 CSS pixels with exceptions, so a 32px button is not automatically a conformance failure. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

**PRIORITY:** High. **CATEGORY:** Quick win.

### 06. Desktop breakpoints ignore the sidebar's width

**CURRENT ISSUE:** the sidebar activates at 768px, reserves 224px, and content gains 48px padding on each side. At the same viewport, Profile becomes two columns and Nutrition totals become three. Training already uses two cards above 640px. Sidebar collapse does not change the main `md:pl-56`. [Shell](../frontend/src/components/sidebar-layout.tsx#L10), [sidebar](../frontend/src/components/sidebar.tsx#L159), [nutrition](../frontend/src/app/nutrition/page.tsx#L820).

**WHY IT MATTERS:** landscape phones and small tablets receive desktop density with less usable content width than a portrait phone. Rendered overflow confirms this is not only a theoretical concern.

**PROPOSED REWORK:** keep the dock and single-column task layouts until there is enough content width. Start with the desktop sidebar at 1024px, then tune against real minimum card widths. Use container-based columns for dense components.

**IMPLEMENTATION GUIDANCE:** centralize the shell breakpoint; make main padding track collapsed/expanded sidebar width. Require approximately 280–320px per detailed card before adding columns; preserve desktop grids on genuinely wide layouts.

**PRIORITY:** High. **CATEGORY:** Structural rework.

### 07. Typography alternates between oversized and tiny

**CURRENT ISSUE:** Tailwind overrides `text-5xl` to **56px**, used for most phone page titles. Pages commonly use 64px section gaps. Labels, metadata, badges, and helper text often use 10–12px, uppercase, widely tracked mono text. [Theme](../frontend/tailwind.config.js), [Home](../frontend/src/app/page.tsx#L135), [card](../frontend/src/components/ui/card.tsx#L26).

**WHY IT MATTERS:** the title and decoration consume valuable space while actionable information is harder to read. Large empty gaps coexist with crowded interiors; the interface feels editorial rather than task-oriented.

**PROPOSED REWORK:** phone page titles 28–32px, section titles 18–20px, body/input text 16px, useful secondary text 13–14px. Use sentence case for controls. Set page section gaps to 24–32px, card padding to 16px, and related rows to 8–12px.

**IMPLEMENTATION GUIDANCE:** create consistent page-header and card-spacing variants. Change mobile defaults first, preserving larger desktop typography where appropriate. Avoid reducing all whitespace indiscriminately or compressing the existing long screens into smaller text.

**PRIORITY:** High. **CATEGORY:** Quick win.

### 08. Home's hierarchy does not answer “What matters today?” soon enough

**CURRENT ISSUE:** the coach input precedes five metric cards; readiness appears again as a gauge; advisories use `truncate` without expansion; the full brief and competition follow later. Five metrics occupy a three-column phone grid. The readiness tile uses the last non-null point, which can differ in date from today's gauge. [Code](../frontend/src/app/page.tsx#L169), [StatCard](../frontend/src/app/page.tsx#L331).

**WHY IT MATTERS:** the user must interpret several numbers before reaching useful guidance. Truncated advice cannot be recovered, and undated older readings can appear current.

**PROPOSED REWORK:** readiness score + plain-language band + freshness first, with the existing brief preview directly below. Then Today’s training link and Log food. Put HRV, resting HR, sleep, calories, and detailed advisories under View recovery details; retain a compact next-event row.

**IMPLEMENTATION GUIDANCE:** reorder existing data and expose complete advisory text in an expansion. Use two columns for compact secondary metrics. Label each latest reading with its date when not today. Preview the stored brief without generating a second AI summary; expansion reveals the full original. A Today’s training preview can reuse the existing training API without changing prescriptions.

**PRIORITY:** High. **CATEGORY:** Structural rework.

### 09. Training is a whole week before it is today's session

**CURRENT ISSUE:** all seven days render expanded in order, then fencing analytics, then the mental check-in, history, and insight. `?day=` changes the week but does not select or focus the requested day. Exercise names are truncated and a manual edit's rationale is exposed only through `title`. [Code](../frontend/src/app/training/page.tsx#L477).

**WHY IT MATTERS:** on Saturday, today's session is far down the page. An athlete in the gym needs readable exercise names and prescriptions, not a week of preceding cards.

**PROPOSED REWORK:** **Plan / Fencing / Mindset** local navigation. Plan opens today or the linked day, with a compact week selector and one expanded session. Show exercise name on its own line and sets/reps/load beneath. Rest days become short rows.

**IMPLEMENTATION GUIDANCE:** continue using the existing week response; add selected-day presentation state and URL synchronization. Retain competition context alongside additional manually planned work. Keep previous/next week and add Today. Provide a real Details control for rationale. Reset to auto remains accessible but should explain its effect and require confirmation before removing the override.

**PRIORITY:** High. **CATEGORY:** Structural rework.

### 10. Mental check-in controls rely on desktop precision and hover

**CURRENT ISSUE:** four two-column sliders have 4px tracks and 12px thumbs. Entry deletion is `opacity-0 group-hover:opacity-100` and deletes immediately. Entry text is permanently line-clamped; scores use M/E/F/C shorthand. [Code](../frontend/src/app/training/page.tsx#L280), [history](../frontend/src/app/training/page.tsx#L375).

**WHY IT MATTERS:** the delete action is undiscoverable on touch; slider adjustment is fiddly; longer reflections cannot be fully read.

**PROPOSED REWORK:** full-width labeled score rows with larger thumbs, current value, and endpoint labels. Keep all values 1–10. Show a persistent action menu and expandable reflection text. Present full metric names in entry detail.

**IMPLEMENTATION GUIDANCE:** provide a 44px-high slider interaction region and keyboard arrow support; keep existing accessible names and add meaningful value text. Add delete confirmation using the shared dialog, focus styling, and a visible Saved check-in status. Preserve all three entry types and the current defaults/calculations.

**PRIORITY:** High. **CATEGORY:** Quick win / mobile enhancement.

### 11. Profile is a long form with Save only at the top

**CURRENT ISSUE:** 16 profile fields and numerous implementation-oriented notes span two large cards that stack on phones. Save appears only in the header; errors also appear above the entire form. [Code](../frontend/src/app/profile/page.tsx#L110).

**WHY IT MATTERS:** someone editing Notes or Supplements must return to the top to save or see a failure, with no persistent indication of unsaved work.

**PROPOSED REWORK:** four groups: Athlete basics; Training goals; Nutrition preferences; Additional notes. For returning users, open the needed group directly. Keep a sticky Save changes bar only while dirty. First-use setup may walk through essentials, with optional details later.

**IMPLEMENTATION GUIDANCE:** keep one draft object and the same profile update payload. Add dirty detection, inline field feedback, error focus, and navigation-away protection for unsaved edits. Do not require a wizard on every visit. Keep dietary exclusions separate from preferences and retain the meaning of all existing help text in expandable explanations.

**PRIORITY:** High. **CATEGORY:** Structural rework / mobile enhancement.

### 12. Labels and form semantics are inconsistent

**CURRENT ISSUE:** competition labels have no `htmlFor`/control ID association. Profile `Field` assigns IDs only to Input/Textarea; labels for nested Radix selects point to nonexistent IDs. Training's week arrow buttons lack accessible names. Some custom selectors convey selection only visually. [Competitions](../frontend/src/app/competitions/page.tsx#L204), [Profile Field](../frontend/src/app/profile/page.tsx#L372), [week controls](../frontend/src/app/training/page.tsx#L547).

**WHY IT MATTERS:** visible proximity is not an accessible name. Voice control and screen readers cannot reliably identify fields and actions; tapping a label may not focus its field.

**PROPOSED REWORK:** every control has a persistent label and associated description/error; icon-only controls have explicit names; segmented selections expose their state.

**IMPLEMENTATION GUIDANCE:** pass IDs to actual `SelectTrigger`s and use `aria-labelledby` where appropriate. Add `aria-describedby`/`aria-invalid` to validated controls; label arrows Previous week/Next week. Use semantic `h2` headings for card sections rather than styled `div`s, and make custom type selectors a labeled radio group or pressed buttons. Add a skip link to main content.

**PRIORITY:** High. **CATEGORY:** Quick win.

### 13. Input behavior varies between forms

**CURRENT ISSUE:** base Input is 16px/48px, but estimate fields override to 14px/36px; Textarea and many native selects use 14px. Profile name has no autofill hint. Meal description and chat both use single-line inputs, even for detailed text. [Estimate](../frontend/src/app/nutrition/page.tsx#L665), [textarea](../frontend/src/components/ui/textarea.tsx#L12), [chat composer](../frontend/src/app/chat/page.tsx#L556).

**WHY IT MATTERS:** long messages are difficult to revise; keyboard behavior is inconsistent. Small editable text warrants checking for focus zoom on iOS.

**PROPOSED REWORK:** standardize mobile editable text at 16px. Use an auto-growing 1–4-line composer for chat and 2–4 lines for meal descriptions. Use decimal keyboards for grams/macros and integer keyboards for age/results.

**IMPLEMENTATION GUIDANCE:** retain native date/time controls; add `inputMode`, suitable `enterKeyHint`, `autoComplete="name"`, and field-specific min/step values. Do not invent autofill tokens for unsupported fields. On phones, Enter inserts a newline in composers; visible Send/Estimate submits. Preserve desktop keyboard shortcuts and composition-event handling.

**PRIORITY:** Medium. **CATEGORY:** Quick win.

### 14. Light-theme status colors and faint text lack contrast

**CURRENT ISSUE:** `BandPill` and warning text use amber-400/emerald-400 across themes; many helpful notes use `text-muted-foreground/60` or `/70`. With the configured light background, amber-400 is approximately 1.53:1, emerald-400 1.76:1, and muted text at 70% approximately 2.89:1. These are calculated token/background examples, not a pixel audit of every overlay. [Tokens](../frontend/src/styles/globals.css#L6), [BandPill](../frontend/src/components/ui.tsx#L51).

**WHY IT MATTERS:** small warning text becomes especially difficult to read outdoors. Important information should not depend on recognizing a pale color.

**PROPOSED REWORK:** theme-aware semantic success/warning/error foreground colors; readable secondary text without arbitrary opacity. Use explicit labels such as Priority A, Readiness: good, Partial sync.

**IMPLEMENTATION GUIDANCE:** separate decorative icon color from text color. Test actual blended backgrounds in both themes. Normal text should reach 4.5:1; qualifying large text 3:1. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Upcoming competitions currently reuse red/amber/green readiness pills for A/B/C priority; show the actual priority rather than translating it into a color word.

**PRIORITY:** High. **CATEGORY:** Quick win.

### 15. Tables preserve desktop reading order on phones

**CURRENT ISSUE:** Weekly activities, past competitions, fencing analysis, chat target references, and coach proposals use multi-column tables. Chat tables have explicit 460/500px minimum widths inside already indented content. Weekly and past-event tables add vertical scroll regions. [Weekly](../frontend/src/app/weekly/page.tsx#L198), [chat](../frontend/src/app/chat/page.tsx#L506), [fencing](../frontend/src/app/training/page.tsx#L131).

**WHY IT MATTERS:** names, numbers, and actions cannot be read together. Horizontal movement inside a vertical scrolling card or conversation is cumbersome.

**PROPOSED REWORK:** phone rows become expandable cards. Activity: date/type/duration, then HR/load detail. Past event: name/date/result with a menu. Target proposal: date/context, Current and Proposed stacked, with all macros and consequences accessible.

**IMPLEMENTATION GUIDANCE:** share row data and action handlers between mobile cards and desktop tables. Do not remove fields to fit. Reserve horizontal scrolling for inherently two-dimensional data, with a visible cue and keyboard access. WCAG reflow allows certain two-dimensional content exceptions; the app's surrounding controls and text should still work at 320px. [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

**PRIORITY:** High. **CATEGORY:** Structural rework.

### 16. Chat needs a viewport and reading model suited to phones

**CURRENT ISSUE:** chat uses `100svh - 8rem` inside the ordinary page shell, its own scroll area, a large header, padded bubbles, avatars, and 42px-indented receipts. The composer is pinned within that container but there is no explicit visual-viewport keyboard handling. Every message/busy change scrolls to the bottom. [Code](../frontend/src/app/chat/page.tsx#L80), [layout](../frontend/src/app/chat/page.tsx#L384).

**WHY IT MATTERS:** useful response width is unnecessarily narrow. Browser chrome/keyboard changes may obscure the composer; automatic scrolling can interrupt someone reading an earlier reply. Keyboard overlap is a risk requiring physical-device verification, not a confirmed observation from desktop emulation.

**PROPOSED REWORK:** dedicated mobile chat shell with compact toolbar, one message scroller, and composer anchored to the visible viewport. Use almost full-width assistant content and full-width structured receipts; distinguish authors with modest labels rather than a permanent avatar gutter.

**IMPLEMENTATION GUIDANCE:** coordinate shell, dock, composer, and safe-area heights in one place. Use dynamic viewport sizing plus tested visual-viewport handling where needed. Temporarily hide the dock while the keyboard is open, restore on dismissal, and preserve drafts. Only autoscroll when already near the bottom; otherwise offer New reply. Announce reply status without repeatedly reading the whole conversation.

**PRIORITY:** High. **CATEGORY:** Structural rework / mobile enhancement.

### 17. Background generation is described through technical controls

**CURRENT ISSUE:** chat shows a square stop icon whose visible meaning suggests cancellation, while it actually stops observing a job that continues on the server. Nutrition's Stop watching explanation partly relies on `title`. Reopening resumes some pending work, but the distinction is not obvious. [Chat](../frontend/src/app/chat/page.tsx#L280), [nutrition](../frontend/src/app/nutrition/page.tsx#L299).

**WHY IT MATTERS:** users may assume an action was cancelled and retry, or think a reply has disappeared. Phones are especially likely to be backgrounded mid-task.

**PROPOSED REWORK:** explicit status: “Coach is working. You can leave and return.” Label the existing observation action “Hide progress” or “Leave running,” with a visible Resume status action when applicable.

**IMPLEMENTATION GUIDANCE:** preserve `createJobObserver`, pending IDs, recovery, and server behavior. Do not rename this to Cancel unless server cancellation is implemented. Distinguish request failed, connection interrupted, still running, and completed. Make results available without requiring navigation away and back.

**PRIORITY:** Medium. **CATEGORY:** Quick win / mobile enhancement.

### 18. Coach action history is dense for routine review

**CURRENT ISSUE:** Agent logs opens a centered dialog with four filters, every action's Before and After, technical statuses, explanation paragraphs, links, and pagination. It is a useful audit tool, but a heavy default presentation. [Code](../frontend/src/components/agent-logs.tsx#L83).

**WHY IT MATTERS:** the user often wants to answer “What changed?” or undo one action, rather than inspect twenty expanded records.

**PROPOSED REWORK:** rename the user-facing entry point Coach actions. On mobile show compact receipts with verb/object, time, status, and Open. Expand one action for Before/After and Preview Undo. Put filters behind a Filter button with active-filter count.

**IMPLEMENTATION GUIDANCE:** retain historical receipts, conversation/resource links, pagination, conflict protection, preview, and explicit Confirm Undo. Use a full-height dialog with sticky header. Pass the selected action ID from an inline receipt so the relevant record is opened immediately; expose technical IDs under details.

**PRIORITY:** Medium. **CATEGORY:** Structural rework.

### 19. Food-library management interrupts simple logging

**CURRENT ISSUE:** each saved-food row always contains Edit and Remove alongside the food. The list has a nested 288px scroller, its editor appears above the list, and the log form below it. Remove executes immediately. Logging also inherits a meal slot chosen in the separate estimator panel. [Code](../frontend/src/components/food-library.tsx#L148).

**WHY IT MATTERS:** logging yogurt requires navigating a management surface; controls compress the name. The destination meal is separated from the point of commitment.

**PROPOSED REWORK:** Add food opens **Saved foods / Describe meal / Manual** choices. Saved foods provides search, clear selection, portion entry, explicit date/meal, and a calculated portion preview. Management actions live in Foods or a row menu.

**IMPLEMENTATION GUIDANCE:** keep grams and named servings, incomplete-food blocking, null-versus-zero semantics, search, all nutrient units, and preservation of historical logs. Make the long food editor full-height; keep basics/macros first and optional serving/preparation/micros under Add details. Confirm library removal unless a real reversible restore is implemented; do not promise unsupported Undo.

**PRIORITY:** High. **CATEGORY:** Structural rework.

### 20. Target and estimate summaries repeat too much information

**CURRENT ISSUE:** the target card header combines a long title, source badges, and a fixed-width day-type selector. Intake appears again in a separate totals card, while micros form another full card. Estimate review mixes editable macros, confidence, notes, and per-ingredient technical nutrient strings. [Targets](../frontend/src/app/nutrition/page.tsx#L769), [estimate](../frontend/src/app/nutrition/page.tsx#L641).

**WHY IT MATTERS:** redundant summaries take attention away from the meal being reviewed. The target card header visibly narrows and wraps at phone width.

**PROPOSED REWORK:** compact daily energy summary plus labeled protein/carbs/fat rows. Put fiber, micronutrients, target provenance, and day-type adjustment in clearly named details. In estimate review, show destination and editable totals first; ingredient/source detail expands below. Keep confidence warnings visible.

**IMPLEMENTATION GUIDANCE:** stack card titles and actions on phones; preserve all totals rather than duplicating them in the default view. Format user-facing nutrient names and units using known keys without inventing units for arbitrary data. Keep incomplete-diary and unknown-value indicators near the values; never interpret missing nutrients as zero.

**PRIORITY:** High. **CATEGORY:** Quick win / structural rework.

### 21. Competition preparation creates a deeply nested planning flow

**CURRENT ISSUE:** competition preview expands every dated target; accepted history contains preparation forms, drafts, accepted meal history, and Replace buttons. Meal timing asks users to type comma-separated times. Internal source IDs and policy/version strings appear throughout default content. [Planner](../frontend/src/components/competition-nutrition-planner.tsx#L94), [meals](../frontend/src/components/competition-meals.tsx#L85).

**WHY IT MATTERS:** users must distinguish proposed targets, accepted targets, proposed meals, accepted meals, and consumed food within nested long sections. Consequential acceptance controls sit after considerable reading.

**PROPOSED REWORK:** event-scoped steps: **Event details → Review targets → Plan meals**. Show a compact date list and expand any day for full comparison. Meal review shows timing, portions, totals, deviations, and warnings before acceptance. History becomes a separate version list.

**IMPLEMENTATION GUIDANCE:** preserve preview tokens, acceptance IDs, overlap resolution, target differences, per-date meal acceptance, replacement, deactivation preview, and history. Keep “Accepting meals does not log consumption” visible. Replace comma-separated break input with Add break time rows that serialize to the same array. Keep conflict/replacement warnings visible even when routine explanations are collapsed. A sticky acceptance footer must retain the review step, not bypass it.

**PRIORITY:** High. **CATEGORY:** Structural rework / mobile enhancement.

### 22. The Competitions landing screen prioritizes creation over existing events

**CURRENT ISSUE:** the seven-field Add form is always above Upcoming; it occupies about 849px in the 390px fixture, with Upcoming starting at y=1,169. Past results are hidden behind a horizontally scrolling table. [Code](../frontend/src/app/competitions/page.tsx#L199).

**WHY IT MATTERS:** checking the next event is likely more frequent than adding one, yet the default screen prioritizes data entry.

**PROPOSED REWORK:** Upcoming / Past local views, next event first, visible Add competition action. Add/edit opens a focused editor: name/date/priority first; location, level, notes, and optional end date remain accessible below. Results have their own contextual editor.

**IMPLEMENTATION GUIDANCE:** retain all fields, multi-day events, result/legacy detail preservation, deletion confirmation, and anchors. Use a single short form with optional details before adding unnecessary wizard steps. Label priority meaning in help text using existing product semantics; do not invent new priority rules.

**PRIORITY:** High. **CATEGORY:** Structural rework.

### 23. Cross-screen links sometimes land far from the intended task

**CURRENT ISSUE:** `?competition=` selects an event but does not scroll to its nutrition planner; `?food=` selects a library item without focusing it; `?day=` in Training only selects the week. CompetitionMeals links to `/nutrition#my-foods`, but no matching ID exists. Past events offer Plan nutrition although the planner fetches upcoming events only and can select a different event. [Planner](../frontend/src/components/competition-nutrition-planner.tsx#L28), [food link](../frontend/src/components/competition-meals.tsx#L98), [food selection](../frontend/src/components/food-library.tsx#L54).

**WHY IT MATTERS:** an apparently successful navigation can land several screens away or on the wrong context, particularly confusing after following a coach receipt.

**PROPOSED REWORK:** deep links open the exact local view and selected resource, show its name/date immediately, and provide a clear unavailable-state action if it no longer exists. Past-event links should lead to that event's saved plan/history or explicitly explain availability.

**IMPLEMENTATION GUIDANCE:** centralize URL-to-view selection; use `api.competitions.get(id)` for a directly referenced event when needed. Never silently substitute another event. Add the missing anchor as a quick fix. Preserve existing `?plan=` behavior that already opens and scrolls history; manage browser Back and restore list position when returning.

**PRIORITY:** High. **CATEGORY:** Quick win / structural rework.

### 24. Weekly makes every chart equally prominent

**CURRENT ISSUE:** the page is titled This Week while mixing 7-day bars with 28-day trends. Two bar charts, five sparklines, a summary, and activities all stack. Sparklines hide axes and connect nulls; exact historical values are mainly in tooltips. [Weekly](../frontend/src/app/weekly/page.tsx#L118), [charts](../frontend/src/components/charts.tsx#L46).

**WHY IT MATTERS:** users must inspect many charts without a clear time range or selected question. Sparse data can look continuous; touch users need a reliable way to read exact values.

**PROPOSED REWORK:** call the destination Trends, retaining `/weekly`. Lead with the existing weekly summary, then Recovery / Training / Nutrition views. Show one selected chart with an explicit period and Latest/Average; keep all existing metrics selectable. Activities become expandable mobile rows.

**IMPLEMENTATION GUIDANCE:** preserve current 7/28-day calculations and periods; a future range selector must state which period each derived value covers. Add touch-selected date/value readouts and a compact accessible data list. Mark missing readings rather than visually bridging them without explanation. Do not add clinical interpretations or change the underlying calculations.

**PRIORITY:** Medium. **CATEGORY:** Structural rework.

### 25. Garmin makes the action more prominent than the connection state

**CURRENT ISSUE:** giant Sync and Sync All text comes before freshness/status; raw timestamps, metric row counts, extraction terminology, and JSON fetched counts appear in routine feedback. Full backfill is nearly as prominent as recent sync. [Code](../frontend/src/app/garmin/page.tsx#L106), [coverage](../frontend/src/components/data-coverage-panel.tsx#L73).

**WHY IT MATTERS:** users need to know whether data is current and what needs attention. The current page makes them scroll past two large actions to find out.

**PROPOSED REWORK:** status card first: last successful data time, latest attempt outcome, readiness availability. Then Sync now. Put one-year backfill under Import history and metric-level diagnostics under Data details. Collapse multiple stale warnings into a count with expansion.

**IMPLEMENTATION GUIDANCE:** preserve recent/full sync and partial/complete/failed distinctions. Format local timestamps and human-readable fetched summaries; exact values remain in details. Keep persistent progress/status near the triggering control; do not claim a percentage when the API does not provide one.

**PRIORITY:** Medium. **CATEGORY:** Structural rework / quick win.

### 26. Failures sometimes look like loading or empty data

**CURRENT ISSUE:** several Home requests swallow failures; a metric can remain a skeleton, a failed competition fetch becomes No upcoming competitions, and a failed brief fetch looks like No brief. Weekly settles requests without surfacing failures; mental entry loading failure becomes an empty list. Profile load failure leaves its skeleton. Provider switching silently reverts on failure. [Home](../frontend/src/app/page.tsx#L59), [Weekly](../frontend/src/app/weekly/page.tsx#L22), [provider](../frontend/src/components/llm-provider-toggle.tsx#L25).

**WHY IT MATTERS:** unreliable mobile connections make it essential to distinguish “nothing saved” from “could not load.” A blank or zero-looking summary can mislead.

**PROPOSED REWORK:** per-section loading, empty, error, stale-data, and success states. Keep last usable data labeled with its date and provide local Retry. Empty states offer the next useful action, such as Add competition or Open Garmin.

**IMPLEMENTATION GUIDANCE:** track request status separately from payloads; preserve successful sections when another fails. Keep errors beside their initiating operation and announce them appropriately. Profile/provider failures need explicit retry and feedback. Do not convert backend failures into fabricated values or silently treat missing readings as zero.

**PRIORITY:** High. **CATEGORY:** Quick win.

### 27. Dialogs, notifications, and destructive actions need one interaction standard

**CURRENT ISSUE:** the shared dialog is centered with full width, no generic height/scroll constraint, and a small close button; individual consumers add different constraints. `ConfirmDialog` closes immediately after invoking `onConfirm`, even for an async failure. Chat deletion and food removal have no confirmation. Toasts disappear after 4.5 seconds and can stack over the working area. [Dialog](../frontend/src/components/ui/dialog.tsx#L30), [confirmation](../frontend/src/components/ui/confirm-dialog.tsx#L43), [chat deletion](../frontend/src/app/chat/page.tsx#L288).

**WHY IT MATTERS:** destructive failures can be reported far from the dismissed control; focus and keyboard comfort differ between screens. Long forms must remain reachable with a keyboard open.

**PROPOSED REWORK:** short choices/confirmations use a bottom sheet; long forms/history use a full-height dialog with sticky header/footer and one content scroller. Destructive actions name the item and wait for completion. Toasts supplement persistent local state.

**IMPLEMENTATION GUIDANCE:** keep Radix focus trapping and restoration; add safe-area/dynamic-height constraints and 44px Close controls. Give confirmation an async pending/error contract, disable repeat submission, and close only on success. Keep delete confirmations where already present; add them to immediate destructive controls. Offer Undo only if the existing backend genuinely supports restoration.

**PRIORITY:** High. **CATEGORY:** Quick win / mobile enhancement.

### 28. Navigation is already good, but secondary discovery can improve

**CURRENT ISSUE:** Home, Training, Nutrition, Coach, More is a sensible dock. Weekly, Competitions, Garmin, Profile, theme, and provider are in More. Weekly's name overlaps conceptually with Training's weekly split, and More uses 10px labels in the dock. User-facing language includes LLM provider and Agent logs. [Code](../frontend/src/components/sidebar.tsx#L28).

**WHY IT MATTERS:** rebuilding navigation would add little value; unclear names and missing contextual shortcuts create more friction than the extra More tap itself.

**PROPOSED REWORK:** retain the dock. Rename Home to Today if desired and Weekly to Trends. More presents Trends, Competitions, Garmin, Profile, then Appearance and Coach provider. Add contextual links: Today's training on Home, Trends from relevant metrics, and event planning from Competitions.

**IMPLEMENTATION GUIDANCE:** keep every route and `aria-current`. Increase dock label legibility while retaining its existing generous targets. Add real back navigation only for detail/editor views; top-level pages do not need a redundant back button. Retain Local/Cloud settings under understandable language and report switch failures. Match sheets, cards, and controls to one visual system; the dock's rounded treatment currently differs sharply from the square editorial page controls, though square corners themselves are not a usability defect.

**PRIORITY:** Medium. **CATEGORY:** Quick win / structural rework.

### 29. Default text is too technical and too repetitive

**CURRENT ISSUE:** Profile repeatedly explains storage/context/calculation internals; Nutrition repeats provenance, policy, version, assumptions, and disclaimers across nested cards; Garmin describes parsing/extraction; the brief and insights render their entire prose. [Profile](../frontend/src/app/profile/page.tsx#L188), [nutrition planner](../frontend/src/components/competition-nutrition-planner.tsx#L128).

**WHY IT MATTERS:** the user has to distinguish action-relevant facts from implementation explanations. Shrinking these paragraphs makes the clutter harder to read rather than solving it.

**PROPOSED REWORK:** short benefit-oriented summaries with labeled disclosure: Why these targets?, Food sources, Plan history, Data details, Full brief. Ordinary helper text should usually be one sentence. Keep uncertainty, changed restrictions, conflicts, replacement effects, and acceptance consequences visible when they affect the decision.

**IMPLEMENTATION GUIDANCE:** preserve full content behind explicit controls; do not delete business caveats or silently truncate advice. Do not generate new AI summaries just to shorten existing content. Existing strings can be rewritten without changing calculations. Use a two-line preview with Read full note for long reflections and prose.

**PRIORITY:** High. **CATEGORY:** Quick win / structural rework.

### 30. Motion, focus, and chart semantics need a final accessibility pass

**CURRENT ISSUE:** custom sliders, history rows, and some plain buttons lack the shared explicit focus treatment. Chat always requests smooth scrolling. Chart/gauge/progress components lack application-level text alternatives or full-data views; asynchronous chat text lacks a dedicated announcement pattern. Global reduced-motion handling is absent. [Charts](../frontend/src/components/charts.tsx), [chat](../frontend/src/app/chat/page.tsx#L80), [styles](../frontend/src/styles/globals.css).

**WHY IT MATTERS:** visible layout improvements alone do not make the app usable with keyboard, voice, enlarged text, or a screen reader. Status-only color and animation can hide information or distract.

**PROPOSED REWORK:** consistent focus indication, semantic section headings, concise live status announcements, text summaries for charts, and reduced-motion behavior. Preserve numeric values alongside color.

**IMPLEMENTATION GUIDANCE:** respect `prefers-reduced-motion` for custom animations and scroll behavior; verify chart-library keyboard support rather than assuming it. Add accessible names/value semantics where appropriate and an expandable data list. Test focus with sheets open, 200% text scaling, zoom/reflow, and VoiceOver/TalkBack. Do not announce all historical chat messages on every render.

**PRIORITY:** Medium. **CATEGORY:** Quick win / polish.

## Main journeys, end to end

| Journey | Current friction | Proposed sequence and preserved behavior |
| --- | --- | --- |
| Morning check | Several numbers, older readings, and scrolling before brief/event | Today → readiness/freshness → short brief → Today's training. Detailed metrics and full advice remain one expansion away. |
| Check today's workout | Scan seven full cards; linked date only selects week | Training → selected-day session. Previous/next week, every exercise, rationale, competition context, and Reset to auto remain available. |
| Mental check-in | Below schedule and analytics; fine sliders; limited save feedback | Training → Mindset → four large score rows + optional note → Log entry → visible saved record. All entry types, history, insights, and deletion remain. |
| Log described meal | Long page introduction, single-line text, distant diary feedback | Nutrition Diary → Add food → Describe → Review editable estimate + date/meal → Confirm & log → new entry and refreshed totals. Preserve mandatory review and pending job recovery. |
| Log saved food | Mixed edit/remove/log actions and remotely selected meal slot | Diary → Add food → Saved foods → select → grams/servings + destination + preview → Log. Unknown core macros still block logging. |
| Edit/repeat entry | Form appears above the current viewport | Entry → Edit/Repeat sheet → Save → return to the same row/date or explicitly selected destination. Retain version checks, multiplier bounds, and original record. |
| Prepare for competition | Deep link selects far-down planner; nested previews/history | Event → Plan nutrition → input details → review all affected dates → Accept targets → generate/review meals → accept per date. Saving a plan never records eating. |
| Record event result | Wide row actions; result editor appears above list | Event/Past → Add result → contextual editor → Save → updated result card. Retain numerical validation, reflection, legacy fields, and Clear result confirmation. |
| Ask coach and inspect action | New chat clipped; reference tables wider than message; receipts open generic logs | Coach → readable composer → reply → compact action receipt → selected action details → Preview Undo → Confirm Undo. Preserve all conflict/undo safeguards. |
| Change profile | Many fields, help paragraphs, Save/errors at top | More → Profile → relevant group → sticky Save → inline success. Unsaved values remain in the same draft until saved/discarded. |
| Refresh Garmin | Oversized actions precede status | More → Garmin → state/freshness → Sync now → durable complete/partial/failed result. Import full history and diagnostic details remain available. |

## The ten biggest problems, ranked

1. Clipped Chat controls, especially New chat — finding 01.
2. Competition event text crushed by its actions — finding 02.
3. Nutrition's approximately 5,500px multi-purpose default page — finding 03.
4. Edit and result forms opening away from their triggers — finding 04.
5. Small/hover-only controls and difficult mental sliders — findings 05 and 10.
6. Premature desktop layouts at the 768px sidebar breakpoint — finding 06.
7. Oversized headings paired with tiny, faint operational text — findings 07 and 14.
8. Training displays the whole week before the current task — finding 09.
9. Profile's long form with Save only at the top — finding 11.
10. Default prose, duplicate summaries, and nested planning detail overwhelm the decision — findings 20, 21, and 29.

## Recommended navigation

| Dock | Route | Local organization |
| --- | --- | --- |
| Today | `/` | Readiness, brief preview, training/food actions, next competition; recovery detail expands. |
| Training | `/training` | Plan / Fencing / Mindset. Default to today or the linked day. |
| Nutrition | `/nutrition` | Diary / Plans / Foods. Shopping is a destination within Plans. |
| Coach | `/chat` | Current conversation; History, New chat, Coach actions in compact toolbar/menu. |
| More | Existing sheet | Trends (`/weekly`), Competitions, Garmin, Profile; Appearance and Coach provider below. |

Keep the dock to five destinations; do not add a sixth. Keep desktop sidebar navigation when enough width is available. Use URL state for local views so browser Back, reload, and coach links preserve context. Detail screens have Back to [origin]; modal editors have Close/Cancel and restore focus. Avoid a global floating action button whose meaning changes unpredictably; use contextual Add food/Save actions with visible labels.

## Screen-by-screen clean defaults

| Screen | Default mobile content, in order | Reveal only when requested |
| --- | --- | --- |
| Today | Compact date/title; readiness + freshness; brief preview; Today's training / Log food; next event | Complete brief, all recovery metrics/advisories, recent activity detail, exact diagnostic timestamps |
| Training — Plan | Compact week selector; selected day; complete readable exercise prescription | Other days, manual-edit rationale, Reset to auto explanation |
| Training — Fencing | Period + session summary; recent-session rows | HR zone methodology and per-session metrics |
| Training — Mindset | Check-in action/form; latest check-in; short insight | Full entry history, full reflections, insight explanation |
| Nutrition — Diary | One date toolbar; intake summary; entries by meal; Add food | Fiber/micros, target calculation/source, day-type override, ingredient details |
| Nutrition — Plans | Today plan summary; competition selection/status; shopping link | Meal ingredients/timing, dated target comparisons, accepted versions, deactivation review |
| Nutrition — Foods | Search; saved-food rows; Add food | Portion sheet, library editing, optional micronutrients/serving/prep details |
| Competitions | Upcoming/Past selector; next event; event cards; Add competition | Add/edit/result forms, notes/reflection, historical result extras |
| Trends (`/weekly`) | Weekly summary; Recovery/Training/Nutrition selector; chosen chart with explicit period | Other metrics and accessible data values; activity detail |
| Coach | Compact conversation toolbar; broad readable responses; composer | History, action history, full provenance, target comparisons in a dedicated review view |
| Garmin | Freshness/latest outcome; Sync now; concise issue count | Import one-year history, all metric coverage, exact timestamps/counts |
| Profile | Group summaries and selected group; Save while dirty | Other groups and explanation of how settings affect coaching |

**Content budget:** use one primary task and at most three major information groups in a default phone view. This is a design target, not a rule that hides required fields or warnings. Aim to make the key status and next action visible in the first viewport at 390×844. Routine helper copy should fit one short sentence; preview long prose in two to four lines with an explicit expansion. Avoid nested accordion chains: open a detail view when the task needs another level. Never hide conflicts, destination dates, uncertainty relevant to acceptance, or changed-restriction warnings merely to meet a visual budget.

## Mobile versus desktop components

| Component | Mobile behavior | Desktop behavior |
| --- | --- | --- |
| Navigation shell | Existing dock + More sheet; keyboard-aware in chat | Sidebar with coordinated collapsed width |
| Page header | 28–32px title, compact metadata, one main action | Larger editorial title where it does not displace work |
| Card header | Title above actions when width is limited | Title/action row |
| Week schedule | Day selector + selected session | Multi-day overview where each card has sufficient width |
| Activity/event tables | Expandable rows/cards with full detail | Semantic tables with comparison columns |
| Target comparison | Per-date Current/Proposed stacks | Side-by-side comparison table |
| Charts | One focused chart, touch readout, data detail | Multiple simultaneous charts when useful |
| Forms | Single column except short paired values; optional sections | Logical two-column groups |
| Dialogs | Short sheet or full-height editor with sticky actions | Constrained centered modal |
| Filters | Filter sheet, active-filter count, Clear filters | Inline filter toolbar |
| Search/library | Full-width search and selectable rows, contextual actions | List/detail layout if space permits |
| Meal and exercise cards | Names wrap; numeric detail on next line | Name/value rows when width permits |
| Long generated text | Short preview + explicit Full response outside normal chat; full chat answer readable in place | Expanded reading pane where appropriate |
| Status/notifications | Local persistent feedback; toast above dock; critical errors remain | Same semantics, desktop placement |
| Date/time controls | Native picker with adequate width; separate break-time rows | Native controls or equivalent accessible picker |

## Prioritized implementation roadmap

### Phase 1 — critical mobile fixes

**Quick wins, before visual polish:** fix Chat toolbar clipping and competition action rows (01–02); delay desktop density until the content fits (06); standardize tap targets and remove hover-only actions (05, 10); repair labels/names/contrast (12, 14); connect edit actions to visible focused editors (04); repair missing/wrong-context links (23); make load failures explicit (26). Add pending/error handling to confirmations (27). Reduce mobile heading/gap extremes (07) as part of the same shared-component pass.

**Acceptance:** no clipped core controls or document-level horizontal overflow at 320, 360, 390, 430, 768, and 1024px; all existing actions usable with touch and keyboard; selected records/dates survive deep links; errors do not masquerade as empty data; destructive actions cannot double-submit. Intentionally scrolling data regions must not force the whole page to scroll sideways.

### Phase 2 — UX improvements

**Structural reworks:** separate Nutrition into Diary/Plans/Foods (03, 19–21); put selected-day training first and separate Fencing/Mindset (09); put competition lists before creation (22); group Profile with a persistent dirty-state Save action (11); reorder Home around today (08); focus Trends on one question (24); simplify Garmin status (25); use compact Coach action receipts (18). Apply the content budget and short-copy rules throughout (29).

**Acceptance:** a user can check today's session, log a meal, edit an entry, and save a profile change without searching through unrelated sections. Every current field, target detail, history, result, food operation, setting, and undo path has an explicit destination. No nutrition acceptance or consumption semantics change. Existing dates, request IDs, tokens, and conflict behavior are retained.

### Phase 3 — polish and mobile-native interactions

**Mobile enhancements:** unify sheets/full-height editors and sticky footers; finish chat viewport/keyboard behavior and near-bottom autoscroll (16); add better resume/progress affordances (17); make chart values touch-readable; finish focus/reduced-motion/screen-reader work (30); restore scroll position across detail navigation; add contextual first-use prompts rather than a long global tutorial.

Optional swipe actions can reveal Repeat/Edit, but retain visible button/menu equivalents. Do not add swipe-to-delete, automatic plan acceptance, pull-to-refresh on every screen, or additional floating controls without evidence that they improve a real task. Consistent layouts and readable content are higher priority than gestures.

**Acceptance:** validate on physical iPhone Safari and Android Chrome with keyboards open, safe areas, landscape, large text, dark/light themes, long names, substantial histories, and slow/interrupted networks. Verify focus restoration, screen-reader names/status, chart alternatives, and no action bar covering content. Keep sticky Add/Save bars above the dock with one shared offset; avoid stacking multiple fixed bars.

## Preservation checklist for implementation

Keep all eight routes and existing inbound query/hash links; all profile fields and provider/theme settings; both Garmin sync scopes and diagnostics; all training days/exercises/overrides/competition context; all mental entry types/history/insights; competition CRUD/results/legacy details; ordinary and accepted nutrition targets, manual day types, estimates/manual entry/edit/repeat/delete, grams/servings and every nutrient unit; daily meal plans and shopping coverage; competition previews/acceptance/replacement/deactivation/history; conversations, proposal decisions, source references, receipts, and guarded undo. Presentation can change. The meaning of saving, accepting, logging consumption, missing data, and undo must not.
