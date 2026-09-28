# Athletic editorial refresh

This revises the visual treatment on `mobile-first-ux`, retaining its mobile navigation, URL-backed views, editors, saved drafts, keyboard handling, and existing application capabilities. Backend and API logic are unchanged.

## References and direction

- [VIITA Watches — Awwwards Site of the Day](https://www.awwwards.com/sites/viita-watches): oversized typography, a restrained palette, graphic line work. Reviewed the award gallery image, not just its award listing.
- [Tracksmith — Awwwards Honorable Mention](https://www.awwwards.com/sites/tracksmith): athletic editorial layouts and warm colors. Reviewed the award gallery image.
- The app's own `aac259a` design: large tightly tracked headings, thin rules, orange details, technical labels, and sharper surfaces.

These are references for visual techniques. All app graphics are original CSS/SVG; no third-party branding, photography, or website code is included.

## What changed

- All eight page titles share Today’s responsive size, weight, line height, and letter spacing through one PageTitle component. Long titles wrap instead of shrinking. Coach retains its conversation toolbar with the same title typography.
- Inter, the Today heading font, throughout page titles, section headings, labels, forms, data, and coach content. Size and weight provide hierarchy; alternate serif and monospace font downloads are removed.
- Warm paper surfaces in light mode, existing dark mode, stronger orange navigation states, thin underline tabs, and restrained corner radii.
- Today: distinct, spaced sections for readiness, an always-visible coach input immediately underneath, recovery metrics, the coach brief, and the next competition. Recent activities is removed from this dashboard. Detailed notes and source information remain expandable.
- Garmin: restored the original oversized Sync and Sync All text controls, with recent and full-history sync directly accessible. Existing loading, partial-success, and error feedback is preserved.
- Original fencing line illustration on larger readiness panels. The graphic is decorative and excluded from accessibility announcements.
- Training sessions, nutrition intake, weekly summary, and competition cards receive deliberate accent rules rather than uniform rounded containers.
- Metric previews use actual readings, leave gaps for missing values, and link to the existing Trends screen for exact values.

## Verification

- Inspected synthetic-data screenshots of Today, Training, Nutrition, and Competitions in light and dark themes, plus desktop Today.
- Existing Playwright checks: all eight routes at 320, 390, 768, and 1280 pixels; secondary views and food editor at 320; dated food logging and browser Back; editor behavior with a reduced visual viewport.
- Lint, TypeScript, all seven existing frontend unit tests, and the production build passed. Live route checks are also run after deployment.

Screenshots and research images remain under ignored `.scratch/design-direction/` and are not production assets.
